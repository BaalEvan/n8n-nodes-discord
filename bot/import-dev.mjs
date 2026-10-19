import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
	commandTemplateNames,
	helperTemplateNames,
	listenerTemplateNames,
} from './build-workflows.mjs';

export const TABLES = {
	discord_commands: ['name', 'workflowId', 'definition'],
	discord_config: ['key', 'value'],
	discord_listeners: ['event', 'workflowId', 'name'],
	sync_pairings: [
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
		{ name: 'createdUtc', type: 'date' },
		'note',
	],
	sync_message_map: [
		'sourceMessageId',
		'pairingId',
		'mirrorChannelId',
		'mirrorMessageId',
		{ name: 'createdUtc', type: 'date' },
	],
};

export const LISTENERS = {
	'listeners/sync-mirror': { name: 'Sync Mirror', events: ['create', 'update', 'delete'] },
};

export const DEV_DEFAULTS = {
	ownerId: '181510541934592000',
	guildIds: ['181510887037861898'],
	botUserId: '1523209189319774249',
	webhookBase: 'https://black-n8n.potoroo-scylla.ts.net',
};

export const COMMAND_TAG = 'discord-command';
const OWNER_PLACEHOLDER = '__OWNER_ID__';
const BOT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const ORDER = [
	'sync',
	'command-template',
	'reload-commands',
	...helperTemplateNames(BOT_DIR),
	...commandTemplateNames(BOT_DIR),
	...listenerTemplateNames(BOT_DIR),
	'router',
];
export const HELPER_CONFIG_KEYS = { 'helpers/clickup-get-task': 'clickupHelperWorkflowId' };
const OPTIONAL_CREDENTIAL_TYPES = new Set(['clickUpApi']);
export const PUBLISH = new Set(ORDER.filter((key) => key !== 'router'));

export function prepareWorkflow(wf, { credentials, ownerId }) {
	const out = structuredClone(wf);
	const missing = [];
	const tags = (out.tags || []).map((t) => t.name);
	delete out.tags;
	for (const node of out.nodes) {
		for (const [type, ref] of Object.entries(node.credentials || {})) {
			const match = credentials.find((c) => c.name === ref.name && c.type === type);
			if (!match && OPTIONAL_CREDENTIAL_TYPES.has(type)) {
				node.credentials[type] = { name: ref.name };
				missing.push(`${node.name}: ${type} "${ref.name}"`);
				continue;
			}
			if (!match)
				throw new Error(`${out.name} / ${node.name}: no ${type} credential named "${ref.name}"`);
			node.credentials[type] = { id: match.id, name: match.name };
		}
	}
	for (const node of out.nodes) {
		const text = JSON.stringify(node.parameters || {});
		if (!text.includes(OWNER_PLACEHOLDER)) continue;
		if (!/^\d{17,20}$/.test(ownerId || '')) {
			throw new Error(
				`${out.name} / ${node.name}: ownerId "${ownerId}" is not a Discord snowflake`,
			);
		}
		node.parameters = JSON.parse(text.split(OWNER_PLACEHOLDER).join(ownerId));
	}
	return {
		tags,
		missing,
		body: {
			name: out.name,
			nodes: out.nodes,
			connections: out.connections,
			settings: out.settings || {},
		},
	};
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === 'object') {
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((k) => [k, canonical(value[k])]),
		);
	}
	return value;
}

export function sameContent(stored, body) {
	if (!stored) return false;
	const withSettings = 'settings' in stored;
	const pick = (wf) =>
		JSON.stringify(
			canonical({
				nodes: wf.nodes,
				connections: wf.connections,
				...(withSettings ? { settings: wf.settings ?? {} } : {}),
			}),
		);
	return pick(stored) === pick(body);
}

