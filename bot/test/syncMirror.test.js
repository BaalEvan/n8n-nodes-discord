import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const {
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
	UPLOAD_LIMIT,
	MAX_FILES,
} = loadModule('syncMirror', ['sync']);

const A = '111111111111111111';
const B = '222222222222222222';
const GA = '333333333333333333';
const USER_ID = '181510541934592000';

const pairing = (extra = {}) => ({
	pairingId: 'p1',
	aGuildId: GA,
	aChannelId: A,
	aWebhookId: 'wa',
	aWebhookToken: 'ta',
	aTag: '',
	bGuildId: '444444444444444444',
	bChannelId: B,
	bWebhookId: 'wb',
	bWebhookToken: 'tb',
	bTag: '',
	...extra,
});
const msg = (extra = {}) => ({
	id: '900000000000000001',
	channel_id: A,
	guild_id: GA,
	content: 'hello',
	author: { id: USER_ID, username: 'baal', global_name: 'Baal', avatar: 'abc' },
	member: { nick: null, avatar: null },
	attachments: [],
	...extra,
});

describe('filterEvent', () => {
	it('passes user messages on create', () => {
		expect(filterEvent({ event: 'create', message: msg() })).toEqual({
			event: 'create',
			m: msg(),
		});
	});
	it('drops bots, system messages, webhooks and messages without a channel', () => {
		expect(filterEvent({ event: 'create', message: msg({ author: { id: '1', bot: true } }) })).toBe(
			null,
		);
		expect(
			filterEvent({ event: 'create', message: msg({ author: { id: '1', system: true } }) }),
		).toBe(null);
		expect(filterEvent({ event: 'create', message: msg({ webhook_id: '5' }) })).toBe(null);
		expect(filterEvent({ event: 'create', message: msg({ author: undefined }) })).toBe(null);
		expect(filterEvent({ event: 'create', message: { id: '1' } })).toBe(null);
		expect(filterEvent({ event: 'create' })).toBe(null);
		expect(filterEvent(undefined)).toBe(null);
	});
	it('needs edited_timestamp on update', () => {
		expect(filterEvent({ event: 'update', message: msg() })).toBe(null);
		expect(
			filterEvent({ event: 'update', message: msg({ edited_timestamp: '2026-10-19T00:00:00Z' }) }),
		).not.toBe(null);
		expect(
			filterEvent({
				event: 'update',
				message: msg({ edited_timestamp: '2026-10-19T00:00:00Z', webhook_id: '5' }),
			}),
		).toBe(null);
	});
	it('passes deletes without an author', () => {
		const m = { id: '1', channel_id: A, guild_id: GA };
		expect(filterEvent({ event: 'delete', message: m })).toEqual({ event: 'delete', m });
	});
	it('drops unknown events', () => {
		expect(filterEvent({ event: 'bulk', message: msg() })).toBe(null);
	});
});

describe('usernames', () => {
	it('removes discord and clyde, trims, and falls back to user', () => {
		expect(cleanName('Discord Fan')).toBe('Fan');
		expect(cleanName('  cLyDeDISCORD  ')).toBe('user');
		expect(cleanName('')).toBe('user');
		expect(cleanName(null)).toBe('user');
		expect(cleanName('x'.repeat(90))).toBe('x'.repeat(80));
	});
	it('prefers nick, then global name, then username', () => {
		expect(mirrorUsername(msg({ member: { nick: 'Nick' } }), '')).toBe('Nick');
		expect(mirrorUsername(msg(), '')).toBe('Baal');
		expect(mirrorUsername(msg({ author: { id: '1', username: 'u', global_name: null } }), '')).toBe(
			'u',
		);
		expect(mirrorUsername(msg({ member: undefined }), '')).toBe('Baal');
	});
	it('puts the source tag in front and sanitizes the result', () => {
		expect(mirrorUsername(msg(), '[PTTO]')).toBe('[PTTO] Baal');
		expect(mirrorUsername(msg(), '  [A]  ')).toBe('[A] Baal');
		expect(mirrorUsername(msg({ member: { nick: 'Discord' } }), '[A]')).toBe('[A] user');
		expect(mirrorUsername(msg({ member: { nick: 'y'.repeat(80) } }), '[TAG]')).toBe(
			('[TAG] ' + 'y'.repeat(80)).slice(0, 80),
		);
	});
});

