import { describe, it, expect } from 'vitest';
import { buildAll } from '../build-workflows.mjs';
const path = require('path');
const { loadModule } = require('./load.js');
const { parseDefinition } = loadModule('definition');
const { SYNC_COPY, startBanner } = loadModule('sync');

const built = buildAll(path.join(__dirname, '..'));
const cmd = built['commands/sync'];
const mirror = built['listeners/sync-mirror'];

const A = '111111111111111111';
const B = '222222222222222222';
const GA = '333333333333333333';
const GB = '444444444444444444';
const BOT = '555555555555555555';
const USER = '181510541934592000';

const node = (wf, name) => {
	const n = wf.nodes.find((x) => x.name === name);
	if (!n) throw new Error('no node ' + name + ' in ' + wf.name);
	return n;
};
const targets = (wf, from, output = 0) =>
	((wf.connections[from] && wf.connections[from].main[output]) || []).map((c) => c.node);

// Runs a built Code node with stand-ins for $ and $input. Items may carry .error and .binary.
// $('X') for a node missing from `nodes` throws like n8n does for an unexecuted node.
function runCode(wf, name, { nodes = {}, input = [] } = {}) {
	const pick = (items) => ({ first: () => items[0], all: () => items, item: items[0] });
	const $ = (n) => {
		if (!nodes[n]) throw new Error(`Node '${n}' hasn't been executed`);
		return pick(nodes[n]);
	};
	const code = node(wf, name).parameters.jsCode;
	return new Function('$', '$input', code)($, pick(input));
}

const trigger = (subcommand, options = {}, channelId = A) => [
	{
		json: {
			mode: 'command',
			interaction: { channelId, userId: USER, subcommand, options, guildId: GA },
		},
	},
];
const row = (extra = {}) => ({
	id: 1,
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
	createdUtc: '2026-10-19T10:00:00.000Z',
	note: '',
	...extra,
});
const apiError = (code, message, status = 404) => ({
	json: { error: 'n8n says no' },
	error: {
		message: 'n8n says no',
		description: message,
		context: { data: { code, message } },
		cause: { message: 'Request failed with status code ' + status },
	},
});
const NONE_MENTIONS = { values: { parse: [], roles: '', users: '', repliedUser: true } };

