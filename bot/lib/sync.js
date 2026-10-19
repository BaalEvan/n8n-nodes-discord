const SYNC_COPY = {
	notNumeric: '`channel_id` must be a numeric channel id.',
	self: 'Cannot sync a channel with itself.',
	alreadySynced: 'This channel is already synced. Run `/sync stop` first.',
	remoteSynced: 'The remote channel is already synced with another channel.',
	noLocal: 'Could not resolve this channel.',
	noRemote: 'Could not find the remote channel. Is the bot in that server with access to it?',
	notSynced: 'This channel is not synced.',
	stopped: 'Sync stopped.',
	stopBanner: '🔌 Sync stopped for this channel.',
	forbiddenTag: 'Tags can\'t contain "discord" or "clyde" (Discord webhook restriction).',
	noPartner: "This channel's sync pairing has no partner endpoint.",
};
const HOOK_NAME = 'Spuddy Sync';
const CHANNEL_ID_RE = /^\d{15,21}$/;

function hookFailedReply(message) {
	return 'Failed to create webhooks (need Manage Webhooks in both channels): ' + message;
}

function startedReply(remoteName) {
	return 'Sync started with #' + remoteName + '.';
}

function startBanner(channelName, guildName, userId) {
	return (
		'🔗 This channel is now synced with **#' +
		channelName +
		'** on **' +
		guildName +
		'**. Messages here are mirrored there and vice-versa. Started by <@' +
		userId +
		'>.'
	);
}

function str(v) {
	return v === undefined || v === null ? '' : String(v);
}

function endpoint(row, side) {
	return {
		side: side,
		guildId: str(row[side + 'GuildId']),
		channelId: str(row[side + 'ChannelId']),
		webhookId: str(row[side + 'WebhookId']),
		webhookToken: str(row[side + 'WebhookToken']),
		tag: str(row[side + 'Tag']),
	};
}

function findPairing(rows, channelId) {
	const id = str(channelId);
	if (!id) return null;
	const found = (rows || []).find(function (r) {
		return r && r.pairingId && (str(r.aChannelId) === id || str(r.bChannelId) === id);
	});
	return found || null;
}

function localSide(row, channelId) {
	return str(row.aChannelId) === str(channelId) ? 'a' : 'b';
}

function checkStart(interaction, pairingRows) {
	const ix = interaction || {};
	const options = ix.options || {};
	const remoteId = str(options.channel_id).trim();
	if (!CHANNEL_ID_RE.test(remoteId)) return { reply: SYNC_COPY.notNumeric };
	if (remoteId === str(ix.channelId)) return { reply: SYNC_COPY.self };
	if (findPairing(pairingRows, ix.channelId)) return { reply: SYNC_COPY.alreadySynced };
	return { remoteId: remoteId, note: str(options.note).trim() };
}

function isTextChannel(ch) {
	return !!ch && !ch.error && !!ch.id && (ch.type === 0 || ch.type === 5);
}

function checkChannels(remoteRows, remoteId, localChannel, remoteChannel) {
	if (findPairing(remoteRows, remoteId)) return { reply: SYNC_COPY.remoteSynced };
	if (!isTextChannel(localChannel)) return { reply: SYNC_COPY.noLocal };
	if (!isTextChannel(remoteChannel)) return { reply: SYNC_COPY.noRemote };
	const pick = function (ch) {
		return { id: str(ch.id), guildId: str(ch.guild_id), name: str(ch.name) };
	};
	return { local: pick(localChannel), remote: pick(remoteChannel) };
}

function discordError(item) {
	const e = (item && item.error) || {};
	const data = (e.context && e.context.data) || {};
	const code = Number(data.code) || 0;
	let status = Number(e.httpCode) || 0;
	if (!status) {
		const m = /status code (\d{3})/.exec(str(e.cause && e.cause.message));
		if (m) status = Number(m[1]);
	}
	const message =
		str(data.message) ||
		str(e.description) ||
		str(e.message) ||
		str(item && item.json && item.json.error) ||
		'unknown error';
	return { code: code, status: status, message: message };
}

function hasError(item) {
	return !!(item && (item.error || (item.json && item.json.error)));
}

function pickHook(hooks, botUserId) {
	const found = (hooks || []).find(function (h) {
		return h && h.name === HOOK_NAME && !!h.token && !!h.user && str(h.user.id) === str(botUserId);
	});
	return found ? { id: str(found.id), token: str(found.token) } : null;
}

function hookStep(items, botUserId) {
	const list = items || [];
	const failed = list.find(hasError);
	if (failed) return { error: discordError(failed).message };
	const hook = pickHook(
		list.map(function (i) {
			return i && i.json;
		}),
		botUserId,
	);
	return hook ? { hook: hook } : { create: true };
}

function resolveHook(step, createdItem) {
	if (step && step.hook) return { hook: step.hook };
	if (step && step.error) return { error: step.error };
	if (hasError(createdItem)) return { error: discordError(createdItem).message };
	const created = (createdItem && createdItem.json) || {};
	if (!created.id || !created.token) return { error: 'Discord returned no webhook token' };
	return { hook: { id: str(created.id), token: str(created.token) } };
}