export function client(baseUrl, apiKey) {
	const root = baseUrl.replace(/\/$/, '') + '/api/v1';
	async function call(method, p, body) {
		const res = await fetch(root + p, {
			method,
			headers: {
				'X-N8N-API-KEY': apiKey,
				accept: 'application/json',
				...(body === undefined ? {} : { 'content-type': 'application/json' }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
		const text = await res.text();
		let data;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = text;
		}
		if (!res.ok) {
			const msg =
				typeof data === 'object' && data?.message ? data.message : String(text).slice(0, 500);
			throw new Error(`${method} ${p}: HTTP ${res.status} ${msg}`);
		}
		return data;
	}
	async function all(p) {
		const items = [];
		let cursor;
		do {
			const sep = p.includes('?') ? '&' : '?';
			const page = await call(
				'GET',
				`${p}${sep}limit=250${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
			);
			items.push(...page.data);
			cursor = page.nextCursor;
		} while (cursor);
		return items;
	}
	return { call, all };
}

function columnSpec(c) {
	return typeof c === 'string' ? { name: c, type: 'string' } : { name: c.name, type: c.type };
}

async function ensureTable(api, name, rawColumns) {
	const columns = rawColumns.map(columnSpec);
	const filter = encodeURIComponent(JSON.stringify({ name }));
	const found = (await api.all(`/data-tables?filter=${filter}`)).find((t) => t.name === name);
	if (!found) {
		const created = await api.call('POST', '/data-tables', { name, columns });
		return { id: created.id, created: true, added: [] };
	}
	const existing = await api.call('GET', `/data-tables/${found.id}/columns`);
	const have = new Set(
		(Array.isArray(existing) ? existing : existing.data || []).map((c) => c.name),
	);
	const added = [];
	for (const c of columns) {
		if (!have.has(c.name)) {
			await api.call('POST', `/data-tables/${found.id}/columns`, c);
			added.push(c.name);
		}
	}
	return { id: found.id, created: false, added };
}

async function upsertConfig(api, tableId, key, value) {
	await api.call('POST', `/data-tables/${tableId}/rows/upsert`, {
		filter: { type: 'and', filters: [{ columnName: 'key', condition: 'eq', value: key }] },
		data: { key, value },
	});
}

async function registerListener(api, tableId, workflowId, { name, events }) {
	for (const event of events) {
		await api.call('POST', `/data-tables/${tableId}/rows/upsert`, {
			filter: {
				type: 'and',
				filters: [
					{ columnName: 'event', condition: 'eq', value: event },
					{ columnName: 'name', condition: 'eq', value: name },
				],
			},
			data: { event, workflowId, name },
		});
	}
}

async function readConfig(api, tableId) {
	const rows = await api.all(`/data-tables/${tableId}/rows`);
	return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function ensureTag(api, name) {
	const found = (await api.all('/tags')).find((t) => t.name === name);
	return found ? found.id : (await api.call('POST', '/tags', { name })).id;
}

export async function importDev({
	baseUrl,
	apiKey,
	distDir,
	config = {},
	skip = [],
	log = console.log,
}) {
	for (const key of skip) {
		if (!ORDER.includes(key)) {
			throw new Error(`Unknown IMPORT_SKIP key "${key}". Valid keys: ${ORDER.join(', ')}`);
		}
	}
	const api = client(baseUrl, apiKey);
	const tables = {};
	for (const [name, columns] of Object.entries(TABLES)) {
		const t = await ensureTable(api, name, columns);
		tables[name] = t.id;
		log(
			`data table ${name}: ${t.id}${t.created ? ' (created)' : ''}${t.added.length ? ` (added ${t.added.join(', ')})` : ''}`,
		);
	}
	const cfgTable = tables.discord_config;
	const current = await readConfig(api, cfgTable);
	const wanted = {
		ownerId: config.ownerId ?? current.ownerId ?? DEV_DEFAULTS.ownerId,
		guildIds: config.guildIds
			? JSON.stringify(config.guildIds)
			: (current.guildIds ?? JSON.stringify(DEV_DEFAULTS.guildIds)),
		botUserId: config.botUserId ?? current.botUserId ?? DEV_DEFAULTS.botUserId,
	};
	for (const [key, value] of Object.entries(wanted)) await upsertConfig(api, cfgTable, key, value);
	if (!current.webhookBase)
		await upsertConfig(api, cfgTable, 'webhookBase', DEV_DEFAULTS.webhookBase);
	const ownerId = (await readConfig(api, cfgTable)).ownerId;

	const credentials = await api.all('/credentials');
	const existing = (await api.all('/workflows')).filter((w) => !w.isArchived);
	const tagId = await ensureTag(api, COMMAND_TAG);
	const result = {};
	for (const key of ORDER) {
		if (skip.includes(key)) {
			log(`${key}: skipped`);
			continue;
		}
		const wf = JSON.parse(fs.readFileSync(path.join(distDir, `${key}.json`), 'utf8'));
		const { tags, body, missing } = prepareWorkflow(wf, { credentials, ownerId });
		for (const m of missing)
			log(`warning: credential not found on this n8n, referenced by name only: ${m}`);
		const same = existing.filter((w) => w.name === body.name);
		if (same.length > 1)
			throw new Error(
				`${body.name}: ${same.length} workflows have this name; remove the extras first`,
			);
		let saved;
		let state = 'created';
		if (same.length) {
			const stored = await api.call('GET', `/workflows/${same[0].id}`);
			if (
				sameContent(stored, body) &&
				(!PUBLISH.has(key) || sameContent(stored.activeVersion, body))
			) {
				saved = stored;
				state = 'unchanged';
			} else {
				saved = await api.call('PUT', `/workflows/${same[0].id}`, body);
				state = 'updated';
			}
		} else {
			saved = await api.call('POST', '/workflows', body);
		}
		const tagIds = tags.map((t) => {
			if (t !== COMMAND_TAG) throw new Error(`${body.name}: unexpected tag ${t}`);
			return { id: tagId };
		});
		if (tagIds.length) await api.call('PUT', `/workflows/${saved.id}/tags`, tagIds);
		if (key === 'sync') await upsertConfig(api, cfgTable, 'syncWorkflowId', saved.id);
		if (HELPER_CONFIG_KEYS[key])
			await upsertConfig(api, cfgTable, HELPER_CONFIG_KEYS[key], saved.id);
		if (LISTENERS[key]) {
			await registerListener(api, tables.discord_listeners, saved.id, LISTENERS[key]);
			log(
				`discord_listeners: ${LISTENERS[key].name} -> ${saved.id} (${LISTENERS[key].events.join(', ')})`,
			);
		}
		const publish = PUBLISH.has(key) && state !== 'unchanged';
		if (publish) await api.call('POST', `/workflows/${saved.id}/publish`, {});
		result[key] = { id: saved.id, name: body.name, state, published: PUBLISH.has(key) };
		log(
			`${body.name}: ${saved.id} ${state}${publish ? ', published' : PUBLISH.has(key) ? ', already published' : ', not published'}`,
		);
	}
	return { tables, workflows: result, config: await readConfig(api, cfgTable) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const { N8N_DEV_URL, N8N_DEV_API_KEY } = process.env;
	if (!N8N_DEV_URL || !N8N_DEV_API_KEY) {
		console.error('Set N8N_DEV_URL and N8N_DEV_API_KEY.');
		process.exit(1);
	}
	const botDir = path.dirname(fileURLToPath(import.meta.url));
	const config = {
		ownerId: process.env.DISCORD_OWNER_ID,
		guildIds: process.env.DISCORD_GUILD_IDS
			? process.env.DISCORD_GUILD_IDS.split(',').map((s) => s.trim())
			: undefined,
		botUserId: process.env.DISCORD_BOT_USER_ID,
	};
	importDev({
		baseUrl: N8N_DEV_URL,
		apiKey: N8N_DEV_API_KEY,
		distDir: path.join(botDir, 'dist'),
		config,
		skip: (process.env.IMPORT_SKIP || '').split(',').filter(Boolean),
	})
		.then((r) => {
			if (r.workflows.router)
				console.log(`Discord Router (not published): ${r.workflows.router.id}`);
			console.log(`discord_config: ${JSON.stringify(r.config)}`);
		})
		.catch((error) => {
			console.error(error.message);
			process.exit(1);
		});
}
