import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { reloadReply } = loadModule('reload');

describe('reloadReply', () => {
	it('reports the number of registered commands', () => {
		expect(reloadReply({ registered: 2, skipped: [], guilds: ['g1'] })).toEqual({ content: 'Registered 2 commands.' });
	});
	it('lists skipped names when there are any', () => {
		expect(reloadReply({ registered: 1, skipped: ['Discord Command: a: no published version', 'b'] })).toEqual({
			content: 'Registered 1 command.\nSkipped:\n- Discord Command: a: no published version\n- b',
		});
	});
	it('shows the sync error when the sync failed', () => {
		expect(reloadReply({ error: 'Sync aborted:\na: bad' })).toEqual({ content: 'Sync aborted:\na: bad' });
	});
	it('reports a missing report as a failure, not as zero commands', () => {
		expect(reloadReply({})).toEqual({ content: 'Sync returned no report. Check the Discord Sync execution log.' });
		expect(reloadReply(undefined).content).toMatch(/^Sync returned no report/);
	});
	it('reports server and global counts', () => {
		expect(reloadReply({ registered: 5, global: 2, globalSkipped: false, skipped: [] })).toEqual({
			content: 'Registered 5 server commands and 2 global commands.',
		});
	});
	it('says when global commands were skipped', () => {
		expect(reloadReply({ registered: 5, global: 2, globalSkipped: true, skipped: ['b'] })).toEqual({
			content: 'Registered 5 server commands; 2 global commands skipped (registerGlobal is off).\nSkipped:\n- b',
		});
	});
	it('uses the singular for one command', () => {
		expect(reloadReply({ registered: 1, global: 1, globalSkipped: false, skipped: [] }).content).toBe(
			'Registered 1 server command and 1 global command.',
		);
		expect(reloadReply({ registered: 0, global: 1, globalSkipped: true, skipped: [] }).content).toBe(
			'Registered 0 server commands; 1 global command skipped (registerGlobal is off).',
		);
	});
});

describe('reloadReply per guild', () => {
	it('shows the count for each server', () => {
		expect(
			reloadReply({
				registered: 6,
				global: 4,
				globalSkipped: false,
				skipped: [],
				guilds: [{ guildId: '181510887037861898', count: 4 }, { guildId: '1280482154249457685', count: 3 }],
			}).content,
		).toBe('Registered 4 server commands on 181510887037861898, 3 on 1280482154249457685 and 4 global commands.');
	});
	it('handles one server, singular and skipped global', () => {
		expect(
			reloadReply({ registered: 1, global: 2, globalSkipped: true, skipped: [], guilds: [{ guildId: 'g', count: 1 }] }).content,
		).toBe('Registered 1 server command on g; 2 global commands skipped (registerGlobal is off).');
		expect(reloadReply({ registered: 2, skipped: [], guilds: [{ guildId: 'g', count: 2 }] }).content).toBe(
			'Registered 2 commands on g.',
		);
	});
});
