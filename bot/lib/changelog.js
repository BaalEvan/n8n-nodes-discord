var REPLY_OK = 'Asked backend for changelog';

function buildChangelogUrl(base, buildid, skipai) {
	var root = String(base === undefined || base === null ? '' : base).trim();
	if (!root) return '';
	var url =
		root.replace(/\/+$/, '') +
		'/webhook/hg-build-hook?BuildID=' +
		encodeURIComponent(String(buildid));
	if (skipai !== undefined && skipai !== null) url += '&SkipAI=' + (skipai ? 'True' : '');
	return url;
}

function failedReply(status) {
	return 'Failed to fetch changelog. Status: ' + status;
}

function errorReply(message) {
	return 'Error fetching changelog: ' + message;
}

function replyFor(item) {
	var e = (item && item.error) || {};
	var status = e.httpCode || e.status || e.statusCode;
	if (status) return failedReply(status);
	return errorReply(e.message || 'unknown error');
}

if (typeof module !== 'undefined')
	module.exports = { buildChangelogUrl, replyFor, REPLY_OK, failedReply, errorReply };