describe('Discord Command: sync', () => {
	it('is a tagged command with the recipe definition', () => {
		expect(cmd.name).toBe('Discord Command: sync');
		expect(cmd.tags.map((t) => t.name)).toEqual(['discord-command']);
		const parsed = parseDefinition(node(cmd, 'Command Definition').parameters.jsonOutput);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual({
			name: 'sync',
			description: 'Bridge this channel with a channel on another server',
			options: [
				{
					type: 1,
					name: 'start',
					description: 'Pair this channel with a remote channel by id',
					options: [
						{
							type: 3,
							name: 'channel_id',
							description: "The remote channel's id (Developer Mode → Copy Channel ID)",
							required: true,
						},
						{
							type: 3,
							name: 'note',
							description: 'Optional note describing this pairing',
							required: false,
						},
					],
				},
				{ type: 1, name: 'stop', description: 'Stop syncing this channel' },
				{
					type: 1,
					name: 'status',
					description: 'Show whether this channel is synced and with which channel',
				},
				{
					type: 1,
					name: 'tag',
					description: 'Set display tags for synced usernames (use - to clear)',
					options: [
						{
							type: 3,
							name: 'ourtag',
							description:
								'Tag prepended to usernames from this channel (e.g. [PTTO]). Use - to clear.',
							required: false,
						},
						{
							type: 3,
							name: 'theirtag',
							description:
								'Tag prepended to usernames from the partner channel (e.g. [THEM]). Use - to clear.',
							required: false,
						},
					],
				},
			],
			ephemeral: true,
			whitelist: { users: ['181510541934592000'], roles: [] },
		});
	});

	it('looks up the pairing for either side, then switches on the subcommand', () => {
		expect(targets(cmd, 'When called by another workflow')).toEqual(['Command Definition']);
		expect(targets(cmd, 'Switch on mode', 0)).toEqual(['Find Pairing']);
		const find = node(cmd, 'Find Pairing');
		expect(find.parameters.dataTableId.value).toBe('sync_pairings');
		expect(find.parameters.matchType).toBe('anyCondition');
		expect(find.parameters.filters.conditions.map((c) => [c.keyName, c.condition])).toEqual([
			['aChannelId', 'eq'],
			['bChannelId', 'eq'],
		]);
		for (const c of find.parameters.filters.conditions) {
			expect(c.keyValue).toContain(
				"$('When called by another workflow').first().json.interaction.channelId",
			);
		}
		expect(find.parameters.limit).toBe(1);
		expect(find.alwaysOutputData).toBe(true);
		expect(targets(cmd, 'Find Pairing')).toEqual(['Switch on subcommand']);
		const rules = node(cmd, 'Switch on subcommand').parameters.rules.values;
		expect(rules.map((r) => r.outputKey)).toEqual(['start', 'stop', 'status', 'tag']);
		for (const r of rules) {
			expect(r.conditions.conditions[0].leftValue).toContain('interaction.subcommand');
		}
		expect(targets(cmd, 'Switch on subcommand', 0)).toEqual(['Validate Start']);
		expect(targets(cmd, 'Switch on subcommand', 1)).toEqual(['Stop Check']);
		expect(targets(cmd, 'Switch on subcommand', 2)).toEqual(['Status']);
		expect(targets(cmd, 'Switch on subcommand', 3)).toEqual(['Tag']);
	});

	it('Reply turns a reply text into the message', () => {
		expect(node(cmd, 'Reply').parameters.jsonOutput).toBe(
			'={{ JSON.stringify({ content: $json.reply }) }}',
		);
	});

	describe('start', () => {
		it('validates in Spuddy order', () => {
			const run = (opts, pairing = [{ json: {} }]) =>
				runCode(cmd, 'Validate Start', {
					nodes: { 'When called by another workflow': trigger('start', opts) },
					input: pairing,
				})[0].json;
			expect(run({ channel_id: 'abc' })).toEqual({ ok: false, reply: SYNC_COPY.notNumeric });
			expect(run({ channel_id: A })).toEqual({ ok: false, reply: SYNC_COPY.self });
			expect(run({ channel_id: B }, [{ json: row() }])).toEqual({
				ok: false,
				reply: SYNC_COPY.alreadySynced,
			});
			expect(run({ channel_id: B, note: ' n ' })).toEqual({ ok: true, remoteId: B, note: 'n' });
			expect(targets(cmd, 'Validate Start')).toEqual(['Start OK?']);
			expect(targets(cmd, 'Start OK?', 0)).toEqual(['Find Remote Pairing']);
			expect(targets(cmd, 'Start OK?', 1)).toEqual(['Reply']);
		});

		it('looks up the remote pairing and both channels', () => {
			const find = node(cmd, 'Find Remote Pairing');
			expect(find.parameters.dataTableId.value).toBe('sync_pairings');
			expect(find.parameters.matchType).toBe('anyCondition');
			expect(find.parameters.filters.conditions.map((c) => c.keyName)).toEqual([
				'aChannelId',
				'bChannelId',
			]);
			expect(find.parameters.filters.conditions[0].keyValue).toContain("$('Validate Start')");
			expect(find.alwaysOutputData).toBe(true);
			expect(find.parameters.limit).toBe(1);
			expect(targets(cmd, 'Find Remote Pairing')).toEqual(['Get Local Channel']);
			for (const [name, expr] of [
				['Get Local Channel', 'interaction.channelId'],
				['Get Remote Channel', "$('Validate Start').first().json.remoteId"],
			]) {
				const n = node(cmd, name);
				expect(n.type).toBe('CUSTOM.discord');
				expect([n.parameters.resource, n.parameters.operation]).toEqual(['channel', 'get']);
				expect(n.parameters.channelId).toContain(expr);
				expect(n.onError).toBe('continueRegularOutput');
			}
			expect(targets(cmd, 'Get Local Channel')).toEqual(['Get Remote Channel']);
			expect(targets(cmd, 'Get Remote Channel')).toEqual(['Check Channels']);
		});

		it('Check Channels gives copy 4, 5 and 6 in order', () => {
			const ch = (id, guild, type = 0, name = 'c') => [
				{ json: { id, guild_id: guild, type, name } },
			];
			const run = (remoteRows, local, remote) =>
				runCode(cmd, 'Check Channels', {
					nodes: {
						'Validate Start': [{ json: { ok: true, remoteId: B } }],
						'Find Remote Pairing': remoteRows,
						'Get Local Channel': local,
						'Get Remote Channel': remote,
					},
				})[0].json;
			expect(run([{ json: row({ aChannelId: '9' }) }], ch(A, GA), ch(B, GB))).toEqual({
				ok: false,
				reply: SYNC_COPY.remoteSynced,
			});
			expect(run([{ json: {} }], [apiError(10003, 'Unknown Channel')], ch(B, GB))).toEqual({
				ok: false,
				reply: SYNC_COPY.noLocal,
			});
			expect(run([{ json: {} }], ch(A, GA), [apiError(50001, 'Missing Access', 403)])).toEqual({
				ok: false,
				reply: SYNC_COPY.noRemote,
			});
			expect(run([{ json: {} }], ch(A, GA, 0, 'ours'), ch(B, GB, 5, 'theirs'))).toEqual({
				ok: true,
				local: { id: A, guildId: GA, name: 'ours' },
				remote: { id: B, guildId: GB, name: 'theirs' },
			});
			expect(targets(cmd, 'Check Channels')).toEqual(['Channels OK?']);
			expect(targets(cmd, 'Channels OK?', 0)).toEqual(['Get Local Guild']);
			expect(targets(cmd, 'Channels OK?', 1)).toEqual(['Reply']);
		});

		it('reads both guilds and the bot user', () => {
			for (const [name, side] of [
				['Get Local Guild', 'local'],
				['Get Remote Guild', 'remote'],
			]) {
				const n = node(cmd, name);
				expect([n.parameters.resource, n.parameters.operation]).toEqual(['guild', 'get']);
				expect(n.parameters.guildId).toBe(
					`={{ $('Check Channels').first().json.${side}.guildId }}`,
				);
				expect(n.onError).toBe('continueRegularOutput');
			}
			const me = node(cmd, 'Get Bot User');
			expect([me.parameters.resource, me.parameters.operation]).toEqual(['user', 'getCurrent']);
			expect(targets(cmd, 'Get Local Guild')).toEqual(['Get Remote Guild']);
			expect(targets(cmd, 'Get Remote Guild')).toEqual(['Get Bot User']);
			expect(targets(cmd, 'Get Bot User')).toEqual(['List Local Hooks']);
		});

		for (const [side, Side] of [
			['local', 'Local'],
			['remote', 'Remote'],
		]) {
			it(`gets or creates the ${side} Spuddy Sync webhook`, () => {
				const list = node(cmd, `List ${Side} Hooks`);
				expect([list.parameters.resource, list.parameters.operation]).toEqual([
					'webhook',
					'getChannelWebhooks',
				]);
				expect(list.parameters.channelId).toBe(
					`={{ $('Check Channels').first().json.${side}.id }}`,
				);
				expect(list.alwaysOutputData).toBe(true);
				expect(list.onError).toBe('continueRegularOutput');
				expect(targets(cmd, `List ${Side} Hooks`)).toEqual([`Pick ${Side} Hook`]);
				expect(targets(cmd, `Pick ${Side} Hook`)).toEqual([`Need ${Side} Hook?`]);
				expect(targets(cmd, `Need ${Side} Hook?`, 0)).toEqual([`Create ${Side} Hook`]);
				expect(targets(cmd, `Need ${Side} Hook?`, 1)).toEqual([`${Side} Hook`]);
				expect(targets(cmd, `Create ${Side} Hook`)).toEqual([`${Side} Hook`]);
				expect(targets(cmd, `${Side} Hook`)).toEqual([`${Side} Hook OK?`]);
				expect(targets(cmd, `${Side} Hook OK?`, 1)).toEqual(['Reply']);
				const create = node(cmd, `Create ${Side} Hook`);
				expect([create.parameters.resource, create.parameters.operation]).toEqual([
					'webhook',
					'create',
				]);
				expect(create.parameters.name).toBe('Spuddy Sync');
				expect(create.parameters.channelId).toBe(
					`={{ $('Check Channels').first().json.${side}.id }}`,
				);
				expect(create.onError).toBe('continueRegularOutput');

				const me = [{ json: { id: BOT } }];
				const mine = { id: 'h1', name: 'Spuddy Sync', token: 'tok', user: { id: BOT } };
				const pick = (items) =>
					runCode(cmd, `Pick ${Side} Hook`, { nodes: { 'Get Bot User': me }, input: items })[0]
						.json;
				expect(pick([{ json: { ...mine, name: 'other' } }, { json: mine }])).toEqual({
					hook: { id: 'h1', token: 'tok' },
				});
				expect(pick([{ json: {} }])).toEqual({ create: true });
				expect(pick([apiError(50013, 'Missing Permissions', 403)])).toEqual({
					error: 'Missing Permissions',
				});

				const resolve = (picked, input) =>
					runCode(cmd, `${Side} Hook`, {
						nodes: { [`Pick ${Side} Hook`]: [{ json: picked }] },
						input,
					})[0].json;
				expect(resolve({ hook: { id: 'h1', token: 't' } }, [{ json: { hook: {} } }])).toEqual({
					ok: true,
					hook: { id: 'h1', token: 't' },
				});
				expect(resolve({ create: true }, [{ json: { id: 'n', token: 'nt' } }])).toEqual({
					ok: true,
					hook: { id: 'n', token: 'nt' },
				});
				expect(resolve({ create: true }, [apiError(50013, 'Missing Permissions', 403)])).toEqual({
					ok: false,
					reply:
						'Failed to create webhooks (need Manage Webhooks in both channels): Missing Permissions',
				});
				expect(resolve({ error: 'Missing Permissions' }, [{ json: { error: 'x' } }]).reply).toBe(
					'Failed to create webhooks (need Manage Webhooks in both channels): Missing Permissions',
				);
			});
		}

		it('chains local hook, remote hook, then Build Pairing', () => {
			expect(targets(cmd, 'Local Hook OK?', 0)).toEqual(['List Remote Hooks']);
			expect(targets(cmd, 'Remote Hook OK?', 0)).toEqual(['Build Pairing']);
		});

		it('Build Pairing stores A = here, B = remote, and the banners', () => {
			const out = runCode(cmd, 'Build Pairing', {
				nodes: {
					'When called by another workflow': trigger('start', { channel_id: B }),
					'Validate Start': [{ json: { ok: true, remoteId: B, note: 'client' } }],
					'Check Channels': [
						{
							json: {
								ok: true,
								local: { id: A, guildId: GA, name: 'ours' },
								remote: { id: B, guildId: GB, name: 'theirs' },
							},
						},
					],
					'Get Local Guild': [{ json: { id: GA, name: 'Our Server' } }],
					'Get Remote Guild': [apiError(10004, 'Unknown Guild')],
					'Local Hook': [{ json: { ok: true, hook: { id: 'wa', token: 'ta' } } }],
					'Remote Hook': [{ json: { ok: true, hook: { id: 'wb', token: 'tb' } } }],
				},
			})[0].json;
			expect(out.row.pairingId).toMatch(/^[0-9a-f]{32}$/);
			expect(out.row).toMatchObject({
				aGuildId: GA,
				aChannelId: A,
				aWebhookId: 'wa',
				aWebhookToken: 'ta',
				bGuildId: GB,
				bChannelId: B,
				bWebhookId: 'wb',
				bWebhookToken: 'tb',
				aTag: '',
				bTag: '',
				createdBy: USER,
				note: 'client',
			});
			expect(new Date(out.row.createdUtc).toISOString()).toBe(out.row.createdUtc);
			expect(out.bannerLocal).toBe(startBanner('theirs', GB, USER));
			expect(out.bannerRemote).toBe(startBanner('ours', 'Our Server', USER));
			expect(out.reply).toBe('Sync started with #theirs.');
		});

		it('saves the row, posts both banners without pings, then replies', () => {
			expect(targets(cmd, 'Build Pairing')).toEqual(['Save Pairing']);
			const save = node(cmd, 'Save Pairing');
			expect([save.parameters.resource, save.parameters.operation]).toEqual(['row', 'insert']);
			expect(save.parameters.dataTableId.value).toBe('sync_pairings');
			const cols = [
				'pairingId',
				'aGuildId',
				'aChannelId',
				'aWebhookId',
				'aWebhookToken',
				'aTag',
				'bGuildId',
				'bChannelId',
				'bWebhookId',
				'bWebhookToken',
				'bTag',
				'createdBy',
				'createdUtc',
				'note',
			];
			expect(Object.keys(save.parameters.columns.value).sort()).toEqual(cols.slice().sort());
			for (const c of cols) {
				expect(save.parameters.columns.value[c]).toBe(
					`={{ $('Build Pairing').first().json.row.${c} }}`,
				);
			}
			const types = Object.fromEntries(save.parameters.columns.schema.map((s) => [s.id, s.type]));
			expect(types.createdUtc).toBe('dateTime');
			expect(types.pairingId).toBe('string');
			expect(targets(cmd, 'Save Pairing')).toEqual(['Banner Local']);
			expect(targets(cmd, 'Banner Local')).toEqual(['Banner Remote']);
			expect(targets(cmd, 'Banner Remote')).toEqual(['Reply Started']);
			for (const [name, side, text] of [
				['Banner Local', 'local', 'bannerLocal'],
				['Banner Remote', 'remote', 'bannerRemote'],
			]) {
				const n = node(cmd, name);
				expect([n.parameters.resource, n.parameters.operation]).toEqual(['message', 'send']);
				expect(n.parameters.channelId).toBe(`={{ $('Check Channels').first().json.${side}.id }}`);
				expect(n.parameters.content).toBe(`={{ $('Build Pairing').first().json.${text} }}`);
				expect(n.parameters.allowedMentions).toEqual(NONE_MENTIONS);
				expect(n.onError).toBe('continueRegularOutput');
				expect(n.executeOnce).toBe(true);
			}
			expect(node(cmd, 'Reply Started').parameters.jsonOutput).toBe(
				"={{ JSON.stringify({ content: $('Build Pairing').first().json.reply }) }}",
			);
		});
	});

	describe('stop', () => {
		it('reports a channel that is not synced', () => {
			const out = runCode(cmd, 'Stop Check', {
				nodes: {
					'When called by another workflow': trigger('stop'),
					'Find Pairing': [{ json: {} }],
				},
			});
			expect(out).toEqual([{ json: { ok: false, reply: SYNC_COPY.notSynced } }]);
			expect(targets(cmd, 'Stop Check')).toEqual(['Is Synced?']);
			expect(targets(cmd, 'Is Synced?', 1)).toEqual(['Reply']);
			expect(targets(cmd, 'Is Synced?', 0)).toEqual(['Delete Hook A']);
		});

		it('finds the pairing from the B side', () => {
			const out = runCode(cmd, 'Stop Check', {
				nodes: {
					'When called by another workflow': trigger('stop', {}, B),
					'Find Pairing': [{ json: row() }],
				},
			})[0].json;
			expect(out.ok).toBe(true);
			expect(out.pairingId).toBe('p1');
			expect(out.a.channelId).toBe(A);
			expect(out.b.webhookId).toBe('wb');
		});

		it('deletes hooks, rows and posts both banners, once each', () => {
			const chain = [
				'Delete Hook A',
				'Delete Hook B',
				'Delete Pairing',
				'Delete Map',
				'Banner A',
				'Banner B',
				'Reply Stopped',
			];
			for (let i = 0; i < chain.length - 1; i++) {
				expect(targets(cmd, chain[i]), chain[i]).toEqual([chain[i + 1]]);
			}
			for (const s of ['A', 'B']) {
				const del = node(cmd, 'Delete Hook ' + s);
				expect([del.parameters.resource, del.parameters.operation]).toEqual(['webhook', 'delete']);
				expect(del.parameters.webhookId).toBe(
					`={{ $('Stop Check').first().json.${s.toLowerCase()}.webhookId }}`,
				);
				expect(del.onError).toBe('continueRegularOutput');
				const banner = node(cmd, 'Banner ' + s);
				expect(banner.parameters.content).toBe('🔌 Sync stopped for this channel.');
				expect(banner.parameters.channelId).toBe(
					`={{ $('Stop Check').first().json.${s.toLowerCase()}.channelId }}`,
				);
				expect(banner.parameters.allowedMentions).toEqual(NONE_MENTIONS);
				expect(banner.onError).toBe('continueRegularOutput');
				expect(banner.executeOnce).toBe(true);
			}
			for (const [name, table] of [
				['Delete Pairing', 'sync_pairings'],
				['Delete Map', 'sync_message_map'],
			]) {
				const n = node(cmd, name);
				expect([n.parameters.resource, n.parameters.operation]).toEqual(['row', 'deleteRows']);
				expect(n.parameters.dataTableId.value).toBe(table);
				expect(n.parameters.filters.conditions).toEqual([
					{
						keyName: 'pairingId',
						condition: 'eq',
						keyValue: "={{ $('Stop Check').first().json.pairingId }}",
					},
				]);
				expect(n.alwaysOutputData).toBe(true);
				expect(n.executeOnce).toBe(true);
			}
			expect(JSON.parse(node(cmd, 'Reply Stopped').parameters.jsonOutput)).toEqual({
				content: 'Sync stopped.',
			});
			expect(node(cmd, 'Reply Stopped').executeOnce).toBe(true);
		});
	});

	describe('status', () => {
		it('shows the partner, date and note', () => {
			const run = (rows, ch = A) =>
				runCode(cmd, 'Status', {
					nodes: {
						'When called by another workflow': trigger('status', {}, ch),
						'Find Pairing': rows,
					},
				});
			expect(run([{ json: {} }])).toEqual([{ json: { content: SYNC_COPY.notSynced } }]);
			expect(run([{ json: row({ note: 'client' }) }])[0].json.content).toBe(
				'🔗 Synced with channel `' +
					B +
					'` (guild `' +
					GB +
					'`).\nStarted by <@' +
					USER +
					'> on 2026-10-19.\nNote: client',
			);
			expect(targets(cmd, 'Status')).toEqual([]);
		});
	});

	describe('tag', () => {
		const run = (opts, rows = [{ json: row() }], ch = A) =>
			runCode(cmd, 'Tag', {
				nodes: {
					'When called by another workflow': trigger('tag', opts, ch),
					'Find Pairing': rows,
				},
			})[0].json;

		it('shows the tags without saving', () => {
			expect(run({})).toEqual({
				save: false,
				reply: 'Current tags — ours: (none), theirs: (none).',
			});
			expect(run({}, [{ json: {} }])).toEqual({ save: false, reply: SYNC_COPY.notSynced });
		});
		it('saves both tags with the next values', () => {
			expect(run({ ourtag: '[A]', theirtag: '[B]' })).toMatchObject({
				save: true,
				pairingId: 'p1',
				next: { aTag: '[A]', bTag: '[B]' },
				reply: 'Tags updated — ours: `[A]`, theirs: `[B]`.',
			});
			expect(run({ ourtag: '-' }, [{ json: row({ aTag: '[A]', bTag: '[B]' }) }], B)).toMatchObject({
				save: true,
				next: { aTag: '[A]', bTag: '' },
			});
		});
		it('refuses forbidden words and long tags without saving', () => {
			expect(run({ ourtag: 'discordians' }).save).toBe(false);
			expect(run({ theirtag: 'x'.repeat(33) }).reply).toBe(
				'`theirtag` must be at most 32 characters.',
			);
		});
		it('wires Save Tags only when there is something to save', () => {
			expect(targets(cmd, 'Tag')).toEqual(['Save Tags?']);
			expect(targets(cmd, 'Save Tags?', 0)).toEqual(['Save Tags']);
			expect(targets(cmd, 'Save Tags?', 1)).toEqual(['Reply']);
			expect(targets(cmd, 'Save Tags')).toEqual(['Reply Tags']);
			const save = node(cmd, 'Save Tags');
			expect([save.parameters.resource, save.parameters.operation]).toEqual(['row', 'update']);
			expect(save.parameters.dataTableId.value).toBe('sync_pairings');
			expect(save.parameters.filters.conditions).toEqual([
				{
					keyName: 'pairingId',
					condition: 'eq',
					keyValue: "={{ $('Tag').first().json.pairingId }}",
				},
			]);
			expect(save.parameters.columns.value).toEqual({
				aTag: "={{ $('Tag').first().json.next.aTag }}",
				bTag: "={{ $('Tag').first().json.next.bTag }}",
			});
			expect(save.alwaysOutputData).toBe(true);
			expect(node(cmd, 'Reply Tags').parameters.jsonOutput).toBe(
				"={{ JSON.stringify({ content: $('Tag').first().json.reply }) }}",
			);
			expect(node(cmd, 'Reply Tags').executeOnce).toBe(true);
		});
	});
});

