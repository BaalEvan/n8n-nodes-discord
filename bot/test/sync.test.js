import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const sync = loadModule('sync');
const {
	SYNC_COPY,
	HOOK_NAME,
	hookFailedReply,
	startedReply,
	startBanner,
	endpoint,
	findPairing,
	checkStart,
	isTextChannel,
	checkChannels,
	discordError,
	pickHook,
	hookStep,
	resolveHook,
	newPairingId,
	buildPairing,
	statusText,
	tagCommand,
	stopPlan,
	formatUtcDate,
} = sync;

const A = '111111111111111111';
const B = '222222222222222222';
const GA = '333333333333333333';
const GB = '444444444444444444';
const BOT = '555555555555555555';
const USER = '181510541934592000';

const row = (extra = {}) => ({
	pairingId: 'p1',
	aGuildId: GA,
	aChannelId: A,
	aWebhookId: 'wa',
	aWebhookToken: 'ta',
	aTag: '',
	bGuildId: GB,
	bChannelId: B,
	bWebhookId: 'wb',
	bWebhookToken: 'tb',
	bTag: '',
	createdBy: USER,
	createdUtc: '2026-10-19T12:34:56.000Z',
	note: '',
	...extra,
});

describe('copy', () => {
	it('matches Spuddy', () => {
		expect(SYNC_COPY.notNumeric).toBe('`channel_id` must be a numeric channel id.');
		expect(SYNC_COPY.self).toBe('Cannot sync a channel with itself.');
		expect(SYNC_COPY.alreadySynced).toBe('This channel is already synced. Run `/sync stop` first.');
		expect(SYNC_COPY.remoteSynced).toBe(
			'The remote channel is already synced with another channel.',
		);
		expect(SYNC_COPY.noLocal).toBe('Could not resolve this channel.');
		expect(SYNC_COPY.noRemote).toBe(
			'Could not find the remote channel. Is the bot in that server with access to it?',
		);
		expect(SYNC_COPY.notSynced).toBe('This channel is not synced.');
		expect(SYNC_COPY.stopped).toBe('Sync stopped.');
		expect(SYNC_COPY.stopBanner).toBe('🔌 Sync stopped for this channel.');
		expect(HOOK_NAME).toBe('Spuddy Sync');
		expect(hookFailedReply('Missing Permissions')).toBe(
			'Failed to create webhooks (need Manage Webhooks in both channels): Missing Permissions',
		);
		expect(startedReply('general')).toBe('Sync started with #general.');
		expect(startBanner('general', 'Client Co', USER)).toBe(
			'🔗 This channel is now synced with **#general** on **Client Co**. Messages here are mirrored there and vice-versa. Started by <@181510541934592000>.',
		);
	});
});

describe('endpoint and findPairing', () => {
	it('maps one side of a row to an endpoint', () => {
		expect(endpoint(row({ bTag: '[B]' }), 'b')).toEqual({
			side: 'b',
			guildId: GB,
			channelId: B,
			webhookId: 'wb',
			webhookToken: 'tb',
			tag: '[B]',
		});
	});
	it('treats a null tag as empty', () => {
		expect(endpoint(row({ aTag: null }), 'a').tag).toBe('');
	});
	it('finds the pairing for either channel', () => {
		expect(findPairing([row()], A).pairingId).toBe('p1');
		expect(findPairing([row()], B).pairingId).toBe('p1');
		expect(findPairing([row()], '9')).toBe(null);
	});
	it('ignores empty items from Always Output Data', () => {
		expect(findPairing([{}], A)).toBe(null);
		expect(findPairing([], A)).toBe(null);
		expect(findPairing(undefined, A)).toBe(null);
	});
});

describe('checkStart', () => {
	const ix = (options) => ({ channelId: A, userId: USER, options });
	it('rejects a non-numeric id first', () => {
		expect(checkStart(ix({ channel_id: 'abc' }), [row()])).toEqual({
			reply: SYNC_COPY.notNumeric,
		});
		expect(checkStart(ix({ channel_id: '12345' }), [])).toEqual({ reply: SYNC_COPY.notNumeric });
		expect(checkStart(ix({}), [])).toEqual({ reply: SYNC_COPY.notNumeric });
	});
	it('rejects the current channel', () => {
		expect(checkStart(ix({ channel_id: A }), [])).toEqual({ reply: SYNC_COPY.self });
	});
	it('rejects an already paired channel', () => {
		expect(checkStart(ix({ channel_id: B }), [row()])).toEqual({
			reply: SYNC_COPY.alreadySynced,
		});
	});
	it('passes the remote id and the trimmed note', () => {
		expect(checkStart(ix({ channel_id: ' ' + B + ' ', note: '  client chat ' }), [{}])).toEqual({
			remoteId: B,
			note: 'client chat',
		});
		expect(checkStart(ix({ channel_id: B }), [])).toEqual({ remoteId: B, note: '' });
	});
});

