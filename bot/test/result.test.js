import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { toDiscordMessage, toFollowups } = loadModule('result');

describe('toDiscordMessage', () => {
	it('truncates 2500 chars to 2000 ending in …', () => {
		const m = toDiscordMessage({ content: 'a'.repeat(2500) }, false);
		expect(m.content).toHaveLength(2000);
		expect(m.content.endsWith('…')).toBe(true);
		expect(m.content.startsWith('a'.repeat(1999))).toBe(true);
	});
	it('keeps content of exactly 2000 chars', () => {
		expect(toDiscordMessage({ content: 'a'.repeat(2000) }, false).content).toHaveLength(2000);
	});
	it('undefined gives Done. ephemeral', () => {
		expect(toDiscordMessage(undefined, false)).toMatchObject({ content: 'Done.', flags: 64 });
		expect(toDiscordMessage({}, false)).toMatchObject({ content: 'Done.', flags: 64 });
	});
	it('uses the default ephemeral flag unless the result overrides it', () => {
		expect(toDiscordMessage({ content: 'x' }, true).flags).toBe(64);
		expect(toDiscordMessage({ content: 'x' }, false).flags).toBe(0);
		expect(toDiscordMessage({ content: 'x', ephemeral: false }, true).flags).toBe(0);
		expect(toDiscordMessage({ content: 'x', ephemeral: true }, false).flags).toBe(64);
	});
	it('passes embeds and components through', () => {
		const m = toDiscordMessage({ content: 'x', embeds: [{ title: 't' }], components: [{ type: 1 }] }, false);
		expect(m.embeds).toEqual([{ title: 't' }]);
		expect(m.components).toEqual([{ type: 1 }]);
	});
	it('embeds only is a valid message', () => {
		const m = toDiscordMessage({ embeds: [{ title: 't' }] }, false);
		expect(m.content).toBe('');
		expect(m.embeds).toHaveLength(1);
	});
	it('followups without content give the Done. edit', () => {
		expect(toDiscordMessage({ followups: [{ content: 'a' }] }, false)).toMatchObject({ content: 'Done.' });
		expect(toDiscordMessage({ followup: { content: 'a' } }, false)).toMatchObject({ content: 'Done.' });
	});
	it('does not drop or require a binary file', () => {
		expect(toDiscordMessage({ content: 'got it', file: 'ignored' }, false).content).toBe('got it');
	});
});

describe('toFollowups', () => {
	it('keeps at most 10, in order', () => {
		const followups = Array.from({ length: 12 }, (_, i) => ({ content: 'm' + i }));
		const out = toFollowups({ followups });
		expect(out).toHaveLength(10);
		expect(out[0].content).toBe('m0');
		expect(out[9].content).toBe('m9');
	});
	it('accepts a single followup as a one-element alias', () => {
		expect(toFollowups({ followup: { content: 'a' } })).toHaveLength(1);
	});
	it('cuts content, drops empties, sets flags', () => {
		const out = toFollowups({
			followups: [{ content: 'a'.repeat(2500), ephemeral: true }, {}, { content: '' }, { embeds: [{ title: 't' }] }, null],
		});
		expect(out).toHaveLength(2);
		expect(out[0].content).toHaveLength(2000);
		expect(out[0].content.endsWith('…')).toBe(true);
		expect(out[0].flags).toBe(64);
		expect(out[1]).toEqual({ content: '', embeds: [{ title: 't' }], components: [], flags: 0 });
	});
	it('keeps a components-only followup', () => {
		const out = toFollowups({ followups: [{ components: [{ type: 1 }] }] });
		expect(out).toEqual([{ content: '', embeds: [], components: [{ type: 1 }], flags: 0 }]);
	});
	it('returns [] for no followups', () => {
		expect(toFollowups(undefined)).toEqual([]);
		expect(toFollowups({ content: 'x' })).toEqual([]);
	});
});
