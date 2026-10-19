const UPLOAD_LIMIT = 8 * 1024 * 1024;
const MAX_FILES = 10;
const MAX_CONTENT = 2000;
const RETENTION_DAYS = 14;
const MIRROR_EVENTS = ['create', 'update', 'delete'];
const USER_MESSAGE_TYPES = [0, 19];

function filterEvent(input) {
	const event = input && input.event;
	const m = input && input.message;
	if (MIRROR_EVENTS.indexOf(event) === -1) return null;
	if (!m || !m.channel_id) return null;
	if (event !== 'delete') {
		if (!m.author || m.author.bot || m.author.system || m.webhook_id) return null;
	}
	if (event === 'create' && m.type !== undefined && USER_MESSAGE_TYPES.indexOf(m.type) === -1) {
		return null;
	}
	if (event === 'update' && !m.edited_timestamp) return null;
	return { event: event, m: m };
}

function cleanName(s) {
	let n = String(s === undefined || s === null ? '' : s)
		.replace(/discord|clyde/gi, '')
		.trim();
	if (!n) n = 'user';
	return n.length > 80 ? n.slice(0, 80) : n;
}

function mirrorUsername(m, tag) {
	const member = m.member || {};
	const author = m.author || {};
	const display = member.nick || author.global_name || author.username;
	const t = String(tag === undefined || tag === null ? '' : tag).trim();
	return t ? cleanName(t + ' ' + cleanName(display)) : cleanName(display);
}

function avatarUrl(m) {
	const u = m.author || {};
	const member = m.member || {};
	const ext = function (hash) {
		return hash.indexOf('a_') === 0 ? 'gif' : 'png';
	};
	if (member.avatar && m.guild_id) {
		return (
			'https://cdn.discordapp.com/guilds/' +
			m.guild_id +
			'/users/' +
			u.id +
			'/avatars/' +
			member.avatar +
			'.' +
			ext(member.avatar)
		);
	}
	if (u.avatar) {
		return 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.' + ext(u.avatar);
	}
	let index = 0;
	if (u.discriminator && u.discriminator !== '0') {
		index = Number(u.discriminator) % 5;
	} else if (/^\d+$/.test(String(u.id || ''))) {
		index = Number((BigInt(u.id) >> BigInt(22)) % BigInt(6));
	}
	return 'https://cdn.discordapp.com/embed/avatars/' + index + '.png';
}

function splitAttachments(attachments) {
	const list = attachments || [];
	let budget = UPLOAD_LIMIT;
	const upload = [];
	const links = [];
	list.forEach(function (a, i) {
		const size = Number(a && a.size);
		if (i < MAX_FILES && Number.isFinite(size) && size >= 0 && size <= budget) {
			upload.push(a);
			budget -= size;
		} else if (a && a.url !== undefined) {
			links.push(a.url);
		}
	});
	return { upload: upload, links: links };
}

function mirrorContent(text, links) {
	const extra = links || [];
	const body = String(text === undefined || text === null ? '' : text);
	const full = [body].concat(extra).join('\n').trim();
	if (full.length <= MAX_CONTENT) return full;
	const tail = extra.join('\n');
	const room = MAX_CONTENT - (tail ? tail.length + 1 : 0) - 1;
	if (room <= 0) return full.slice(0, MAX_CONTENT);
	const cut = body.trim().slice(0, room) + '…';
	return tail ? cut + '\n' + tail : cut;
}

function target(row, side) {
	const e = endpoint(row, side);
	return {
		side: side,
		channelId: e.channelId,
		webhookId: e.webhookId,
		webhookToken: e.webhookToken,
	};
}

function prepareCreate(m, p) {
	if (!p || !p.pairingId || !m) return null;
	const ch = String(m.channel_id);
	let src;
	if (String(p.aChannelId) === ch) src = 'a';
	else if (String(p.bChannelId) === ch) src = 'b';
	else return null;
	const dst = src === 'a' ? 'b' : 'a';
	if (!p[dst + 'ChannelId']) return null;
	const parts = splitAttachments(m.attachments);
	const content = mirrorContent(m.content, parts.links);
	if (!content && parts.upload.length === 0) return null;
	return {
		pairingId: p.pairingId,
		sourceMessageId: m.id,
		target: target(p, dst),
		username: mirrorUsername(m, p[src + 'Tag']),
		avatarUrl: avatarUrl(m),
		content: content,
		upload: parts.upload,
	};
}

function stripQuery(name) {
	return String(name || '').split('?')[0];
}

function collectFiles(prepared, items) {
	const uploads = prepared.upload || [];
	const files = [];
	const binary = {};
	const failed = [];
	uploads.forEach(function (a, i) {
		const item = (items || [])[i];
		const data = item && !hasError(item) && item.binary && item.binary.data;
		if (!data) {
			failed.push(a.url);
			return;
		}
		const key = 'file' + files.length;
		const copy = Object.assign({}, data);
		copy.fileName = a.filename || stripQuery(data.fileName) || key;
		binary[key] = copy;
		files.push(key);
	});
	const base = String(prepared.content || '');
	const content = failed.length
		? mirrorContent(
				base,
				failed.filter(function (u) {
					return !!u;
				}),
			)
		: base;
	if (!content && files.length === 0) return null;
	const json = Object.assign({}, prepared, { content: content, files: files });
	return { json: json, binary: binary };
}

function mirrorTarget(event, map, p, m) {
	if (!map || !map.mirrorChannelId || !p || !p.pairingId) return null;
	const ch = String(map.mirrorChannelId);
	let side;
	if (String(p.aChannelId) === ch) side = 'a';
	else if (String(p.bChannelId) === ch) side = 'b';
	else return null;
	const msg = m || {};
	return {
		event: event,
		pairingId: p.pairingId,
		sourceMessageId: map.sourceMessageId,
		mirrorMessageId: map.mirrorMessageId,
		target: target(p, side),
		content: mirrorContent(msg.content, splitAttachments(msg.attachments).links),
	};
}

function isWebhookGone(err) {
	return !!err && (err.code === 10015 || (err.status === 404 && !err.code));
}

function isUnknownMessage(err) {
	return !!err && err.code === 10008;
}

function goneDecision(event, err) {
	if (isWebhookGone(err)) return 'recreate';
	if ((event === 'delete' || event === 'update') && isUnknownMessage(err)) return 'done';
	return 'fail';
}

function retentionCutoff(value, now) {
	const raw = value === undefined || value === null ? '' : String(value).trim();
	let days = raw === '' ? NaN : Number(raw);
	if (!Number.isFinite(days) || days < 0) days = RETENTION_DAYS;
	const base = now ? new Date(now) : new Date();
	return new Date(base.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

if (typeof module !== 'undefined')
	module.exports = {
		UPLOAD_LIMIT,
		MAX_FILES,
		MAX_CONTENT,
		filterEvent,
		cleanName,
		mirrorUsername,
		avatarUrl,
		splitAttachments,
		mirrorContent,
		prepareCreate,
		collectFiles,
		mirrorTarget,
		isWebhookGone,
		isUnknownMessage,
		goneDecision,
		retentionCutoff,
	};