describe('avatarUrl', () => {
	it('uses the server avatar first', () => {
		expect(avatarUrl(msg({ member: { avatar: 'srv' } }))).toBe(
			`https://cdn.discordapp.com/guilds/${GA}/users/${USER_ID}/avatars/srv.png`,
		);
		expect(avatarUrl(msg({ member: { avatar: 'a_srv' } }))).toBe(
			`https://cdn.discordapp.com/guilds/${GA}/users/${USER_ID}/avatars/a_srv.gif`,
		);
	});
	it('then the user avatar', () => {
		expect(avatarUrl(msg())).toBe(`https://cdn.discordapp.com/avatars/${USER_ID}/abc.png`);
		expect(avatarUrl(msg({ author: { id: USER_ID, avatar: 'a_x' } }))).toBe(
			`https://cdn.discordapp.com/avatars/${USER_ID}/a_x.gif`,
		);
	});
	it("then Discord's default avatar", () => {
		const expected = Number((BigInt(USER_ID) >> 22n) % 6n);
		expect(avatarUrl(msg({ author: { id: USER_ID, avatar: null } }))).toBe(
			`https://cdn.discordapp.com/embed/avatars/${expected}.png`,
		);
		expect(avatarUrl(msg({ author: { id: USER_ID, avatar: null, discriminator: '0' } }))).toBe(
			`https://cdn.discordapp.com/embed/avatars/${expected}.png`,
		);
		expect(avatarUrl(msg({ author: { id: USER_ID, avatar: null, discriminator: '1337' } }))).toBe(
			'https://cdn.discordapp.com/embed/avatars/2.png',
		);
	});
	it('ignores a server avatar without a guild id', () => {
		expect(avatarUrl(msg({ guild_id: undefined, member: { avatar: 'srv' } }))).toBe(
			`https://cdn.discordapp.com/avatars/${USER_ID}/abc.png`,
		);
	});
});

describe('attachments', () => {
	const att = (i, size) => ({
		id: 'a' + i,
		filename: 'f' + i + '.png',
		size,
		url: 'https://cdn.discordapp.com/attachments/x/f' + i + '.png?ex=1',
	});
	it('uploads up to 8 MB together and links the rest', () => {
		expect(UPLOAD_LIMIT).toBe(8 * 1024 * 1024);
		const out = splitAttachments([att(0, 3e6), att(1, 3e6), att(2, 3e6), att(3, 1e5)]);
		expect(out.upload.map((a) => a.id)).toEqual(['a0', 'a1', 'a3']);
		expect(out.links).toEqual([att(2).url]);
	});
	it('links one file over 8 MB', () => {
		const out = splitAttachments([att(0, 20 * 1024 * 1024)]);
		expect(out.upload).toEqual([]);
		expect(out.links).toEqual([att(0).url]);
	});
	it('accepts exactly 8 MB', () => {
		expect(splitAttachments([att(0, UPLOAD_LIMIT)]).upload).toHaveLength(1);
	});
	it('uploads at most 10 files', () => {
		expect(MAX_FILES).toBe(10);
		const list = Array.from({ length: 12 }, (_, i) => att(i, 10));
		const out = splitAttachments(list);
		expect(out.upload).toHaveLength(10);
		expect(out.links).toEqual([att(10).url, att(11).url]);
	});
	it('handles no attachments and a missing size', () => {
		expect(splitAttachments(undefined)).toEqual({ upload: [], links: [] });
		expect(splitAttachments([{ id: 'x', url: 'u' }])).toEqual({ upload: [], links: ['u'] });
	});
});

