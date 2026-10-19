function toSyncWorkflows(items) {
	const workflows = [];
	const skipped = [];
	let found = 0;
	(items || []).forEach(function (wf) {
		if (!wf || wf.id === undefined || wf.id === null || wf.id === '') return;
		found += 1;
		const version = wf.activeVersion;
		if (!version || !Array.isArray(version.nodes)) {
			if (wf.active) skipped.push(wf.name + ': no published version');
			return;
		}
		workflows.push({ id: String(wf.id), name: wf.name, active: true, publishedNodes: version.nodes });
	});
	const errors = found === 0 ? ['no discord-command workflows found'] : [];
	return { workflows: workflows, skipped: skipped, errors: errors };
}

function parseGuildIds(value) {
	let ids = null;
	try {
		ids = JSON.parse(value);
	} catch (e) {
		ids = null;
	}
	const valid =
		Array.isArray(ids) &&
		ids.length > 0 &&
		ids.every(function (id) {
			return (typeof id === 'string' || typeof id === 'number') && String(id) !== '';
		});
	if (!valid) throw new Error('discord_config row "guildIds" must hold a JSON array of server IDs');
	return ids.map(String);
}

function syncReport(built, guildIds) {
	return { registered: built.commands.length, skipped: built.skipped, guilds: guildIds };
}

function syncAbortMessage(errors) {
	return 'Sync aborted:\n' + errors.join('\n');
}

if (typeof module !== 'undefined') module.exports = { toSyncWorkflows, parseGuildIds, syncReport, syncAbortMessage };
