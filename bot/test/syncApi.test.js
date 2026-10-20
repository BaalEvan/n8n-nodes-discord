import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { toSyncWorkflows, parseGuildIds, syncReport, syncAbortMessage, configValues, globalPlan } =
	loadModule('syncApi');

const defNode = { name: 'Command Definition', parameters: { jsonOutput: '{"name":"a","description":"A"}' } };

describe('toSyncWorkflows', () => {
	it('uses activeVersion.nodes as the published nodes', () => {
		const r = toSyncWorkflows([
			{ id: 'w1', name: 'Discord Command: a', active: true, nodes: [], activeVersion: { nodes: [defNode] } },
		]);
		expect(r.skipped).toEqual([]);
		expect(r.errors).toEqual([]);
		expect(r.workflows).toEqual([{ id: 'w1', name: 'Discord Command: a', active: true, publishedNodes: [defNode] }]);
	});
	it('skips a workflow without activeVersion and reports it', () => {
		const r = toSyncWorkflows([{ id: 'w1', name: 'Discord Command: a', active: true, nodes: [defNode] }]);
		expect(r.workflows).toEqual([]);
		expect(r.skipped).toEqual(['Discord Command: a: no published version']);
	});
	it('ignores an unpublished workflow silently', () => {
		const r = toSyncWorkflows([{ id: 'w1', name: 'x', active: false, activeVersion: null }]);
		expect(r).toEqual({ workflows: [], skipped: [], errors: [] });
	});
	it('reports an error when no workflow was found, so nothing is overwritten with []', () => {
		const error = ['no discord-command workflows found'];
		expect(toSyncWorkflows([{}, null])).toEqual({ workflows: [], skipped: [], errors: error });
		expect(toSyncWorkflows([])).toEqual({ workflows: [], skipped: [], errors: error });
		expect(toSyncWorkflows(undefined).errors).toEqual(error);
	});
	it('stringifies ids', () => {
		expect(toSyncWorkflows([{ id: 7, name: 'x', activeVersion: { nodes: [] } }]).workflows[0].id).toBe('7');
	});
});

describe('parseGuildIds', () => {
	it('parses a JSON array of ids', () => {
		expect(parseGuildIds('["181510887037861898"]')).toEqual(['181510887037861898']);
		expect(parseGuildIds('[1, "2"]')).toEqual(['1', '2']);
	});
	it('throws a clear error for a missing, empty or malformed value', () => {
		const msg = 'discord_config row "guildIds" must hold a JSON array of server IDs';
		expect(() => parseGuildIds(undefined)).toThrow(msg);
		expect(() => parseGuildIds('')).toThrow(msg);
		expect(() => parseGuildIds('[]')).toThrow(msg);
		expect(() => parseGuildIds('181510887037861898')).toThrow(msg);
		expect(() => parseGuildIds('{"a":1}')).toThrow(msg);
		expect(() => parseGuildIds('[""]')).toThrow(msg);
	});
});

describe('syncReport', () => {
	const built = {
		guildCommands: [{ name: 'a' }, { name: 'b' }],
		globalCommands: [{ name: 'p' }],
		skipped: ['x: no published version'],
	};
	it('counts server and global commands and lists skipped and guilds', () => {
		expect(syncReport(built, ['g1'], true)).toEqual({
			registered: 2,
			global: 1,
			globalSkipped: false,
			skipped: ['x: no published version'],
			guilds: ['g1'],
		});
	});
	it('marks global as skipped when registerGlobal is off', () => {
		expect(syncReport(built, ['g1'], false)).toMatchObject({ registered: 2, global: 1, globalSkipped: true });
	});
});

describe('configValues', () => {
	it('maps key/value rows and ignores empty items', () => {
		expect(
			configValues([{ json: { key: 'guildIds', value: '["g"]' } }, { json: {} }, { json: { key: 'registerGlobal', value: 'true' } }]),
		).toEqual({ guildIds: '["g"]', registerGlobal: 'true' });
		expect(configValues(undefined)).toEqual({});
	});
});

describe('globalPlan', () => {
	const built = { globalCommands: [{ name: 'p', contexts: [0, 1, 2], integration_types: [0, 1] }] };
	it('registers only when registerGlobal is exactly "true"', () => {
		expect(globalPlan(built, { registerGlobal: 'true' }, 'app1')).toEqual({
			registerGlobal: true,
			applicationId: 'app1',
			commands: built.globalCommands,
		});
		for (const value of [undefined, '', 'false', 'TRUE', ' true', true, '1']) {
			expect(globalPlan(built, { registerGlobal: value }, 'app1').registerGlobal, String(value)).toBe(false);
		}
	});
	it('defaults to an empty list', () => {
		expect(globalPlan({}, { registerGlobal: 'true' }, 'a').commands).toEqual([]);
	});
});

describe('syncAbortMessage', () => {
	it('starts with Sync aborted and lists one error per line', () => {
		expect(syncAbortMessage(['a: bad', 'b: worse'])).toBe('Sync aborted:\na: bad\nb: worse');
	});
});

describe('guildTargets', () => {
	const { buildCommandList } = loadModule('syncPayload', ['definition']);
	const { guildTargets } = loadModule('syncApi', ['definition', 'syncPayload']);
	const D = '181510887037861898';
	const G = '1280482154249457685';
	const node = (def) => [{ name: 'Command Definition', parameters: { jsonOutput: JSON.stringify(def) } }];
	const wf = (id, def) => ({ id, name: 'w' + id, active: true, publishedNodes: node(def) });
	const built = buildCommandList([
		wf('1', { name: 'plain', description: 'P' }),
		wf('2', { name: 'b2b', description: 'B', guilds: [G] }),
		wf('3', { name: 'client', description: 'C', guilds: [G] }),
	]);
	const names = (t) => t.map((x) => ({ guildId: x.guildId, commands: x.commands.map((c) => c.name) }));
	it('gives default guilds the plain commands and named guilds their own', () => {
		expect(names(guildTargets(built, [D]))).toEqual([
			{ guildId: D, commands: ['plain'] },
			{ guildId: G, commands: ['b2b', 'client'] },
		]);
		expect(guildTargets(built, [D])[0].commands).toEqual([{ name: 'plain', description: 'P' }]);
	});
	it('gives a default guild that is also named both lists once', () => {
		expect(names(guildTargets(built, [D, G]))).toEqual([
			{ guildId: D, commands: ['plain'] },
			{ guildId: G, commands: ['plain', 'b2b', 'client'] },
		]);
	});
	it('works without restrictions', () => {
		expect(names(guildTargets({ guildCommands: [{ name: 'a' }] }, ['x']))).toEqual([{ guildId: 'x', commands: ['a'] }]);
	});
	it('reports per-guild counts', () => {
		const targets = guildTargets(built, [D]);
		const report = syncReport(built, targets.map((t) => ({ guildId: t.guildId, count: t.commands.length })), true);
		expect(report.guilds).toEqual([{ guildId: D, count: 1 }, { guildId: G, count: 2 }]);
	});
});
