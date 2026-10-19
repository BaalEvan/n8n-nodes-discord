import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { encodeCustomId, decodeCustomId } = loadModule('customId');

describe('customId', () => {
	it("round-trips 'important-emails:archive:work:1234'", () => {
		const id = 'important-emails:archive:work:1234';
		const d = decodeCustomId(id);
		expect(d).toEqual({ command: 'important-emails', action: 'archive', payload: 'work:1234' });
		expect(encodeCustomId(d.command, d.action, d.payload)).toBe(id);
	});
	it('encode throws at 101 chars', () => {
		expect(() => encodeCustomId('a', 'b', 'x'.repeat(97))).toThrow('custom_id exceeds 100 characters');
		expect(encodeCustomId('a', 'b', 'x'.repeat(96))).toHaveLength(100);
	});
	it('encode rejects ":" in command or action', () => {
		expect(() => encodeCustomId('a:b', 'c', 'p')).toThrow('command and action must not contain ":"');
		expect(() => encodeCustomId('a', 'c:d', 'p')).toThrow('command and action must not contain ":"');
	});
	it("decode returns null for 'foo' and 'a:b'", () => {
		expect(decodeCustomId('foo')).toBeNull();
		expect(decodeCustomId('a:b')).toBeNull();
		expect(decodeCustomId(undefined)).toBeNull();
	});
	it('decode accepts an empty payload', () => {
		expect(decodeCustomId('a:b:')).toEqual({ command: 'a', action: 'b', payload: '' });
	});
});
