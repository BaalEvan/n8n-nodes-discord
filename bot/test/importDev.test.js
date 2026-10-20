import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	importDev,
	prepareWorkflow,
	sameContent,
	ORDER,
	PUBLISH,
	TABLES,
	LISTENERS,
} from '../import-dev.mjs';
import { writeAll } from '../build-workflows.mjs';
import { buildAll } from '../build-workflows.mjs';
const path = require('path');

const built = buildAll(path.join(__dirname, '..'));
const credentials = [
	{ id: 'C1', name: 'Discord Bot (live)', type: 'discordGatewayBotApi' },
	{ id: 'C2', name: 'n8n API', type: 'n8nApi' },
	{ id: 'C3', name: 'n8n API', type: 'otherApi' },
];
const OWNER = '181510541934592000';

describe('prepareWorkflow', () => {
	it('injects credential ids by name and type', () => {
		const { body } = prepareWorkflow(built.sync, { credentials, ownerId: OWNER });
		const getWf = body.nodes.find((n) => n.name === 'Get Workflows');
		expect(getWf.credentials).toEqual({ n8nApi: { id: 'C2', name: 'n8n API' } });
		const register = body.nodes.find((n) => n.name === 'Register');
		expect(register.credentials).toEqual({
			discordGatewayBotApi: { id: 'C1', name: 'Discord Bot (live)' },
		});
	});

	it('fails when a credential is missing', () => {
		expect(() =>
			prepareWorkflow(built.sync, { credentials: credentials.slice(1), ownerId: OWNER }),
		).toThrow(/Discord Sync \/ .*no discordGatewayBotApi credential named "Discord Bot \(live\)"/);
	});

	it('strips tags and returns them separately', () => {
		const { body, tags } = prepareWorkflow(built['reload-commands'], {
			credentials,
			ownerId: OWNER,
		});
		expect(tags).toEqual(['discord-command']);
		expect(Object.keys(body).sort()).toEqual(['connections', 'name', 'nodes', 'settings']);
	});

	it('fills __OWNER_ID__ in parameters only, leaving notes alone', () => {
		const { body } = prepareWorkflow(built.router, { credentials, ownerId: OWNER });
		const trigger = body.nodes.find((n) => n.name === 'Discord Trigger');
		expect(trigger.parameters.alertUserId).toBe(OWNER);
		expect(trigger.notes).toContain('__OWNER_ID__');
		expect(JSON.stringify(body.nodes.map((n) => n.parameters))).not.toContain('__OWNER_ID__');
	});

	it('refuses an owner id that is not a snowflake', () => {
		expect(() => prepareWorkflow(built.router, { credentials, ownerId: '' })).toThrow(
			/not a Discord snowflake/,
		);
		expect(() => prepareWorkflow(built.router, { credentials, ownerId: 'abc' })).toThrow(
			/not a Discord snowflake/,
		);
	});

	it('does not modify its input', () => {
		const before = JSON.stringify(built.router);
		prepareWorkflow(built.router, { credentials, ownerId: OWNER });
		expect(JSON.stringify(built.router)).toBe(before);
	});
});

describe('sameContent', () => {
	const { body } = prepareWorkflow(built.sync, { credentials, ownerId: OWNER });

	it('ignores key order and extra workflow fields', () => {
		const stored = JSON.parse(JSON.stringify({ id: 'x', active: true, ...body }));
		stored.nodes = stored.nodes.map((n) => Object.fromEntries(Object.entries(n).reverse()));
		expect(sameContent(stored, body)).toBe(true);
	});

	it('compares an activeVersion (no settings) on nodes and connections', () => {
		expect(sameContent({ nodes: body.nodes, connections: body.connections }, body)).toBe(true);
	});

	it('detects a parameter change and a missing version', () => {
		const stored = structuredClone(body);
		stored.nodes[0].parameters = { changed: true };
		expect(sameContent(stored, body)).toBe(false);
		expect(sameContent(null, body)).toBe(false);
	});
});

