import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { reloadReply } = loadModule('reload');

describe('reloadReply', () => {
	it('reports the number of registered commands', () => {
		expect(reloadReply({ registered: 2, skipped: [], guilds: ['g1'] })).toEqual({ content: 'Registered 2 commands.' });
	});
	it('lists skipped names when there are any', () => {
		expect(reloadReply({ registered: 1, skipped: ['Discord Command: a: no published version', 'b'] })).toEqual({
			content: 'Registered 1 commands.\nSkipped:\n- Discord Command: a: no published version\n- b',
		});
	});
	it('shows the sync error when the sync failed', () => {
		expect(reloadReply({ error: 'Sync aborted:\na: bad' })).toEqual({ content: 'Sync aborted:\na: bad' });
	});
	it('reports a missing report as a failure, not as zero commands', () => {
		expect(reloadReply({})).toEqual({ content: 'Sync returned no report. Check the Discord Sync execution log.' });
		expect(reloadReply(undefined).content).toMatch(/^Sync returned no report/);
	});
});
