const PRIVATE_KEYS = ['whitelist', 'ephemeral', 'modals', 'scope'];

function buildCommandList(workflows) {
	const guildCommands = [];
	const globalCommands = [];
	const table = [];
	const errors = [];
	const skipped = [];
	const owners = {};
	const scopes = {};
	(workflows || []).forEach(function (wf) {
		if (!wf.active) return;
		let nodes = wf.publishedNodes;
		if (!nodes) {
			if (wf.versionId !== wf.activeVersionId) {
				skipped.push(wf.name + ': has unpublished changes');
				return;
			}
			nodes = wf.nodes;
		}
		const node = (nodes || []).filter(function (n) {
			return n.name === 'Command Definition';
		})[0];
		if (!node) {
			errors.push(wf.name + ': no "Command Definition" node');
			return;
		}
		let text = node.parameters && node.parameters.jsonOutput;
		if (typeof text === 'string' && text.charAt(0) === '=') text = text.slice(1);
		const parsed = parseDefinition(text);
		if (!parsed.ok) {
			parsed.errors.forEach(function (e) {
				errors.push(wf.name + ': ' + e);
			});
			return;
		}
		const def = parsed.definition;
		const global = def.scope === 'global';
		if (owners[def.name] !== undefined) {
			if (scopes[def.name] !== global) {
				const guildOwner = global ? owners[def.name] : wf.name;
				const globalOwner = global ? wf.name : owners[def.name];
				errors.push(
					'command name "' + def.name + '" is used by a server command (' + guildOwner +
						') and a global command (' + globalOwner + ')',
				);
			} else {
				errors.push('duplicate command name "' + def.name + '": ' + owners[def.name] + ' and ' + wf.name);
			}
			return;
		}
		owners[def.name] = wf.name;
		scopes[def.name] = global;
		const command = Object.assign({}, def);
		PRIVATE_KEYS.forEach(function (key) {
			delete command[key];
		});
		(global ? globalCommands : guildCommands).push(command);
		table.push({ name: def.name, workflowId: wf.id, definition: text });
	});
	if (guildCommands.length > 100) {
		errors.push('too many server commands: at most 100 per guild, found ' + guildCommands.length);
	}
	if (globalCommands.length > 100) {
		errors.push('too many global commands: at most 100, found ' + globalCommands.length);
	}
	return {
		guildCommands: guildCommands,
		globalCommands: globalCommands,
		table: table,
		errors: errors,
		skipped: skipped,
	};
}

if (typeof module !== 'undefined') module.exports = { buildCommandList };
