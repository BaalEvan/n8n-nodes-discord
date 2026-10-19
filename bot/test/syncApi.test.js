import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { toSyncWorkflows, parseGuildIds, syncReport, syncAbortMessage } = loadModule('syncApi');

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
	it('counts commands and lists skipped and guilds', () => {
		const built = { commands: [{ name: 'a' }, { name: 'b' }], skipped: ['x: no published version'] };
		expect(syncReport(built, ['g1'])).toEqual({ registered: 2, skipped: ['x: no published version'], guilds: ['g1'] });
	});
});

describe('syncAbortMessage', () => {
	it('starts with Sync aborted and lists one error per line', () => {
		expect(syncAbortMessage(['a: bad', 'b: worse'])).toBe('Sync aborted:\na: bad\nb: worse');
	});
});
