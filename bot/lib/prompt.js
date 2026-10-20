var NOT_CONFIGURED = "Prompt hook isn't configured (discord_config row webhookBase is missing).";
var EMPTY_REPLY = '(empty response)';
var CUT_NOTE = '\n… (answer cut, too long for Discord)';
var CHUNK_SIZE = 1950;
var MAX_FOLLOWUPS = 10;
var MAX_EMBEDS = 10;
var MAX_EMBED_DESCRIPTION = 4096;

function buildPromptUrl(base, prompt, preset) {
	var root = String(base === undefined || base === null ? '' : base).trim();
	if (!root) return '';
	var url =
		root.replace(/\/+$/, '') +
		'/webhook/gemini-hook?prompt=' +
		encodeURIComponent(String(prompt === undefined || prompt === null ? '' : prompt));
	if (preset) url += '&preset=' + encodeURIComponent(String(preset));
	return url;
}

function splitText(content) {
	var parts = [];
	var rest = String(content);
	while (rest.length > CHUNK_SIZE) {
		var i = rest.lastIndexOf('. ', CHUNK_SIZE);
		if (i !== -1) i += 2;
		else {
			i = rest.lastIndexOf(' ', CHUNK_SIZE);
			i = i !== -1 ? i + 1 : CHUNK_SIZE;
		}
		parts.push(rest.slice(0, i));
		rest = rest.slice(i);
	}
	parts.push(rest);
	return parts;
}

function parseBody(raw) {
	var body = String(raw === undefined || raw === null ? '' : raw);
	var text = body;
	var embeds = [];
	var t = body.trim();
	if (t.charAt(0) === '{' && t.charAt(t.length - 1) === '}') {
		try {
			var decoded = t;
			try {
				decoded = decodeURIComponent(t);
			} catch (e) {
				decoded = t;
			}
			var obj = JSON.parse(decoded);
			if (typeof obj.Text === 'string') text = obj.Text;
			if (Array.isArray(obj.Embeds)) {
				embeds = obj.Embeds.filter(function (s) {
					return typeof s === 'string' && s.trim();
				});
			}
		} catch (e) {
			text = body;
			embeds = [];
		}
	}
	return { text: text, embeds: embeds };
}

function buildResult(raw) {
	var parsed = parseBody(raw);
	var chunks = splitText(parsed.text || EMPTY_REPLY);
	var embeds = parsed.embeds.slice(0, MAX_EMBEDS).map(function (d) {
		return { description: d.slice(0, MAX_EMBED_DESCRIPTION) };
	});
	var rest = chunks.slice(1);
	var followups = rest.slice(0, MAX_FOLLOWUPS).map(function (c) {
		return { content: c };
	});
	if (rest.length > MAX_FOLLOWUPS) {
		followups[MAX_FOLLOWUPS - 1].content += CUT_NOTE;
	}
	return { content: chunks[0], embeds: embeds, followups: followups };
}

function failedReply(status) {
	return 'Failed to get an AI response. Status: ' + status;
}

function errorReply(message) {
	return 'Error contacting the AI service: ' + message;
}

function replyFor(item) {
	var e = (item && item.error) || {};
	var status = e.httpCode || e.status || e.statusCode;
	if (status) return failedReply(status);
	return errorReply(e.message || 'unknown error');
}

if (typeof module !== 'undefined')
	module.exports = {
		buildPromptUrl,
		splitText,
		parseBody,
		buildResult,
		replyFor,
		NOT_CONFIGURED,
		EMPTY_REPLY,
		CUT_NOTE,
		failedReply,
		errorReply,
	};