describe('checkChannels', () => {
	const ch = (id, guild, type = 0, name = 'chan-' + id.slice(0, 2)) => ({
		id,
		guild_id: guild,
		type,
		name,
	});
	it('accepts text and announcement channels only', () => {
		expect(isTextChannel(ch(A, GA, 0))).toBe(true);
		expect(isTextChannel(ch(A, GA, 5))).toBe(true);
		expect(isTextChannel(ch(A, GA, 2))).toBe(false);
		expect(isTextChannel({ error: 'x' })).toBe(false);
		expect(isTextChannel(null)).toBe(false);
	});
	it('checks the remote pairing, then the local, then the remote channel', () => {
		const remotePaired = [row({ aChannelId: '777777777777777777' })];
		expect(checkChannels(remotePaired, B, {}, {})).toEqual({ reply: SYNC_COPY.remoteSynced });
		expect(checkChannels([{}], B, { error: 'x' }, ch(B, GB))).toEqual({ reply: SYNC_COPY.noLocal });
		expect(checkChannels([{}], B, ch(A, GA, 4), ch(B, GB))).toEqual({ reply: SYNC_COPY.noLocal });
		expect(checkChannels([{}], B, ch(A, GA), { error: 'x' })).toEqual({
			reply: SYNC_COPY.noRemote,
		});
		expect(checkChannels([{}], B, ch(A, GA), ch(B, GB, 13))).toEqual({
			reply: SYNC_COPY.noRemote,
		});
	});
	it('returns both channels', () => {
		expect(checkChannels([{}], B, ch(A, GA, 0, 'ours'), ch(B, GB, 5, 'theirs'))).toEqual({
			local: { id: A, guildId: GA, name: 'ours' },
			remote: { id: B, guildId: GB, name: 'theirs' },
		});
	});
});

describe('discordError', () => {
	const item = (code, message, status = 404) => ({
		json: { error: 'The resource you are requesting could not be found' },
		error: {
			message: 'The resource you are requesting could not be found',
			description: message,
			context: { data: code === undefined ? undefined : { message, code } },
			cause: { name: 'AxiosError', message: 'Request failed with status code ' + status },
		},
	});
	it('reads the Discord code, message and HTTP status', () => {
		expect(discordError(item(10015, 'Unknown Webhook'))).toEqual({
			code: 10015,
			status: 404,
			message: 'Unknown Webhook',
		});
		expect(discordError(item(50013, 'Missing Permissions', 403))).toEqual({
			code: 50013,
			status: 403,
			message: 'Missing Permissions',
		});
	});
	it('reports code 0 for a 404 without a Discord code', () => {
		expect(discordError(item(0, '404: Not Found'))).toMatchObject({ code: 0, status: 404 });
		expect(discordError(item(undefined, undefined))).toMatchObject({ code: 0, status: 404 });
	});
	it('prefers httpCode when n8n sets it', () => {
		const it2 = item(10008, 'Unknown Message');
		it2.error.httpCode = '404';
		delete it2.error.cause;
		expect(discordError(it2).status).toBe(404);
	});
	it('falls back to the item text and never throws', () => {
		expect(discordError({ json: { error: 'boom' } })).toEqual({
			code: 0,
			status: 0,
			message: 'boom',
		});
		expect(discordError(undefined)).toEqual({ code: 0, status: 0, message: 'unknown error' });
	});
});

