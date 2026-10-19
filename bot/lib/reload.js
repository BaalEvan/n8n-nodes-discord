function reloadReply(report) {
	const r = report && typeof report === 'object' ? report : {};
	if (r.error !== undefined && r.error !== null) {
		const text = typeof r.error === 'string' ? r.error : r.error.message || JSON.stringify(r.error);
		return { content: text };
	}
	if (typeof r.registered !== 'number') {
		return { content: 'Sync returned no report. Check the Discord Sync execution log.' };
	}
	let content = 'Registered ' + r.registered + ' commands.';
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
