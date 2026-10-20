function innermostOptions(options) {
	const path = [];
	let opts = options || [];
	while (opts.length === 1 && (opts[0].type === 1 || opts[0].type === 2)) {
		path.push(opts[0].name);
		opts = opts[0].options || [];
	}
	return { subcommand: path.length ? path.join(' ') : null, options: opts };
}

function optionsToMap(options) {
	const map = {};
	let focused = null;
	options.forEach(function (o) {
		map[o.name] = o.value;
		if (o.focused) focused = o.name;
	});
	return { map: map, focused: focused };
}

function modalFields(rows) {
	const fields = {};
	(rows || []).forEach(function (row) {
		((row && row.components) || []).forEach(function (c) {
			if (c && c.custom_id !== undefined) fields[c.custom_id] = c.value;
		});
	});
	return fields;
}

function classifyInteraction(raw) {
	raw = raw || {};
	const data = raw.data || {};
	const who = (raw.member && raw.member.user) || raw.user || {};
	const kinds = { 2: 'command', 3: 'component', 4: 'autocomplete', 5: 'modal' };
	const kind = kinds[raw.type] || 'unknown';
	const out = {
		kind: kind,
		commandName: null,
		action: null,
		payload: null,
		userId: who.id || '',
		roleIds: (raw.member && raw.member.roles) || [],
		guildId: raw.guild_id || null,
		channelId: raw.channel_id || null,
		context: raw.context === undefined ? null : raw.context,
		authorizingIntegrationOwners: raw.authorizing_integration_owners || {},
		options: {},
		subcommand: null,
		resolved: data.resolved || {},
		focused: null,
		values: [],
		fields: {},
		interactionId: raw.id || '',
		token: raw.token || '',
		applicationId: raw.application_id || '',
		messageId: (raw.message && raw.message.id) || null,
	};
	if (kind === 'command' || kind === 'autocomplete') {
		out.commandName = data.name || null;
		const inner = innermostOptions(data.options);
		const parsed = optionsToMap(inner.options);
		out.subcommand = inner.subcommand;
		out.options = parsed.map;
		out.focused = parsed.focused;
	} else if (kind === 'component' || kind === 'modal') {
		const decoded = decodeCustomId(data.custom_id);
		if (decoded) {
			out.commandName = decoded.command;
			out.action = decoded.action;
			out.payload = decoded.payload;
		}
		if (kind === 'component') out.values = data.values || [];
		else out.fields = modalFields(data.components);
	}
	return out;
}

if (typeof module !== 'undefined') module.exports = { classifyInteraction };