describe('hooks', () => {
	const hook = (extra) => ({
		id: 'h1',
		name: HOOK_NAME,
		token: 'tok',
		user: { id: BOT },
		...extra,
	});
	it('reuses only a Spuddy Sync hook with a token made by the bot', () => {
		expect(pickHook([hook()], BOT)).toEqual({ id: 'h1', token: 'tok' });
		expect(pickHook([hook({ name: 'Other' })], BOT)).toBe(null);
		expect(pickHook([hook({ token: undefined })], BOT)).toBe(null);
		expect(pickHook([hook({ user: { id: '1' } })], BOT)).toBe(null);
		expect(pickHook([hook({ user: undefined })], BOT)).toBe(null);
		expect(
			pickHook([hook({ id: 'x', name: 'Other' }), hook({ id: 'h2' }), hook({ id: 'h3' })], BOT),
		).toEqual({ id: 'h2', token: 'tok' });
	});
	it('hookStep turns the list output into hook, create or error', () => {
		expect(hookStep([{ json: hook() }], BOT)).toEqual({ hook: { id: 'h1', token: 'tok' } });
		expect(hookStep([{ json: {} }], BOT)).toEqual({ create: true });
		expect(hookStep([], BOT)).toEqual({ create: true });
		expect(hookStep([{ json: hook({ name: 'x' }) }], BOT)).toEqual({ create: true });
		const failed = {
			json: { error: 'Forbidden' },
			error: {
				description: 'Missing Permissions',
				context: { data: { code: 50013, message: 'Missing Permissions' } },
			},
		};
		expect(hookStep([failed], BOT)).toEqual({ error: 'Missing Permissions' });
	});
	it('resolveHook keeps a picked hook or reads the created one', () => {
		expect(resolveHook({ hook: { id: 'h1', token: 't' } }, null)).toEqual({
			hook: { id: 'h1', token: 't' },
		});
		expect(resolveHook({ error: 'Missing Permissions' }, null)).toEqual({
			error: 'Missing Permissions',
		});
		expect(
			resolveHook({ create: true }, { json: { id: 'n1', token: 'nt', name: HOOK_NAME } }),
		).toEqual({
			hook: { id: 'n1', token: 'nt' },
		});
		const failed = {
			json: { error: 'x' },
			error: {
				context: { data: { code: 30007, message: 'Maximum number of webhooks reached (15)' } },
			},
		};
		expect(resolveHook({ create: true }, failed)).toEqual({
			error: 'Maximum number of webhooks reached (15)',
		});
		expect(resolveHook({ create: true }, { json: { id: 'n1' } })).toEqual({
			error: 'Discord returned no webhook token',
		});
	});
});

describe('buildPairing', () => {
	it('makes a 32-hex pairing id', () => {
		expect(newPairingId()).toMatch(/^[0-9a-f]{32}$/);
		expect(newPairingId()).not.toBe(newPairingId());
		expect(newPairingId(() => 0)).toBe('00000000000040008000000000000000');
	});
	it('stores A = current and B = remote, with banners and the reply', () => {
		const out = buildPairing({
			pairingId: 'pid',
			userId: USER,
			note: 'n',
			now: '2026-10-19T00:00:00.000Z',
			local: { id: A, guildId: GA, name: 'ours' },
			remote: { id: B, guildId: GB, name: 'theirs' },
			localGuildName: 'Our Server',
			remoteGuildName: 'Client Co',
			localHook: { id: 'wa', token: 'ta' },
			remoteHook: { id: 'wb', token: 'tb' },
		});
		expect(out.row).toEqual({
			pairingId: 'pid',
			aGuildId: GA,
			aChannelId: A,
			aWebhookId: 'wa',
			aWebhookToken: 'ta',
			aTag: '',
			bGuildId: GB,
			bChannelId: B,
			bWebhookId: 'wb',
			bWebhookToken: 'tb',
			bTag: '',
			createdBy: USER,
			createdUtc: '2026-10-19T00:00:00.000Z',
			note: 'n',
		});
		expect(out.bannerLocal).toBe(startBanner('theirs', 'Client Co', USER));
		expect(out.bannerRemote).toBe(startBanner('ours', 'Our Server', USER));
		expect(out.reply).toBe('Sync started with #theirs.');
	});
});

describe('statusText', () => {
	it('reports not synced', () => {
		expect(statusText(null, A)).toBe(SYNC_COPY.notSynced);
	});
	it('shows the partner from either side', () => {
		expect(statusText(row(), A)).toBe(
			'🔗 Synced with channel `' +
				B +
				'` (guild `' +
				GB +
				'`).\nStarted by <@' +
				USER +
				'> on 2026-10-19.',
		);
		expect(statusText(row({ note: 'client chat' }), B)).toBe(
			'🔗 Synced with channel `' +
				A +
				'` (guild `' +
				GA +
				'`).\nStarted by <@' +
				USER +
				'> on 2026-10-19.\nNote: client chat',
		);
	});
	it('drops a blank note line', () => {
		expect(statusText(row({ note: '   ' }), A)).not.toContain('Note:');
		expect(statusText(row({ note: null }), A)).not.toContain('Note:');
	});
	it('formats the date in UTC', () => {
		expect(formatUtcDate('2026-10-19T23:59:59.000Z')).toBe('2026-10-19');
		expect(formatUtcDate('2026-10-20T00:30:00+02:00')).toBe('2026-10-19');
		expect(formatUtcDate(new Date(Date.UTC(2026, 0, 2)))).toBe('2026-01-02');
		expect(formatUtcDate('nope')).toBe('unknown date');
		expect(formatUtcDate(null)).toBe('unknown date');
	});
});

