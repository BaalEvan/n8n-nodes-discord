function buildCommandList(workflows) {
	const commands = [];
	const table = [];
	const errors = [];
	const skipped = [];
	const owners = {};
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
		if (owners[def.name] !== undefined) {
			errors.push('duplicate command name "' + def.name + '": ' + owners[def.name] + ' and ' + wf.name);
			return;
		}
		owners[def.name] = wf.name;
		const command = Object.assign({}, def);
		delete command.whitelist;
		delete command.ephemeral;
		delete command.modals;
		commands.push(command);
		table.push({ name: def.name, workflowId: wf.id, definition: text });
	});
	if (commands.length > 100) errors.push('too many commands: at most 100 per guild, found ' + commands.length);
	return { commands: commands, table: table, errors: errors, skipped: skipped };
}

if (typeof module !== 'undefined') module.exports = { buildCommandList };
