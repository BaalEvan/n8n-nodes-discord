// Runs a built workflow for one input item in n8n's v1 order, with stand-ins for HTTP, Drive, Discord, Data Tables and sub-workflows.
function expr(code, ctx) {
	return new Function('$', '$json', '$workflow', 'return (' + code + ');')(
		ctx.$,
		ctx.$json,
		ctx.$workflow,
	);
}

function resolve(value, ctx) {
	if (typeof value !== 'string' || !value.startsWith('=')) return value;
	const body = value.slice(1);
	const whole = /^\{\{([\s\S]*)\}\}$/.exec(body);
	if (whole && !whole[1].includes('}}')) return expr(whole[1], ctx);
	return body.replace(/\{\{([\s\S]*?)\}\}/g, (_, c) => String(expr(c, ctx)));
}

function matches(conditions, ctx) {
	return conditions.conditions.every((c) => {
		const left = resolve(c.leftValue, ctx);
		const op = c.operator.type + ':' + c.operator.operation;
		if (op === 'string:notEmpty') return typeof left === 'string' && left.length > 0;
		if (op === 'string:equals') return left === resolve(c.rightValue, ctx);
		if (op === 'boolean:true') return left === true;
		throw new Error('simulate: no operator ' + op);
	});
}

function rowMatches(row, filters, ctx, any) {
	const conditions = (filters && filters.conditions) || [];
	if (!conditions.length) return true;
	const test = (c) => {
		if (c.condition !== 'eq') throw new Error('simulate: no condition ' + c.condition);
		return row[c.keyName] === resolve(c.keyValue, ctx);
	};
	return any ? conditions.some(test) : conditions.every(test);
}

function failed(node, error, outputs) {
	if (node.onError === 'continueErrorOutput') {
		const out = Array.from({ length: outputs }, () => []);
		out.push([{ json: { error } }]);
		return out;
	}
	if (node.onError === 'continueRegularOutput') return [[{ json: { error } }]];
	throw new Error('simulate: ' + node.name + ' failed');
}