describe('command templates', () => {
	it('are imported and published before the router', () => {
		expect(ORDER).toContain('commands/parse');
		expect(PUBLISH.has('commands/parse')).toBe(true);
		expect(ORDER).toContain('commands/preview');
		expect(PUBLISH.has('commands/preview')).toBe(true);
		expect(ORDER.indexOf('commands/preview')).toBeLessThan(ORDER.indexOf('router'));
		expect(ORDER.indexOf('commands/parse')).toBeLessThan(ORDER.indexOf('router'));
	});

	it('helpers are imported and published before the commands that use them', () => {
		expect(ORDER).toContain('helpers/clickup-get-task');
		expect(PUBLISH.has('helpers/clickup-get-task')).toBe(true);
		expect(ORDER.indexOf('helpers/clickup-get-task')).toBeLessThan(ORDER.indexOf('commands/cl'));
		expect(ORDER).toContain('helpers/drive-folder');
		expect(PUBLISH.has('helpers/drive-folder')).toBe(true);
		expect(ORDER.indexOf('helpers/drive-folder')).toBeLessThan(ORDER.indexOf('commands/changelog'));
		expect(ORDER).toContain('commands/cl');
		expect(PUBLISH.has('commands/cl')).toBe(true);
	});

	it('prepare with the discord-command tag', () => {
		const { body, tags } = prepareWorkflow(built['commands/parse'], {
			credentials,
			ownerId: OWNER,
		});
		expect(tags).toEqual(['discord-command']);
		expect(body.name).toBe('Discord Command: parse');
	});
});

describe('optional ClickUp credential', () => {
	const helper = () =>
		prepareWorkflow(built['helpers/clickup-get-task'], { credentials, ownerId: OWNER });

	it('keeps the name only and reports it when the credential does not exist yet', () => {
		const { body, missing } = helper();
		const t = body.nodes.find((n) => n.name === 'Try ClickUp (Client)');
		expect(t.credentials).toEqual({ clickUpApi: { name: 'ClickUp (Client)' } });
		expect(missing).toEqual(['Try ClickUp (Client): clickUpApi "ClickUp (Client)"']);
	});

	it('injects the id once the credential exists', () => {
		const withClickUp = [
			...credentials,
			{ id: 'C9', name: 'ClickUp (Client)', type: 'clickUpApi' },
		];
		const { body, missing } = prepareWorkflow(built['helpers/clickup-get-task'], {
			credentials: withClickUp,
			ownerId: OWNER,
		});
		const t = body.nodes.find((n) => n.name === 'Try ClickUp (Client)');
		expect(t.credentials).toEqual({ clickUpApi: { id: 'C9', name: 'ClickUp (Client)' } });
		expect(missing).toEqual([]);
	});
});

describe('optional Google Drive credential', () => {
	const helper = (creds) =>
		prepareWorkflow(built['helpers/drive-folder'], { credentials: creds, ownerId: OWNER });

	it('keeps the name only and reports it when the credential does not exist yet', () => {
		const { body, missing } = helper(credentials);
		const list = body.nodes.find((n) => n.name === 'List Children');
		expect(list.credentials).toEqual({ googleDriveOAuth2Api: { name: 'Google Drive account' } });
		expect(missing).toContain('List Children: googleDriveOAuth2Api "Google Drive account"');
	});

	it('injects the id once the credential exists', () => {
		const { body, missing } = helper([
			...credentials,
			{ id: 'G1', name: 'Google Drive account', type: 'googleDriveOAuth2Api' },
		]);
		for (const n of body.nodes.filter((x) => x.type === 'n8n-nodes-base.httpRequest')) {
			expect(n.credentials, n.name).toEqual({
				googleDriveOAuth2Api: { id: 'G1', name: 'Google Drive account' },
			});
		}
		expect(missing).toEqual([]);
	});
});