describe('mirrorContent', () => {
	it('joins text and links and trims', () => {
		expect(mirrorContent('hi', ['u1', 'u2'])).toBe('hi\nu1\nu2');
		expect(mirrorContent('', ['u1'])).toBe('u1');
		expect(mirrorContent(null, [])).toBe('');
		expect(mirrorContent('  hi  ', [])).toBe('hi');
	});
	it('cuts the text so the whole message stays within 2000 characters, keeping the links', () => {
		const out = mirrorContent('x'.repeat(4000), ['https://l1']);
		expect(out.length).toBe(2000);
		expect(out.endsWith('…\nhttps://l1')).toBe(true);
		expect(mirrorContent('x'.repeat(2000), [])).toBe('x'.repeat(2000));
		expect(mirrorContent('x'.repeat(2001), []).length).toBe(2000);
	});
});

describe('prepareCreate', () => {
	it('targets the other side with name, avatar and content', () => {
		const out = prepareCreate(msg(), pairing({ aTag: '[A]' }));
		expect(out).toEqual({
			pairingId: 'p1',
			sourceMessageId: '900000000000000001',
			target: { side: 'b', channelId: B, webhookId: 'wb', webhookToken: 'tb' },
			username: '[A] Baal',
			avatarUrl: `https://cdn.discordapp.com/avatars/${USER_ID}/abc.png`,
			content: 'hello',
			upload: [],
		});
	});
	it('mirrors B to A with the B tag', () => {
		const out = prepareCreate(msg({ channel_id: B }), pairing({ aTag: '[A]', bTag: '[B]' }));
		expect(out.target).toEqual({ side: 'a', channelId: A, webhookId: 'wa', webhookToken: 'ta' });
		expect(out.username).toBe('[B] Baal');
	});
	it('returns null when there is nothing to send or no partner', () => {
		expect(prepareCreate(msg({ content: '' }), pairing())).toBe(null);
		expect(prepareCreate(msg(), pairing({ bChannelId: '' }))).toBe(null);
		expect(prepareCreate(msg({ channel_id: '9' }), pairing())).toBe(null);
		expect(prepareCreate(msg(), null)).toBe(null);
	});
	it('keeps files to upload and adds big ones as links', () => {
		const out = prepareCreate(
			msg({
				content: '',
				attachments: [
					{ id: '1', filename: 'a.png', size: 10, url: 'https://cdn/a.png' },
					{ id: '2', filename: 'b.mp4', size: 20 * 1024 * 1024, url: 'https://cdn/b.mp4' },
				],
			}),
			pairing(),
		);
		expect(out.upload).toEqual([
			{ id: '1', filename: 'a.png', size: 10, url: 'https://cdn/a.png' },
		]);
		expect(out.content).toBe('https://cdn/b.mp4');
	});
});

describe('collectFiles', () => {
	const prepared = {
		pairingId: 'p1',
		content: 'hi',
		upload: [
			{ filename: 'a.png', url: 'https://cdn/a.png' },
			{ filename: 'b.png', url: 'https://cdn/b.png' },
		],
	};
	it('renames each downloaded binary to fileN with the original filename', () => {
		const out = collectFiles(prepared, [
			{
				json: {},
				binary: { data: { data: 'AA==', mimeType: 'image/png', fileName: 'a.png?ex=1' } },
			},
			{ json: {}, binary: { data: { data: 'BB==', mimeType: 'image/png' } } },
		]);
		expect(out.json.files).toEqual(['file0', 'file1']);
		expect(out.json.content).toBe('hi');
		expect(out.binary.file0).toEqual({ data: 'AA==', mimeType: 'image/png', fileName: 'a.png' });
		expect(out.binary.file1.fileName).toBe('b.png');
	});
	it('links a file whose download failed', () => {
		const out = collectFiles(prepared, [
			{ json: { error: 'x' } },
			{ json: {}, binary: { data: { data: 'BB==' } } },
		]);
		expect(out.json.files).toEqual(['file0']);
		expect(out.binary.file0.fileName).toBe('b.png');
		expect(out.json.content).toBe('hi\nhttps://cdn/a.png');
	});
	it('returns null when nothing is left to send', () => {
		expect(
			collectFiles({ ...prepared, content: '' }, [{ json: { error: 'x' } }, { json: {} }]),
		).toEqual(expect.objectContaining({ json: expect.objectContaining({ files: [] }) }));
		expect(
			collectFiles({ content: '', upload: [{ filename: 'a', url: '' }] }, [
				{ json: { error: 'x' } },
			]),
		).toBe(null);
	});
});

