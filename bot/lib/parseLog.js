var PARSE_EXCEPTION_RE = /^(?:[^|]*\|[^|]*\|)?(?:\w*Exception:|\w*LogException)/;
var PARSE_STACK_RE =
	/^(?:[^|]*\|[^|]*\|)?(?:\s+at\s|[^\s:()]+:[^\s(]+\(.*\)\s*$|Parameter name:|Actual value was|\s*--->|\s*--- End of )/;
var PARSE_SDK_ERROR_RE = /^Error: nn::/;
var PARSE_SDK_ABORT_RE = /^AbortObserver called:/;
var PARSE_SDK_DETAIL_RE = /^(?:Search '|https?:\/\/)/;
var PARSE_SDK_DUMP_RE = /^\[SnapShotDumper\]/;
var PARSE_DASHES_RE = /^-{4,}\s*$/;
var PARSE_SWITCH_HINT_RE = /^\[\w*Switch::\w+\]/;
var PARSE_FENCE = '`'.repeat(3);
var PARSE_MAX_INPUT = 20 * 1024 * 1024;
var PARSE_MAX_FILE = 8 * 1024 * 1024;

function byteLength(text) {
	return typeof Buffer !== 'undefined' ? Buffer.byteLength(text, 'utf8') : text.length * 3;
}

function findAttachment(interaction) {
	var inter = interaction || {};
	var id = inter.options && inter.options.logfile;
	var a =
		id !== undefined &&
		inter.resolved &&
		inter.resolved.attachments &&
		inter.resolved.attachments[id];
	if (!a || !a.url) return null;
	if (typeof a.size !== 'number' || !isFinite(a.size) || a.size > PARSE_MAX_INPUT) {
		var label =
			typeof a.size === 'number' && isFinite(a.size)
				? (a.size / 1048576).toFixed(1) + ' MB'
				: 'unknown size';
		return {
			error:
				'That log file is too large to parse (' +
				label +
				', limit 20 MB). Upload a smaller or trimmed log.',
		};
	}
	return { url: a.url, filename: a.filename, size: a.size };
}

function splitSdkLine(line) {
	if (PARSE_SDK_DUMP_RE.test(line)) {
		return line.split(/(?=\[SnapShotDumper\])/).map(function (part) {
			var m = /^\[SnapShotDumper\][^']*'[^']*'/.exec(part);
			return m ? m[0] : part;
		});
	}
	if (PARSE_SDK_ABORT_RE.test(line)) {
		return line
			.replace(/ {2}(Module|Description|InnerValue): /g, '\n  $1: ')
			.replace(/(\S)(Condition|Function): /g, '$1\n$2: ')
			.split('\n');
	}
	return [line];
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

function parseLog(text, meta, options) {
	var info = meta || {};
	var fileLimit = options && options.fileLimit ? options.fileLimit : PARSE_MAX_FILE;
	var lines = String(text === undefined || text === null ? '' : text).split(/\r?\n/);
	var list = [];
	var cur = null;
	var sdk = null;
	var prev = '';
	lines.forEach(function (line) {
		var blank = !line.trim();
		var before = prev;
		if (!blank) prev = line;
		if (sdk) {
			if (PARSE_DASHES_RE.test(line)) {
				sdk.dashes++;
				return;
			}
			if (sdk.dashes === 1) {
				if (!blank) sdk.entry.stack.push.apply(sdk.entry.stack, splitSdkLine(line));
				return;
			}
			if (blank) return;
			var keep =
				sdk.dashes === 0
					? PARSE_SDK_DETAIL_RE.test(line) || PARSE_SDK_ABORT_RE.test(line)
					: PARSE_SDK_DUMP_RE.test(line);
			if (keep) {
				sdk.entry.stack.push.apply(sdk.entry.stack, splitSdkLine(line));
				return;
			}
			sdk = null;
		}
		if (PARSE_SDK_ERROR_RE.test(line) || PARSE_SDK_ABORT_RE.test(line)) {
			var parts = splitSdkLine(line);
			var entry = { message: parts[0], stack: parts.slice(1) };
			if (PARSE_SWITCH_HINT_RE.test(before)) entry.stack.unshift(before);
			list.push(entry);
			sdk = { entry: entry, dashes: PARSE_DASHES_RE.test(before) ? 1 : 0 };
			cur = null;
		} else if (PARSE_EXCEPTION_RE.test(line)) {
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
		var file = '';
		var used = 0;
		var shown = 0;
		var reserve = 100;
		for (var i = 0; i < n; i++) {
			var chunk = [list[i].message].concat(list[i].stack, ['', '']).join('\n') + '\n';
			var size = byteLength(chunk);
			if (used + size > fileLimit - (i < n - 1 ? reserve : 0)) break;
			file += chunk;
			used += size;
			shown++;
		}
		var content = fileMessage(n);
		if (shown < n) {
			file += '… truncated (' + (n - shown) + ' more exceptions not shown)\n';
			content += ' The file was truncated.';
		}
		return { mode: 'file', content: content, file: file };
	}
	return {
		mode: 'embeds',
		content:
			"Loaded log file '" + info.filename + "' (" + info.size + ' bytes). Exceptions Count:' + n,
		embeds: embeds,
	};
}

if (typeof module !== 'undefined') module.exports = { parseLog, findAttachment, fileMessage };
