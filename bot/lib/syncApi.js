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

function configValues(items) {
	const config = {};
	(items || []).forEach(function (item) {
		const row = (item && item.json) || {};
		if (row.key) config[row.key] = row.value;
	});
	return config;
}

function globalPlan(built, config, applicationId) {
	return {
		registerGlobal: (config || {}).registerGlobal === 'true',
		applicationId: applicationId,
		commands: (built && built.globalCommands) || [],
	};
}

function guildTargets(built, defaultGuildIds) {
	const restrictions = (built && built.guildRestrictions) || {};
	const commands = (built && built.guildCommands) || [];
	const ids = [];
	(defaultGuildIds || []).forEach(function (id) {
		if (ids.indexOf(id) === -1) ids.push(id);
	});
	Object.keys(restrictions).forEach(function (name) {
		restrictions[name].forEach(function (id) {
			if (ids.indexOf(id) === -1) ids.push(id);
		});
	});
	return ids.map(function (guildId) {
		const isDefault = (defaultGuildIds || []).indexOf(guildId) !== -1;
		return {
			guildId: guildId,
			commands: commands.filter(function (c) {
				return restrictions[c.name] ? restrictions[c.name].indexOf(guildId) !== -1 : isDefault;
			}),
		};
	});
}

function syncReport(built, guilds, registerGlobal) {
	return {
		registered: built.guildCommands.length,
		global: (built.globalCommands || []).length,
		globalSkipped: registerGlobal !== true,
		skipped: built.skipped,
		guilds: guilds,
	};
}

function syncAbortMessage(errors) {
	return 'Sync aborted:\n' + errors.join('\n');
}

if (typeof module !== 'undefined') module.exports = { toSyncWorkflows, parseGuildIds, configValues, globalPlan, guildTargets, syncReport, syncAbortMessage };