describe('tagCommand', () => {
	it('reports not synced', () => {
		expect(tagCommand(null, A, {})).toEqual({ reply: SYNC_COPY.notSynced });
		expect(tagCommand({}, A, {})).toEqual({ reply: SYNC_COPY.notSynced });
	});
	it('shows the current tags from our side', () => {
		expect(tagCommand(row(), A, {})).toEqual({
			reply: 'Current tags — ours: (none), theirs: (none).',
		});
		expect(tagCommand(row({ aTag: '[A]', bTag: null }), B, {})).toEqual({
			reply: 'Current tags — ours: (none), theirs: `[A]`.',
		});
	});
	it('enforces the 32-character limit after trimming', () => {
		const t33 = 'x'.repeat(33);
		expect(tagCommand(row(), A, { ourtag: t33 })).toEqual({
			reply: '`ourtag` must be at most 32 characters.',
		});
		expect(tagCommand(row(), A, { theirtag: t33 })).toEqual({
			reply: '`theirtag` must be at most 32 characters.',
		});
		expect(tagCommand(row(), A, { ourtag: '  ' + 'x'.repeat(32) + '  ' }).update).toEqual({
			aTag: 'x'.repeat(32),
		});
	});
	it('checks length before forbidden words', () => {
		expect(tagCommand(row(), A, { ourtag: 'x'.repeat(40), theirtag: 'clyde' }).reply).toBe(
			'`ourtag` must be at most 32 characters.',
		);
	});
	it('forbids discord and clyde in any case', () => {
		const copy = 'Tags can\'t contain "discord" or "clyde" (Discord webhook restriction).';
		expect(tagCommand(row(), A, { ourtag: 'discordians' }).reply).toBe(copy);
		expect(tagCommand(row(), A, { theirtag: 'CLYDE' }).reply).toBe(copy);
		expect(SYNC_COPY.forbiddenTag).toBe(copy);
	});
	it('needs a partner endpoint', () => {
		expect(tagCommand(row({ bChannelId: '' }), A, { ourtag: 'x' }).reply).toBe(
			"This channel's sync pairing has no partner endpoint.",
		);
	});
	it('updates our and their side and shows the result', () => {
		expect(tagCommand(row(), A, { ourtag: '[A]', theirtag: '[B]' })).toEqual({
			update: { aTag: '[A]', bTag: '[B]' },
			next: { aTag: '[A]', bTag: '[B]' },
			pairingId: 'p1',
			reply: 'Tags updated — ours: `[A]`, theirs: `[B]`.',
		});
		expect(tagCommand(row({ aTag: '[A]', bTag: '[B]' }), B, { ourtag: '-' })).toEqual({
			update: { bTag: '' },
			next: { aTag: '[A]', bTag: '' },
			pairingId: 'p1',
			reply: 'Tags updated — ours: (none), theirs: `[A]`.',
		});
	});
	it('clears with - and keeps a missing tag as null in the shown text', () => {
		const out = tagCommand(row({ aTag: null, bTag: '[B]' }), A, { theirtag: '-' });
		expect(out.next).toEqual({ aTag: '', bTag: '' });
		expect(out.reply).toBe('Tags updated — ours: (none), theirs: (none).');
	});
});

describe('stopPlan', () => {
	it('reports not synced', () => {
		expect(stopPlan(null, A)).toEqual({ reply: SYNC_COPY.notSynced });
	});
	it('returns both endpoints', () => {
		const out = stopPlan(row(), B);
		expect(out.pairingId).toBe('p1');
		expect(out.a.channelId).toBe(A);
		expect(out.b.channelId).toBe(B);
		expect(out.a.webhookId).toBe('wa');
		expect(out.b.webhookId).toBe('wb');
	});
	it('carries no webhook token, only what a delete by ID needs', () => {
		const out = stopPlan(row(), A);
		expect(out.a).toEqual({ side: 'a', channelId: A, webhookId: 'wa' });
		expect(out.b).toEqual({ side: 'b', channelId: B, webhookId: 'wb' });
		expect(JSON.stringify(out)).not.toMatch(/[Tt]oken|"ta"|"tb"/);
	});
});