function newPairingId(random) {
	const rnd = random || Math.random;
	let out = '';
	for (let i = 0; i < 32; i++) {
		let n = Math.floor(rnd() * 16) & 15;
		if (i === 12) n = 4;
		if (i === 16) n = (n & 3) | 8;
		out += n.toString(16);
	}
	return out;
}

function buildPairing(p) {
	const row = {
		pairingId: p.pairingId,
		aGuildId: str(p.local.guildId),
		aChannelId: str(p.local.id),
		aWebhookId: str(p.localHook.id),
		aWebhookToken: str(p.localHook.token),
		aTag: '',
		bGuildId: str(p.remote.guildId),
		bChannelId: str(p.remote.id),
		bWebhookId: str(p.remoteHook.id),
		bWebhookToken: str(p.remoteHook.token),
		bTag: '',
		createdBy: str(p.userId),
		createdUtc: p.now,
		note: str(p.note),
	};
	return {
		row: row,
		bannerLocal: startBanner(p.remote.name, p.remoteGuildName, p.userId),
		bannerRemote: startBanner(p.local.name, p.localGuildName, p.userId),
		reply: startedReply(p.remote.name),
	};
}

function formatUtcDate(x) {
	if (x === null || x === undefined || x === '') return 'unknown date';
	const d = new Date(x);
	return isNaN(d.getTime()) ? 'unknown date' : d.toISOString().slice(0, 10);
}

function statusText(row, channelId) {
	if (!row || !row.pairingId) return SYNC_COPY.notSynced;
	const partnerSide = localSide(row, channelId) === 'a' ? 'b' : 'a';
	const partner = endpoint(row, partnerSide);
	const lines = [
		'🔗 Synced with channel `' + partner.channelId + '` (guild `' + partner.guildId + '`).',
		'Started by <@' + str(row.createdBy) + '> on ' + formatUtcDate(row.createdUtc) + '.',
	];
	if (str(row.note).trim()) lines.push('Note: ' + str(row.note));
	return lines.join('\n');
}

function tagCommand(row, channelId, options) {
	if (!row || !row.pairingId) return { reply: SYNC_COPY.notSynced };
	const o = options || {};
	const ourSide = localSide(row, channelId);
	const theirSide = ourSide === 'a' ? 'b' : 'a';
	const show = function (t) {
		return t ? '`' + t + '`' : '(none)';
	};
	const rawOur = o.ourtag === undefined || o.ourtag === null ? null : String(o.ourtag);
	const rawTheir = o.theirtag === undefined || o.theirtag === null ? null : String(o.theirtag);

	if (rawOur === null && rawTheir === null) {
		return {
			reply:
				'Current tags — ours: ' +
				show(row[ourSide + 'Tag']) +
				', theirs: ' +
				show(row[theirSide + 'Tag']) +
				'.',
		};
	}
	const named = [
		['ourtag', rawOur],
		['theirtag', rawTheir],
	];
	for (let i = 0; i < named.length; i++) {
		const v = named[i][1];
		if (v !== null && v !== '-' && v.trim().length > 32) {
			return { reply: '`' + named[i][0] + '` must be at most 32 characters.' };
		}
	}
	for (let i = 0; i < named.length; i++) {
		const v = named[i][1];
		if (v !== null && v !== '-' && /discord|clyde/i.test(v))
			return { reply: SYNC_COPY.forbiddenTag };
	}
	if (!row[theirSide + 'ChannelId']) return { reply: SYNC_COPY.noPartner };

	const norm = function (v) {
		return v === '-' ? '' : v.trim();
	};
	const update = {};
	if (rawOur !== null) update[ourSide + 'Tag'] = norm(rawOur);
	if (rawTheir !== null) update[theirSide + 'Tag'] = norm(rawTheir);
	const next = {
		aTag: 'aTag' in update ? update.aTag : str(row.aTag),
		bTag: 'bTag' in update ? update.bTag : str(row.bTag),
	};
	return {
		update: update,
		next: next,
		pairingId: row.pairingId,
		reply:
			'Tags updated — ours: ' +
			show(next[ourSide + 'Tag']) +
			', theirs: ' +
			show(next[theirSide + 'Tag']) +
			'.',
	};
}

function stopPlan(row, channelId) {
	if (!row || !row.pairingId) return { reply: SYNC_COPY.notSynced };
	const forDelete = function (side) {
		const e = endpoint(row, side);
		return { side: side, channelId: e.channelId, webhookId: e.webhookId };
	};
	return {
		pairingId: row.pairingId,
		a: forDelete('a'),
		b: forDelete('b'),
		channelId: str(channelId),
	};
}

if (typeof module !== 'undefined')
	module.exports = {
		SYNC_COPY,
		HOOK_NAME,
		hookFailedReply,
		startedReply,
		startBanner,
		endpoint,
		findPairing,
		localSide,
		checkStart,
		isTextChannel,
		checkChannels,
		discordError,
		hasError,
		pickHook,
		hookStep,
		resolveHook,
		newPairingId,
		buildPairing,
		formatUtcDate,
		statusText,
		tagCommand,
		stopPlan,
	};
