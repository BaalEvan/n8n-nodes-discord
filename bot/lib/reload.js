function count(n, noun) {
	return n + ' ' + noun + (n === 1 ? '' : 's');
}

function reloadReply(report) {
	const r = report && typeof report === 'object' ? report : {};
	if (r.error !== undefined && r.error !== null) {
		const text = typeof r.error === 'string' ? r.error : r.error.message || JSON.stringify(r.error);
		return { content: text };
	}
	if (typeof r.registered !== 'number') {
		return { content: 'Sync returned no report. Check the Discord Sync execution log.' };
	}
	const perGuild = (Array.isArray(r.guilds) ? r.guilds : []).filter(function (g) {
		return g && typeof g === 'object' && typeof g.count === 'number';
	});
	const noun = typeof r.global === 'number' ? 'server command' : 'command';
	const server =
		'Registered ' +
		(perGuild.length > 0
			? perGuild
					.map(function (g, i) {
						return (i === 0 ? count(g.count, noun) : g.count) + ' on ' + g.guildId;
					})
					.join(', ')
			: count(r.registered, noun));
	let content = server + '.';
	if (typeof r.global === 'number') {
		content = r.globalSkipped
			? server + '; ' + count(r.global, 'global command') + ' skipped (registerGlobal is off).'
			: server + ' and ' + count(r.global, 'global command') + '.';
	}
	const skipped = Array.isArray(r.skipped) ? r.skipped : [];
	if (skipped.length > 0) {
		content +=
			'\nSkipped:\n' +
			skipped
				.map(function (s) {
					return '- ' + s;
				})
				.join('\n');
	}
	return { content: content };
}

if (typeof module !== 'undefined') module.exports = { reloadReply };
