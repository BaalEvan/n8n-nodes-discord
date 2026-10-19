var NO_LINK = 'No link provided.';
var NOT_FETCHED = 'Could not fetch ClickUp task.';

function extractTaskId(link) {
	var input = String(link === undefined || link === null ? '' : link).trim();
	if (!input) return null;
	var task = input.match(/https?:\/\/app\.clickup\.com\/t\/([^\s<>|]*)/i);
	if (task) {
		var rest = task[1];
		var cut = rest.search(/[?#]/);
		if (cut >= 0) rest = rest.slice(0, cut);
		rest = rest.replace(/^\/+|\/+$/g, '');
		var id = rest
			.split('/')
			.pop()
			.replace(/[.,)\]}!?;:"']+$/, '');
		return id || null;
	}
	if (/^http/i.test(input)) {
		var last = input.split('/').pop();
		if (last && !/[?/"&]/.test(last)) return last;
	}
	return null;
}

function text(value) {
	return typeof value === 'string' && value.trim() ? value : null;
}

function buildTaskEmbed(task) {
	var t = task && typeof task === 'object' ? task : {};
	var status = t.status && typeof t.status === 'object' ? text(t.status.status) : null;
	var embed = {
		title: (text(t.name) || 'No Name').slice(0, 256),
		description: (text(t.description) || 'No Description').slice(0, 4096),
		color: 3447003,
		fields: [{ name: 'Status', value: (status || 'Unknown').slice(0, 1024) }],
	};
	var url = text(t.url);
	if (url) {
		embed.url = url;
		embed.fields.push({ name: 'Link', value: url.slice(0, 1024) });
	}
	return embed;
}

if (typeof module !== 'undefined')
	module.exports = { extractTaskId, buildTaskEmbed, NO_LINK, NOT_FETCHED };
