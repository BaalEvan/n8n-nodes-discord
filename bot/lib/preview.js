var PREVIEW_MAP = {
	'facebook.com': 'facebed.com',
	'instagram.com': 'vxinstagram.com',
	'twitter.com': 'fxtwitter.com',
	'x.com': 'fxtwitter.com',
};
var NO_URL = 'Please provide a URL.';
var NO_DOMAIN = 'No supported domain found in the URL.';

function trimUrl(raw) {
	var s = raw.replace(/[.,;:!?]+$/, '');
	while (s.slice(-1) === ')' && s.indexOf('(') === -1) {
		s = s.slice(0, -1).replace(/[.,;:!?]+$/, '');
	}
	return s;
}

function previewLink(text) {
	var input = String(text === undefined || text === null ? '' : text).trim();
	if (!input) return NO_URL;
	var match = input.match(/https?:\/\/[^\s>"]+/i);
	var raw = match ? trimUrl(match[0]) : input;
	var parts = raw.match(/^(https?):\/\/([^/?#]*)([\s\S]*)$/i);
	if (!parts) return NO_DOMAIN;
	var authority = parts[2];
	var at = authority.lastIndexOf('@');
	var userinfo = at === -1 ? '' : authority.slice(0, at + 1);
	var hostPort = authority.slice(at + 1);
	var port = '';
	var colon = hostPort.match(/:\d*$/);
	if (colon) {
		port = colon[0];
		hostPort = hostPort.slice(0, -port.length);
	}
	var host = hostPort.toLowerCase();
	var domains = Object.keys(PREVIEW_MAP);
	for (var i = 0; i < domains.length; i++) {
		var domain = domains[i];
		if (host === domain || host.slice(-(domain.length + 1)) === '.' + domain) {
			return parts[1].toLowerCase() + '://' + userinfo + PREVIEW_MAP[domain] + port + parts[3];
		}
	}
	return NO_DOMAIN;
}

if (typeof module !== 'undefined') module.exports = { previewLink, NO_URL, NO_DOMAIN };