describe('importDev skip', () => {
	const fs = require('fs');
	const os = require('os');
	afterEach(() => vi.unstubAllGlobals());

	function stubApi() {
		const calls = [];
		let next = 0;
		vi.stubGlobal('fetch', async (url, init = {}) => {
			const method = init.method || 'GET';
			const p = new URL(url).pathname.replace('/api/v1', '');
			calls.push({ method, p, body: init.body ? JSON.parse(init.body) : undefined });
			let data = {};
			if (method === 'GET') {
				if (p.endsWith('/columns')) data = [];
				else if (p === '/credentials') data = { data: credentials };
				else data = { data: [] };
			} else if (method === 'POST' || method === 'PUT') {
				data = { id: 'ID' + next++ };
			}
			return { ok: true, status: 200, text: async () => JSON.stringify(data) };
		});
		return calls;
	}
	function run(skip) {
		const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-skip-'));
		writeAll(path.join(__dirname, '..'), dist);
		return importDev({
			baseUrl: 'http://n8n.test',
			apiKey: 'k',
			distDir: dist,
			skip,
			log: () => {},
		});
	}

	it('leaves skipped workflows alone and imports the rest', async () => {
		const calls = stubApi();
		const result = await run(['router', 'sync']);
		const saved = calls
			.filter((c) => c.method === 'POST' && c.p === '/workflows')
			.map((c) => c.body.name);
		expect(saved).toContain('Discord Command: parse');
		expect(saved).not.toContain('Discord Router');
		expect(saved).not.toContain('Discord Sync');
		expect(Object.keys(result.workflows)).not.toContain('router');
	});

	it('stores the helper workflow id in discord_config', async () => {
		const calls = stubApi();
		await run(['router', 'sync']);
		const upsert = calls.find(
			(c) => c.p.endsWith('/rows/upsert') && c.body.data.key === 'clickupHelperWorkflowId',
		);
		expect(upsert).toBeTruthy();
		expect(upsert.body.data.value).toMatch(/^ID\d+$/);
		const helperSave = calls.findIndex(
			(c) =>
				c.method === 'POST' &&
				c.p === '/workflows' &&
				c.body.name === 'Discord Helper: ClickUp Get Task',
		);
		const clSave = calls.findIndex(
			(c) => c.method === 'POST' && c.p === '/workflows' && c.body.name === 'Discord Command: cl',
		);
		expect(helperSave).toBeGreaterThan(-1);
		expect(helperSave).toBeLessThan(clSave);
	});

	it('stores the Drive folder helper id and seeds no other new config row', async () => {
		const calls = stubApi();
		const result = await run(['router', 'sync']);
		const keys = calls.filter((c) => c.p.endsWith('/rows/upsert') && 'key' in c.body.data);
		expect(keys.map((c) => c.body.data.key).sort()).toEqual(
			[
				'botUserId',
				'clickupHelperWorkflowId',
				'driveFolderHelperWorkflowId',
				'guildIds',
				'ownerId',
				'registerGlobal',
				'webhookBase',
			].sort(),
		);
		const row = keys.find((c) => c.body.data.key === 'driveFolderHelperWorkflowId');
		expect(row.body.data.value).toBe(result.workflows['helpers/drive-folder'].id);
		expect(result.workflows['helpers/drive-folder'].name).toBe('Discord Helper: Drive Folder');
	});

	it('creates the drive_folders table with string path and folderId', async () => {
		const calls = stubApi();
		await run(['router', 'sync']);
		const created = calls.find(
			(c) => c.method === 'POST' && c.p === '/data-tables' && c.body.name === 'drive_folders',
		);
		expect(created.body.columns).toEqual([
			{ name: 'path', type: 'string' },
			{ name: 'folderId', type: 'string' },
		]);
		expect(TABLES.drive_folders).toEqual(['path', 'folderId']);
	});

	it('tags only the ten command workflows, not the helper or the listener', async () => {
		const calls = stubApi();
		await run(['router', 'sync']);
		const tagged = calls.filter((c) => c.method === 'PUT' && c.p.endsWith('/tags'));
		expect(tagged).toHaveLength(10);
	});

	it('adds webhookBase only when it is missing', async () => {
		const calls = stubApi();
		await run(['router', 'sync']);
		const up = calls.filter(
			(c) => c.p.endsWith('/rows/upsert') && c.body.data.key === 'webhookBase',
		);
		expect(up).toHaveLength(1);
		expect(up[0].body.data.value).toBe('https://black-n8n.potoroo-scylla.ts.net');
	});

	it('leaves an existing webhookBase alone', async () => {
		const calls = stubApi();
		const base = globalThis.fetch;
		vi.stubGlobal('fetch', async (url, init = {}) => {
			if ((init.method || 'GET') === 'GET' && new URL(url).pathname.endsWith('/rows')) {
				return {
					ok: true,
					status: 200,
					text: async () =>
						JSON.stringify({ data: [{ key: 'webhookBase', value: 'http://localhost:5678' }] }),
				};
			}
			return base(url, init);
		});
		await run(['router', 'sync']);
		expect(
			calls.filter((c) => c.p.endsWith('/rows/upsert') && c.body.data.key === 'webhookBase'),
		).toEqual([]);
	});

	it('adds registerGlobal = "true" only when it is missing', async () => {
		const calls = stubApi();
		await run(['router', 'sync']);
		const up = calls.filter(
			(c) => c.p.endsWith('/rows/upsert') && c.body.data.key === 'registerGlobal',
		);
		expect(up).toHaveLength(1);
		expect(up[0].body.data.value).toBe('true');
	});

	it('leaves an existing registerGlobal alone, even "false"', async () => {
		const calls = stubApi();
		const base = globalThis.fetch;
		vi.stubGlobal('fetch', async (url, init = {}) => {
			if ((init.method || 'GET') === 'GET' && new URL(url).pathname.endsWith('/rows')) {
				return {
					ok: true,
					status: 200,
					text: async () => JSON.stringify({ data: [{ key: 'registerGlobal', value: 'false' }] }),
				};
			}
			return base(url, init);
		});
		await run(['router', 'sync']);
		expect(
			calls.filter((c) => c.p.endsWith('/rows/upsert') && c.body.data.key === 'registerGlobal'),
		).toEqual([]);
	});

	it('imports the changelog command before the router', () => {
		expect(ORDER).toContain('commands/changelog');
		expect(PUBLISH.has('commands/changelog')).toBe(true);
		expect(ORDER.indexOf('commands/changelog')).toBeLessThan(ORDER.indexOf('router'));
	});

	it('imports the prompt command before the router', () => {
		expect(ORDER).toContain('commands/prompt');
		expect(PUBLISH.has('commands/prompt')).toBe(true);
		expect(ORDER.indexOf('commands/prompt')).toBeLessThan(ORDER.indexOf('router'));
	});

	it('creates the sync tables with typed columns', async () => {
		const calls = stubApi();
		await run(['router', 'sync']);
		const created = Object.fromEntries(
			calls
				.filter((c) => c.method === 'POST' && c.p === '/data-tables')
				.map((c) => [c.body.name, c.body.columns]),
		);
		expect(created.sync_pairings.map((c) => c.name)).toEqual([
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
		]);
		const types = (name) => Object.fromEntries(created[name].map((c) => [c.name, c.type]));
		expect(types('sync_pairings').createdUtc).toBe('date');
		expect(types('sync_pairings').aChannelId).toBe('string');
		expect(types('sync_message_map')).toEqual({
			sourceMessageId: 'string',
			pairingId: 'string',
			mirrorChannelId: 'string',
			mirrorMessageId: 'string',
			createdUtc: 'date',
		});
		expect(created.discord_config.every((c) => c.type === 'string')).toBe(true);
	});

	it('adds a missing column with its type', async () => {
		const calls = stubApi();
		const base = globalThis.fetch;
		vi.stubGlobal('fetch', async (url, init = {}) => {
			const p = new URL(url).pathname;
			if ((init.method || 'GET') === 'GET' && p === '/api/v1/data-tables') {
				return {
					ok: true,
					status: 200,
					text: async () => JSON.stringify({ data: [{ id: 'T1', name: 'sync_message_map' }] }),
				};
			}
			return base(url, init);
		});
		await run(['router', 'sync']);
		const added = calls.filter((c) => c.method === 'POST' && c.p === '/data-tables/T1/columns');
		expect(added.find((c) => c.body.name === 'createdUtc').body).toEqual({
			name: 'createdUtc',
			type: 'date',
		});
	});

	it('imports the sync command and the listener before the router, published', () => {
		for (const key of ['commands/sync', 'listeners/sync-mirror']) {
			expect(ORDER).toContain(key);
			expect(PUBLISH.has(key)).toBe(true);
			expect(ORDER.indexOf(key)).toBeLessThan(ORDER.indexOf('router'));
		}
		expect(TABLES.sync_pairings).toBeTruthy();
		expect(TABLES.sync_message_map).toBeTruthy();
		expect(LISTENERS['listeners/sync-mirror']).toEqual({
			name: 'Sync Mirror',
			events: ['create', 'update', 'delete'],
		});
	});

	it('registers the listener for create, update and delete', async () => {
		const calls = stubApi();
		const result = await run(['router', 'sync']);
		const id = result.workflows['listeners/sync-mirror'].id;
		const rows = calls
			.filter((c) => c.p.endsWith('/rows/upsert') && c.body.data.name === 'Sync Mirror')
			.map((c) => c.body);
		expect(rows.map((r) => r.data)).toEqual([
			{ event: 'create', workflowId: id, name: 'Sync Mirror' },
			{ event: 'update', workflowId: id, name: 'Sync Mirror' },
			{ event: 'delete', workflowId: id, name: 'Sync Mirror' },
		]);
		expect(rows[0].filter).toEqual({
			type: 'and',
			filters: [
				{ columnName: 'event', condition: 'eq', value: 'create' },
				{ columnName: 'name', condition: 'eq', value: 'Sync Mirror' },
			],
		});
	});

	it('does not register a skipped listener', async () => {
		const calls = stubApi();
		await run(['router', 'sync', 'listeners/sync-mirror']);
		expect(
			calls.filter((c) => c.p.endsWith('/rows/upsert') && c.body.data.name === 'Sync Mirror'),
		).toEqual([]);
	});

	it('rejects an unknown key and lists the valid ones, before any request', async () => {
		const calls = stubApi();
		await expect(run(['routr'])).rejects.toThrow(
			'Unknown IMPORT_SKIP key "routr". Valid keys: sync, command-template, reload-commands, helpers/clickup-get-task, helpers/drive-folder, commands/changelog, commands/cl, commands/invoice-b2b, commands/invoice-zlecenie, commands/parse, commands/preview, commands/prompt, commands/sync, listeners/sync-mirror, router',
		);
		expect(calls).toEqual([]);
	});
});