describe('Discord Listener: Sync Mirror', () => {
	const msg = (extra = {}) => ({
		id: '900000000000000001',
		channel_id: A,
		guild_id: GA,
		content: 'hello @everyone',
		author: { id: USER, username: 'baal', global_name: 'Baal', avatar: 'abc' },
		member: { nick: null, avatar: null },
		attachments: [],
		...extra,
	});
	const filtered = (event, m) => [{ json: { event, m } }];

	it('is an untagged listener that keeps only failed executions', () => {
		expect(mirror.name).toBe('Discord Listener: Sync Mirror');
		expect(mirror.tags || []).toEqual([]);
		expect(mirror.settings).toMatchObject({
			executionOrder: 'v1',
			saveDataSuccessExecution: 'none',
			saveDataErrorExecution: 'all',
			timezone: 'Europe/Warsaw',
		});
		expect(node(mirror, 'When called by another workflow').parameters.inputSource).toBe(
			'passthrough',
		);
		expect(targets(mirror, 'When called by another workflow')).toEqual(['Filter']);
		expect(targets(mirror, 'Filter')).toEqual(['Event']);
		const rules = node(mirror, 'Event').parameters.rules.values;
		expect(rules.map((r) => r.outputKey)).toEqual(['create', 'update', 'delete']);
		expect(targets(mirror, 'Event', 0)).toEqual(['Find Pairing']);
		expect(targets(mirror, 'Event', 1)).toEqual(['Find Map']);
		expect(targets(mirror, 'Event', 2)).toEqual(['Find Map']);
	});

	it('Filter reads its input without $json and drops bots and webhooks', () => {
		const run = (json) => runCode(mirror, 'Filter', { input: [{ json }] });
		const code = node(mirror, 'Filter').parameters.jsCode;
		expect(code).not.toMatch(/\$json/);
		expect(run({ event: 'create', message: msg(), listener: { name: 'Sync Mirror' } })).toEqual(
			filtered('create', msg()),
		);
		expect(run({ event: 'create', message: msg({ webhook_id: '1' }) })).toEqual([]);
		expect(run({ event: 'create', message: msg({ author: { id: '1', bot: true } }) })).toEqual([]);
		expect(run({ event: 'update', message: msg() })).toEqual([]);
		expect(run({ event: 'delete', message: { id: '1', channel_id: A } })).toHaveLength(1);
	});

	describe('create', () => {
		it('finds the pairing by the message channel', () => {
			const find = node(mirror, 'Find Pairing');
			expect(find.parameters.dataTableId.value).toBe('sync_pairings');
			expect(find.parameters.matchType).toBe('anyCondition');
			expect(find.parameters.filters.conditions).toEqual([
				{ keyName: 'aChannelId', condition: 'eq', keyValue: '={{ $json.m.channel_id }}' },
				{ keyName: 'bChannelId', condition: 'eq', keyValue: '={{ $json.m.channel_id }}' },
			]);
			expect(find.parameters.limit).toBe(1);
			expect(find.alwaysOutputData).toBeFalsy();
			expect(targets(mirror, 'Find Pairing')).toEqual(['Prepare']);
		});

		it('Prepare targets the partner webhook, or stops', () => {
			const run = (m, p) =>
				runCode(mirror, 'Prepare', {
					nodes: { Filter: filtered('create', m) },
					input: [{ json: p }],
				});
			const out = run(msg(), row({ aTag: '[A]' }));
			expect(out).toHaveLength(1);
			expect(out[0].json).toMatchObject({
				pairingId: 'p1',
				sourceMessageId: '900000000000000001',
				target: { side: 'b', channelId: B, webhookId: 'wb', webhookToken: 'tb' },
				username: '[A] Baal',
				content: 'hello @everyone',
				upload: [],
			});
			expect(run(msg({ content: '' }), row())).toEqual([]);
			expect(targets(mirror, 'Prepare')).toEqual(['Has Files?']);
			expect(targets(mirror, 'Has Files?', 0)).toEqual(['Split Files']);
			expect(targets(mirror, 'Has Files?', 1)).toEqual(['Send']);
		});

		it('downloads each file and collects them on one item', () => {
			const prepared = {
				pairingId: 'p1',
				content: 'pics',
				upload: [
					{ filename: 'a.png', url: 'https://cdn/a.png' },
					{ filename: 'b.png', url: 'https://cdn/b.png' },
				],
			};
			const split = runCode(mirror, 'Split Files', { input: [{ json: prepared }] });
			expect(split).toEqual([
				{ json: { url: 'https://cdn/a.png', index: 0 } },
				{ json: { url: 'https://cdn/b.png', index: 1 } },
			]);
			expect(targets(mirror, 'Split Files')).toEqual(['Download']);
			const dl = node(mirror, 'Download');
			expect(dl.type).toBe('n8n-nodes-base.httpRequest');
			expect(dl.parameters.url).toBe('={{ $json.url }}');
			expect(dl.parameters.authentication).toBe('none');
			expect(dl.parameters.options.response.response).toEqual({
				responseFormat: 'file',
				outputPropertyName: 'data',
			});
			expect(dl.onError).toBe('continueRegularOutput');
			expect(targets(mirror, 'Download')).toEqual(['Collect Files']);
			const out = runCode(mirror, 'Collect Files', {
				nodes: { Prepare: [{ json: prepared }] },
				input: [
					{ json: {}, binary: { data: { data: 'AA==', mimeType: 'image/png' } } },
					{ json: { error: 'Forbidden' } },
				],
			});
			expect(out).toHaveLength(1);
			expect(out[0].json.files).toEqual(['file0']);
			expect(out[0].json.content).toBe('pics\nhttps://cdn/b.png');
			expect(out[0].binary.file0.fileName).toBe('a.png');
			expect(targets(mirror, 'Collect Files')).toEqual(['Send']);
		});

		it('sends through the webhook as the author, without pings, and waits for the message', () => {
			for (const name of ['Send', 'Send Again']) {
				const send = node(mirror, name);
				expect(send.type).toBe('CUSTOM.discord');
				expect([send.parameters.resource, send.parameters.operation]).toEqual([
					'webhook',
					'execute',
				]);
				expect(send.parameters.webhookUrl).toBe(
					'=https://discord.com/api/v10/webhooks/{{ $json.target.webhookId }}/{{ $json.target.webhookToken }}',
				);
				expect(send.parameters.content).toBe('={{ $json.content }}');
				expect(send.parameters.username).toBe('={{ $json.username }}');
				expect(send.parameters.avatarUrl).toBe('={{ $json.avatarUrl }}');
				expect(send.parameters.wait).toBe(true);
				expect(send.parameters.allowedMentions).toEqual(NONE_MENTIONS);
				const files = send.parameters.attachments.attachment;
				expect(files).toHaveLength(10);
				files.forEach((f, i) => {
					expect(f.binaryPropertyName).toBe(`={{ ($json.files || [])[${i}] || '' }}`);
				});
				expect(send.onError).toBe('continueErrorOutput');
				expect(targets(mirror, name, 0)).toEqual(['Save Map']);
			}
			expect(targets(mirror, 'Send', 1)).toEqual(['Gone?']);
			expect(targets(mirror, 'Send Again', 1)).toEqual(['Retry Failed']);
		});

		it('maps the source message to the mirror', () => {
			const save = node(mirror, 'Save Map');
			expect([save.parameters.resource, save.parameters.operation]).toEqual(['row', 'insert']);
			expect(save.parameters.dataTableId.value).toBe('sync_message_map');
			expect(save.parameters.columns.value).toEqual({
				sourceMessageId: "={{ $('Prepare').first().json.sourceMessageId }}",
				pairingId: "={{ $('Prepare').first().json.pairingId }}",
				mirrorChannelId: "={{ $('Prepare').first().json.target.channelId }}",
				mirrorMessageId: '={{ $json.id }}',
				createdUtc: '={{ $now.toISO() }}',
			});
			const types = Object.fromEntries(save.parameters.columns.schema.map((s) => [s.id, s.type]));
			expect(types).toEqual({
				sourceMessageId: 'string',
				pairingId: 'string',
				mirrorChannelId: 'string',
				mirrorMessageId: 'string',
				createdUtc: 'dateTime',
			});
			expect(save.executeOnce).toBe(true);
		});
	});

	describe('update and delete', () => {
		it('finds the map row and the pairing, then the mirror endpoint', () => {
			const map = node(mirror, 'Find Map');
			expect(map.parameters.dataTableId.value).toBe('sync_message_map');
			expect(map.parameters.filters.conditions).toEqual([
				{ keyName: 'sourceMessageId', condition: 'eq', keyValue: '={{ $json.m.id }}' },
			]);
			expect(map.parameters.limit).toBe(1);
			expect(targets(mirror, 'Find Map')).toEqual(['Find Pairing By Id']);
			const p = node(mirror, 'Find Pairing By Id');
			expect(p.parameters.dataTableId.value).toBe('sync_pairings');
			expect(p.parameters.filters.conditions).toEqual([
				{ keyName: 'pairingId', condition: 'eq', keyValue: '={{ $json.pairingId }}' },
			]);
			expect(targets(mirror, 'Find Pairing By Id')).toEqual(['Mirror Target']);
			const out = runCode(mirror, 'Mirror Target', {
				nodes: {
					Filter: filtered('update', msg({ content: 'edited', edited_timestamp: 'x' })),
					'Find Map': [
						{
							json: {
								sourceMessageId: 's1',
								pairingId: 'p1',
								mirrorChannelId: B,
								mirrorMessageId: 'm1',
							},
						},
					],
				},
				input: [{ json: row() }],
			});
			expect(out[0].json).toMatchObject({
				event: 'update',
				mirrorMessageId: 'm1',
				target: { side: 'b', webhookId: 'wb', webhookToken: 'tb' },
				content: 'edited',
			});
			expect(targets(mirror, 'Mirror Target')).toEqual(['Edit or Delete']);
			expect(targets(mirror, 'Edit or Delete', 0)).toEqual(['Edit']);
			expect(targets(mirror, 'Edit or Delete', 1)).toEqual(['Delete']);
		});

		it('edits and deletes through the webhook', () => {
			for (const name of ['Edit', 'Edit Again']) {
				const n = node(mirror, name);
				expect([n.parameters.resource, n.parameters.operation]).toEqual(['webhook', 'editMessage']);
				expect(n.parameters.webhookId).toBe('={{ $json.target.webhookId }}');
				expect(n.parameters.webhookToken).toBe('={{ $json.target.webhookToken }}');
				expect(n.parameters.messageId).toBe('={{ $json.mirrorMessageId }}');
				expect(n.parameters.content).toBe('={{ $json.content }}');
				expect(n.parameters.allowedMentions).toEqual(NONE_MENTIONS);
				expect(n.onError).toBe('continueErrorOutput');
			}
			for (const name of ['Delete', 'Delete Again']) {
				const n = node(mirror, name);
				expect([n.parameters.resource, n.parameters.operation]).toEqual([
					'webhook',
					'deleteMessage',
				]);
				expect(n.parameters.messageId).toBe('={{ $json.mirrorMessageId }}');
				expect(n.onError).toBe('continueErrorOutput');
				expect(targets(mirror, name, 0)).toEqual(['Remove Map']);
			}
			expect(targets(mirror, 'Edit', 1)).toEqual(['Gone?']);
			expect(targets(mirror, 'Delete', 1)).toEqual(['Gone?']);
			expect(targets(mirror, 'Edit Again', 1)).toEqual(['Retry Failed']);
			expect(targets(mirror, 'Delete Again', 1)).toEqual(['Retry Failed']);
			const rm = node(mirror, 'Remove Map');
			expect([rm.parameters.resource, rm.parameters.operation]).toEqual(['row', 'deleteRows']);
			expect(rm.parameters.dataTableId.value).toBe('sync_message_map');
			expect(rm.parameters.filters.conditions).toEqual([
				{
					keyName: 'sourceMessageId',
					condition: 'eq',
					keyValue: "={{ $('Filter').first().json.m.id }}",
				},
			]);
			expect(rm.executeOnce).toBe(true);
		});
	});

	describe('webhook gone', () => {
		const prepared = {
			pairingId: 'p1',
			sourceMessageId: 's1',
			target: { side: 'b', channelId: B, webhookId: 'wb', webhookToken: 'tb' },
			content: 'hi',
			upload: [],
		};
		const gone = (event, err, extraNodes = {}) =>
			runCode(mirror, 'Gone?', {
				nodes: { Filter: filtered(event, msg()), ...extraNodes },
				input: [err],
			});

		it('recreates on 10015 and on a 404 without a code', () => {
			const out = gone('create', apiError(10015, 'Unknown Webhook'), {
				Prepare: [{ json: prepared }],
			});
			expect(out[0].json).toMatchObject({ ...prepared, event: 'create', action: 'recreate' });
			const out2 = gone('create', apiError(0, '404: Not Found'), { Prepare: [{ json: prepared }] });
			expect(out2[0].json.action).toBe('recreate');
		});
		it('keeps the collected files for the retry', () => {
			const binary = { file0: { data: 'AA==' } };
			const out = gone('create', apiError(10015, 'Unknown Webhook'), {
				Prepare: [{ json: prepared }],
				'Collect Files': [{ json: { ...prepared, files: ['file0'] }, binary }],
			});
			expect(out[0].json.files).toEqual(['file0']);
			expect(out[0].binary).toEqual(binary);
		});
		it('uses the mirror target for edits and deletes', () => {
			const t = { ...prepared, event: 'delete', mirrorMessageId: 'm1' };
			expect(
				gone('delete', apiError(10008, 'Unknown Message'), { 'Mirror Target': [{ json: t }] })[0]
					.json.action,
			).toBe('done');
			expect(
				gone('update', apiError(10015, 'Unknown Webhook'), { 'Mirror Target': [{ json: t }] })[0]
					.json,
			).toMatchObject({ action: 'recreate', event: 'update', mirrorMessageId: 'm1' });
		});
		it('fails the execution on any other error, without the token', () => {
			let err;
			try {
				gone('create', apiError(50035, 'Invalid Form Body', 400), {
					Prepare: [{ json: prepared }],
				});
			} catch (e) {
				err = e;
			}
			expect(err && err.message).toContain('Invalid Form Body');
			expect(err.message).not.toContain('tb');
			expect(() =>
				gone('update', apiError(10008, 'Unknown Message'), {
					'Mirror Target': [{ json: prepared }],
				}),
			).toThrow(/Unknown Message/);
		});
		it('routes recreate to the hook chain and done to Remove Map', () => {
			expect(targets(mirror, 'Gone?')).toEqual(['Gone Action']);
			const rules = node(mirror, 'Gone Action').parameters.rules.values;
			expect(rules.map((r) => r.outputKey)).toEqual(['recreate', 'done']);
			expect(targets(mirror, 'Gone Action', 0)).toEqual(['Get Bot User']);
			expect(targets(mirror, 'Gone Action', 1)).toEqual(['Remove Map']);
			expect(targets(mirror, 'Get Bot User')).toEqual(['List Hooks']);
			expect(targets(mirror, 'List Hooks')).toEqual(['Pick Hook']);
			expect(targets(mirror, 'Pick Hook')).toEqual(['Need Hook?']);
			expect(targets(mirror, 'Need Hook?', 0)).toEqual(['Create Hook']);
			expect(targets(mirror, 'Need Hook?', 1)).toEqual(['New Hook']);
			expect(targets(mirror, 'Create Hook')).toEqual(['New Hook']);
			expect(targets(mirror, 'New Hook')).toEqual(['Which Side']);
			expect(targets(mirror, 'Which Side', 0)).toEqual(['Save Hook A']);
			expect(targets(mirror, 'Which Side', 1)).toEqual(['Save Hook B']);
			expect(targets(mirror, 'Save Hook A')).toEqual(['Retry Input']);
			expect(targets(mirror, 'Save Hook B')).toEqual(['Retry Input']);
			expect(targets(mirror, 'Retry Input')).toEqual(['Retry']);
			expect(targets(mirror, 'Retry', 0)).toEqual(['Send Again']);
			expect(targets(mirror, 'Retry', 1)).toEqual(['Edit Again']);
			expect(targets(mirror, 'Retry', 2)).toEqual(['Delete Again']);
			expect(targets(mirror, 'Retry Failed')).toEqual(['Remove Map']);
			const list = node(mirror, 'List Hooks');
			expect(list.parameters.channelId).toBe("={{ $('Gone?').first().json.target.channelId }}");
			expect(list.alwaysOutputData).toBe(true);
			expect(list.onError).toBe('continueRegularOutput');
			const create = node(mirror, 'Create Hook');
			expect(create.parameters.name).toBe('Spuddy Sync');
			expect(create.parameters.channelId).toBe("={{ $('Gone?').first().json.target.channelId }}");
		});
		it('New Hook passes the side and pairing, or fails', () => {
			const run = (picked, input) =>
				runCode(mirror, 'New Hook', {
					nodes: {
						'Pick Hook': [{ json: picked }],
						'Gone?': [{ json: { ...prepared, event: 'create', action: 'recreate' } }],
					},
					input,
				});
			expect(run({ create: true }, [{ json: { id: 'n1', token: 'nt' } }])).toEqual([
				{ json: { hook: { id: 'n1', token: 'nt' }, side: 'b', pairingId: 'p1' } },
			]);
			expect(() => run({ create: true }, [apiError(50013, 'Missing Permissions', 403)])).toThrow(
				/Missing Permissions/,
			);
		});
		it('saves the new hook on the right side', () => {
			for (const s of ['a', 'b']) {
				const save = node(mirror, 'Save Hook ' + s.toUpperCase());
				expect([save.parameters.resource, save.parameters.operation]).toEqual(['row', 'update']);
				expect(save.parameters.dataTableId.value).toBe('sync_pairings');
				expect(save.parameters.filters.conditions).toEqual([
					{ keyName: 'pairingId', condition: 'eq', keyValue: '={{ $json.pairingId }}' },
				]);
				expect(save.parameters.columns.value).toEqual({
					[s + 'WebhookId']: '={{ $json.hook.id }}',
					[s + 'WebhookToken']: '={{ $json.hook.token }}',
				});
				expect(save.alwaysOutputData).toBe(true);
			}
		});
		it('Retry Input swaps in the new hook and keeps the files', () => {
			const binary = { file0: { data: 'AA==' } };
			const out = runCode(mirror, 'Retry Input', {
				nodes: {
					'Gone?': [{ json: { ...prepared, event: 'create', action: 'recreate' }, binary }],
					'New Hook': [{ json: { hook: { id: 'n1', token: 'nt' }, side: 'b', pairingId: 'p1' } }],
				},
				input: [{ json: { id: 7 } }, { json: { id: 8 } }],
			});
			expect(out).toHaveLength(1);
			expect(out[0].json.target).toEqual({
				side: 'b',
				channelId: B,
				webhookId: 'n1',
				webhookToken: 'nt',
			});
			expect(out[0].json.content).toBe('hi');
			expect(out[0].binary).toEqual(binary);
		});
		it('Retry Failed lets only an already deleted mirror through', () => {
			const run = (event, err) =>
				runCode(mirror, 'Retry Failed', {
					nodes: { Filter: filtered(event, msg()) },
					input: [err],
				});
			expect(run('delete', apiError(10008, 'Unknown Message'))).toEqual([{ json: { done: true } }]);
			expect(() => run('delete', apiError(10015, 'Unknown Webhook'))).toThrow(/Unknown Webhook/);
			expect(() => run('create', apiError(10015, 'Unknown Webhook'))).toThrow(/Unknown Webhook/);
		});
	});

	describe('prune', () => {
		it('runs daily at 03:30 and deletes rows older than the retention', () => {
			const t = node(mirror, 'Every Day 03:30');
			expect(t.type).toBe('n8n-nodes-base.scheduleTrigger');
			expect(t.parameters.rule.interval).toEqual([
				{ field: 'days', daysInterval: 1, triggerAtHour: 3, triggerAtMinute: 30 },
			]);
			expect(targets(mirror, 'Every Day 03:30')).toEqual(['Load Retention']);
			const load = node(mirror, 'Load Retention');
			expect(load.parameters.dataTableId.value).toBe('discord_config');
			expect(load.parameters.filters.conditions[0].keyValue).toBe('syncMapRetentionDays');
			expect(load.alwaysOutputData).toBe(true);
			expect(targets(mirror, 'Load Retention')).toEqual(['Cutoff']);
			const cutoff = runCode(mirror, 'Cutoff', { input: [{ json: {} }] })[0].json.cutoff;
			const days = (Date.now() - new Date(cutoff).getTime()) / 86400000;
			expect(Math.round(days)).toBe(14);
			const zero = runCode(mirror, 'Cutoff', { input: [{ json: { key: 'x', value: '0' } }] })[0]
				.json.cutoff;
			expect(Math.abs(Date.now() - new Date(zero).getTime())).toBeLessThan(5000);
			expect(targets(mirror, 'Cutoff')).toEqual(['Prune Map']);
			const prune = node(mirror, 'Prune Map');
			expect([prune.parameters.resource, prune.parameters.operation]).toEqual([
				'row',
				'deleteRows',
			]);
			expect(prune.parameters.dataTableId.value).toBe('sync_message_map');
			expect(prune.parameters.filters.conditions).toEqual([
				{ keyName: 'createdUtc', condition: 'lt', keyValue: '={{ $json.cutoff }}' },
			]);
		});
	});

	it('never puts a webhook token into a parameter or note', () => {
		for (const wf of [cmd, mirror]) {
			const text = JSON.stringify(wf.nodes.map((n) => [n.parameters, n.notes || '']));
			expect(text).not.toMatch(
				/discord(app)?\.com\/api\/(v\d+\/)?webhooks\/\d+\/[A-Za-z0-9_-]{20,}/,
			);
		}
	});
});
