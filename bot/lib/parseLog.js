var PARSE_EXCEPTION_RE = /^(?:[^|]*\|[^|]*\|)?(?:\w*Exception:|\w*LogException)/;
var PARSE_STACK_RE = /^(?:[^|]*\|[^|]*\|)?\s+at\s/;
var PARSE_FENCE = '`'.repeat(3);

function findAttachment(interaction) {
	var inter = interaction || {};
	var id = inter.options && inter.options.logfile;
	var a =
		id !== undefined &&
		inter.resolved &&
		inter.resolved.attachments &&
		inter.resolved.attachments[id];
	if (!a || !a.url) return null;
	return { url: a.url, filename: a.filename, size: a.size };
}

function fileMessage(n) {
	return (
		'There ' +
		(n === 1 ? 'is' : 'are') +
		' ' +
		n +
		' exception' +
		(n === 1 ? '' : 's') +
		' in the log.'
	);
}

function parseLog(text, meta) {
	var info = meta || {};
	var lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/);
	var list = [];
	var cur = null;
	lines.forEach(function (line) {
		if (PARSE_EXCEPTION_RE.test(line)) {
			cur = { message: line, stack: [] };
			list.push(cur);
		} else if (cur && PARSE_STACK_RE.test(line)) {
			cur.stack.push(line);
		} else {
			cur = null;
		}
	});

	var n = list.length;
	var embeds = list.map(function (e) {
		var embed = { title: e.message.slice(0, 256), color: 10038562 };
		if (e.stack.length) {
			var body = e.stack.join('\n');
			if (body.length > 4000) body = body.slice(0, 4000) + '\n…';
			embed.description = PARSE_FENCE + body + PARSE_FENCE;
		}
		return embed;
	});
	var total = embeds.reduce(function (sum, e) {
		return sum + e.title.length + (e.description ? e.description.length : 0);
	}, 0);

	if (n > 9 || total > 6000) {
		var file = list
			.map(function (e) {
				return [e.message].concat(e.stack, ['', '']).join('\n') + '\n';
			})
			.join('');
		return { mode: 'file', content: fileMessage(n), file: file };
	}
	return {
		mode: 'embeds',
		content:
			"Loaded log file '" + info.filename + "' (" + info.size + ' bytes). Exceptions Count:' + n,
		embeds: embeds,
	};
}

if (typeof module !== 'undefined') module.exports = { parseLog, findAttachment, fileMessage };