function runWorkflow(wf, input, env, depth = 0) {
	if (depth > 5) throw new Error('simulate: sub-workflow calls nested too deep');
	const runData = new Map();
	const order = [];
	const accessor = (name) => {
		if (!runData.has(name)) {
			const missing = () => {
				throw new Error('simulate: ' + name + ' has not run');
			};
			return { isExecuted: false, first: missing, all: missing };
		}
		const items = runData.get(name)[0] || [];
		return { isExecuted: true, first: () => items[0], all: () => items };
	};
	const tables = env.tables;

	function runNode(node, items) {
		const ctx = { $: accessor, $json: items[0] && items[0].json, $workflow: { id: wf.id } };
		const p = node.parameters;
		switch (node.type) {
			case 'n8n-nodes-base.executeWorkflowTrigger': {
				if (p.inputSource === 'passthrough') return [[{ json: items[0].json }]];
				const json = {};
				for (const f of p.workflowInputs.values) {
					json[f.name] = items[0].json[f.name] === undefined ? null : items[0].json[f.name];
				}
				return [[{ json }]];
			}
			case 'n8n-nodes-base.if': {
				const out = [[], []];
				for (const item of items) {
					out[matches(p.conditions, { ...ctx, $json: item.json }) ? 0 : 1].push(item);
				}
				return out;
			}
			case 'n8n-nodes-base.switch': {
				const out = p.rules.values.map(() => []);
				for (const item of items) {
					const i = p.rules.values.findIndex((r) =>
						matches(r.conditions, { ...ctx, $json: item.json }),
					);
					if (i !== -1) out[i].push(item);
				}
				return out;
			}
			case 'n8n-nodes-base.code': {
				const $input = { first: () => items[0], all: () => items, item: items[0] };
				const fn = new Function('$', '$input', '$json', p.jsCode);
				return [fn(accessor, $input, ctx.$json)];
			}
			case 'n8n-nodes-base.set': {
				if (p.mode !== 'raw') throw new Error('simulate: Set mode ' + p.mode);
				const out = resolve(p.jsonOutput, ctx);
				return [[{ json: typeof out === 'string' ? JSON.parse(out) : out }]];
			}
			case 'n8n-nodes-base.dataTable': {
				const name = p.dataTableId.value;
				if (env.tableErrors && env.tableErrors[name]) {
					return failed(node, env.tableErrors[name], 1);
				}
				const rows = (tables[name] = tables[name] || []);
				const any = p.matchType === 'anyCondition';
				let out;
				if (p.operation === 'get') {
					out = rows
						.filter((r) => rowMatches(r, p.filters, ctx, any))
						.slice(0, p.returnAll ? Infinity : p.limit || 50);
				} else if (p.operation === 'deleteRows') {
					out = rows.filter((r) => rowMatches(r, p.filters, ctx));
					tables[name] = rows.filter((r) => !out.includes(r));
				} else if (p.operation === 'upsert') {
					const values = {};
					for (const [k, v] of Object.entries(p.columns.value)) values[k] = resolve(v, ctx);
					const hit = rows.filter((r) => rowMatches(r, p.filters, ctx));
					if (hit.length) hit.forEach((r) => Object.assign(r, values));
					else rows.push(values);
					out = hit.length ? hit : [values];
				} else {
					throw new Error('simulate: no dataTable operation ' + p.operation);
				}
				out = out.map((r) => ({ json: { ...r } }));
				return [out.length || !node.alwaysOutputData ? out : [{ json: {} }]];
			}
			case 'n8n-nodes-base.httpRequest': {
				const body = p.sendBody ? resolve(p.jsonBody, ctx) : undefined;
				const query = {};
				if (p.sendQuery) {
					for (const q of p.queryParameters.parameters) query[q.name] = resolve(q.value, ctx);
				}
				const res = env.http({
					node: node.name,
					method: p.method,
					url: resolve(p.url, ctx),
					query: p.sendQuery ? query : undefined,
					body: typeof body === 'string' ? JSON.parse(body) : body,
				});
				if (res.error) return failed(node, res.error, 1);
				const format = p.options && p.options.response && p.options.response.response;
				if (format && format.responseFormat === 'file') {
					return [[{ json: {}, binary: { [format.outputPropertyName || 'data']: res.binary } }]];
				}
				return [[{ json: res.json }]];
			}
			case 'n8n-nodes-base.googleDrive': {
				const field = resolve(p.inputDataFieldName, ctx);
				const binary = items[0].binary && items[0].binary[field];
				if (!binary) throw new Error('simulate: ' + node.name + ' has no binary ' + field);
				const res = env.drive({
					node: node.name,
					resource: p.resource || 'file',
					operation: p.operation || 'upload',
					name: resolve(p.name, ctx),
					folderId: resolve(p.folderId.value, ctx),
					driveId: p.driveId.value,
					binary,
				});
				if (res.error) return failed(node, res.error, 1);
				return [[{ json: res.json }]];
			}
			case 'CUSTOM.discord': {
				const call = {
					node: node.name,
					resource: p.resource,
					operation: p.operation,
					channelId: resolve(p.channelId, ctx),
					content: resolve(p.content, ctx),
				};
				env.messages.push(call);
				const error = env.discordError && env.discordError(call);
				if (error) return failed(node, error, 1);
				return [[{ json: { id: 'message-' + env.messages.length } }]];
			}
			case 'n8n-nodes-base.executeWorkflow': {
				const id = resolve(p.workflowId.value, ctx);
				const subInput = {};
				for (const [k, v] of Object.entries(p.workflowInputs.value)) subInput[k] = resolve(v, ctx);
				env.subCalls.push({ node: node.name, workflowId: id, input: subInput });
				try {
					const sub = env.workflows[id];
					if (!sub) throw new Error('Workflow does not exist.');
					return [runWorkflow(sub, subInput, env, depth + 1).items];
				} catch (error) {
					if (node.onError === 'continueRegularOutput')
						return [[{ json: { error: error.message } }]];
					throw error;
				}
			}
			default:
				throw new Error('simulate: no node type ' + node.type);
		}
	}

	const trigger = wf.nodes.find((n) => n.type === 'n8n-nodes-base.executeWorkflowTrigger');
	const stack = [[trigger.name, [{ json: input }]]];
	const runs = {};
	while (stack.length) {
		const [name, items] = stack.pop();
		const node = wf.nodes.find((n) => n.name === name);
		runs[name] = (runs[name] || 0) + 1;
		if (runs[name] > 1) throw new Error('simulate: ' + name + ' ran twice');
		const outputs = runNode(node, node.executeOnce ? items.slice(0, 1) : items);
		runData.set(name, outputs);
		order.push(name);
		const conns = (wf.connections[name] && wf.connections[name].main) || [];
		for (let i = conns.length - 1; i >= 0; i--) {
			if (!outputs[i] || !outputs[i].length) continue;
			for (const c of [...(conns[i] || [])].reverse()) stack.push([c.node, outputs[i]]);
		}
	}
	env.executions.push({ workflowId: wf.id, input, order });
	return { items: runData.get(order[order.length - 1])[0] || [], order };
}

function simulate(wf, input, env = {}) {
	const full = {
		tables: {},
		workflows: { [wf.id]: wf },
		http: () => {
			throw new Error('simulate: no http stand-in');
		},
		drive: () => {
			throw new Error('simulate: no drive stand-in');
		},
		messages: [],
		subCalls: [],
		executions: [],
		...env,
	};
	const result = runWorkflow(wf, input, full);
	return { ...result, env: full };
}

module.exports = { simulate, resolve };