describe('mirrorTarget', () => {
	const map = { sourceMessageId: 's1', pairingId: 'p1', mirrorChannelId: B, mirrorMessageId: 'm1' };
	it('picks the endpoint of the mirror channel', () => {
		expect(mirrorTarget('update', map, pairing(), msg({ content: 'edited' }))).toEqual({
			event: 'update',
			pairingId: 'p1',
			sourceMessageId: 's1',
			mirrorMessageId: 'm1',
			target: { side: 'b', channelId: B, webhookId: 'wb', webhookToken: 'tb' },
			content: 'edited',
		});
		expect(
			mirrorTarget('delete', { ...map, mirrorChannelId: A }, pairing(), { id: 's1' }).target.side,
		).toBe('a');
	});
	it('cuts edited text to 2000 characters', () => {
		expect(
			mirrorTarget('update', map, pairing(), msg({ content: 'x'.repeat(3000) })).content,
		).toHaveLength(2000);
	});
	it('returns null without a matching endpoint', () => {
		expect(mirrorTarget('update', { ...map, mirrorChannelId: '9' }, pairing(), msg())).toBe(null);
		expect(mirrorTarget('update', map, null, msg())).toBe(null);
		expect(mirrorTarget('update', {}, pairing(), msg())).toBe(null);
	});
});

describe('webhook errors', () => {
	it('treats 10015 and a 404 without a code as gone', () => {
		expect(isWebhookGone({ code: 10015, status: 404 })).toBe(true);
		expect(isWebhookGone({ code: 0, status: 404 })).toBe(true);
		expect(isWebhookGone({ code: 10008, status: 404 })).toBe(false);
		expect(isWebhookGone({ code: 50013, status: 403 })).toBe(false);
		expect(isWebhookGone({ code: 0, status: 500 })).toBe(false);
	});
	it('knows Unknown Message', () => {
		expect(isUnknownMessage({ code: 10008, status: 404 })).toBe(true);
		expect(isUnknownMessage({ code: 10015, status: 404 })).toBe(false);
	});
	it('decides recreate, done or fail per event', () => {
		expect(goneDecision('create', { code: 10015, status: 404 })).toBe('recreate');
		expect(goneDecision('update', { code: 0, status: 404 })).toBe('recreate');
		expect(goneDecision('delete', { code: 10008, status: 404 })).toBe('done');
		expect(goneDecision('update', { code: 10008, status: 404 })).toBe('fail');
		expect(goneDecision('create', { code: 50035, status: 400 })).toBe('fail');
	});
});

describe('retentionCutoff', () => {
	const now = new Date('2026-10-19T03:30:00.000Z');
	it('defaults to 14 days', () => {
		expect(retentionCutoff(undefined, now)).toBe('2026-10-05T03:30:00.000Z');
		expect(retentionCutoff('', now)).toBe('2026-10-05T03:30:00.000Z');
		expect(retentionCutoff('abc', now)).toBe('2026-10-05T03:30:00.000Z');
		expect(retentionCutoff('-1', now)).toBe('2026-10-05T03:30:00.000Z');
	});
	it('reads a configured number of days, 0 included', () => {
		expect(retentionCutoff('0', now)).toBe('2026-10-19T03:30:00.000Z');
		expect(retentionCutoff('30', now)).toBe('2026-09-19T03:30:00.000Z');
		expect(retentionCutoff(1, now)).toBe('2026-10-18T03:30:00.000Z');
	});
});
