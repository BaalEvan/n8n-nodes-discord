import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { buildCommandList } = loadModule('syncPayload', ['definition']);

const defNode = (def) => ({
	name: 'Command Definition',
	parameters: { jsonOutput: typeof def === 'string' ? def : JSON.stringify(def) },
});
const wf = (id, name, def, o = {}) => ({
	id,
	name: 'Discord Command: ' + name,
	active: true,
	versionId: 'v1',
	activeVersionId: 'v1',
	nodes: [defNode(def)],
	...o,
});

describe('buildCommandList', () => {
	it('builds commands and a routing table, stripping private keys', () => {
		const def = {
			name: 'a',
			description: 'A',
			whitelist: { users: ['1'] },
			ephemeral: true,
			modals: {},
			options: [{ name: 'o', description: 'd', type: 3 }],
		};
		const r = buildCommandList([wf('1', 'a', def)]);
		expect(r.errors).toEqual([]);
		expect(r.guildCommands).toEqual([{ name: 'a', description: 'A', options: [{ name: 'o', description: 'd', type: 3 }] }]);
		expect(r.table).toHaveLength(1);
		expect(r.table[0]).toMatchObject({ name: 'a', workflowId: '1' });
		expect(JSON.parse(r.table[0].definition).whitelist.users).toEqual(['1']);
	});
	it('draft-only change gives skipped', () => {
		const r = buildCommandList([
			wf('1', 'a', { name: 'a', description: 'A' }, { versionId: 'v2', activeVersionId: 'v1' }),
		]);
		expect(r.guildCommands).toEqual([]);
		expect(r.skipped).toEqual(['Discord Command: a: has unpublished changes']);
		expect(r.errors).toEqual([]);
	});
	it('prefers publishedNodes over a diverged draft', () => {
		const r = buildCommandList([
			wf(
				'1',
				'a',
				{ name: 'draft', description: 'D' },
				{ versionId: 'v2', activeVersionId: 'v1', publishedNodes: [defNode({ name: 'live', description: 'L' })] },
			),
		]);
		expect(r.guildCommands.map((c) => c.name)).toEqual(['live']);
		expect(r.skipped).toEqual([]);
	});
	it('one invalid definition gives errors and commands is still computed', () => {
		const r = buildCommandList([
			wf('1', 'a', { name: 'a', description: 'A' }),
			wf('2', 'bad', { name: 'Bad', description: 'x' }),
		]);
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toContain('Discord Command: bad');
		expect(r.errors[0]).toContain('name: must match');
		expect(r.guildCommands.map((c) => c.name)).toEqual(['a']);
	});
	it('duplicate names give an error naming both workflows', () => {
		const r = buildCommandList([
			wf('1', 'one', { name: 'x', description: 'A' }),
			wf('2', 'two', { name: 'x', description: 'B' }),
		]);
		expect(r.errors).toHaveLength(1);
		expect(r.errors[0]).toContain('Discord Command: one');
		expect(r.errors[0]).toContain('Discord Command: two');
		expect(r.guildCommands).toHaveLength(1);
	});
	it('inactive is ignored silently', () => {
		const r = buildCommandList([wf('1', 'a', { name: 'a', description: 'A' }, { active: false })]);
		expect(r).toMatchObject({ guildCommands: [], globalCommands: [], table: [], errors: [], skipped: [] });
	});
	it('reports a missing Command Definition node and unparseable JSON', () => {
		const none = buildCommandList([
			{ id: '1', name: 'W', active: true, versionId: 'v', activeVersionId: 'v', nodes: [] },
		]);
		expect(none.errors[0]).toContain('W: no "Command Definition" node');
		const broken = buildCommandList([wf('1', 'a', '{oops')]);
		expect(broken.errors).toHaveLength(1);
	});
	it('accepts an expression-prefixed jsonOutput', () => {
		const r = buildCommandList([wf('1', 'a', '=' + JSON.stringify({ name: 'a', description: 'A' }))]);
		expect(r.errors).toEqual([]);
		expect(r.guildCommands).toHaveLength(1);
	});
	it('errors above 100 commands', () => {
		const list = Array.from({ length: 101 }, (_, i) => wf(String(i), 'c' + i, { name: 'c' + i, description: 'd' }));
		expect(buildCommandList(list).errors.join()).toContain('at most 100');
	});
	it('splits guild and global commands into one table', () => {
		const r = buildCommandList([
			wf('1', 'a', { name: 'a', description: 'A', whitelist: { users: ['1'] } }),
			wf('2', 'p', {
				name: 'p',
				description: 'P',
				scope: 'global',
				ephemeral: false,
				whitelist: { everyone: true, users: [], roles: [] },
				options: [{ name: 'url', description: 'u', type: 3 }],
			}),
			wf('3', 'q', { name: 'q', description: 'Q', scope: 'global', contexts: [0, 1], integration_types: [1] }),
			wf('4', 'g', { name: 'g', description: 'G', scope: 'guild' }),
		]);
		expect(r.errors).toEqual([]);
		expect(r.guildCommands).toEqual([
			{ name: 'a', description: 'A' },
			{ name: 'g', description: 'G' },
		]);
		expect(r.globalCommands).toEqual([
			{
				name: 'p',
				description: 'P',
				options: [{ name: 'url', description: 'u', type: 3 }],
				contexts: [0, 1, 2],
				integration_types: [0, 1],
			},
			{ name: 'q', description: 'Q', contexts: [0, 1], integration_types: [1] },
		]);
		expect(r.table.map((t) => t.name)).toEqual(['a', 'p', 'q', 'g']);
		expect(r.commands).toBeUndefined();
	});
	it('a name used by a guild and a global command is an error', () => {
		const r = buildCommandList([
			wf('1', 'one', { name: 'x', description: 'A' }),
			wf('2', 'two', { name: 'x', description: 'B', scope: 'global' }),
		]);
		expect(r.errors).toEqual([
			'command name "x" is used by a server command (Discord Command: one) and a global command (Discord Command: two)',
		]);
		expect(r.globalCommands).toEqual([]);
	});
	it('errors above 100 global commands', () => {
		const list = Array.from({ length: 101 }, (_, i) =>
			wf(String(i), 'c' + i, { name: 'c' + i, description: 'd', scope: 'global' }),
		);
		const r = buildCommandList(list);
		expect(r.errors).toEqual(['too many global commands: at most 100, found 101']);
	});
});
