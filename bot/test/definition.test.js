import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { parseDefinition } = loadModule('definition');

const opt = (name) => ({ name, description: 'd', type: 3 });

describe('parseDefinition', () => {
	it('accepts the minimal { name, description }', () => {
		const r = parseDefinition(JSON.stringify({ name: 'ping', description: 'Pong' }));
		expect(r.ok).toBe(true);
		expect(r.definition.name).toBe('ping');
	});
	it('rejects uppercase names', () => {
		const r = parseDefinition(JSON.stringify({ name: 'Ping', description: 'x' }));
		expect(r.ok).toBe(false);
		expect(r.errors[0]).toBe('name: must match ^[-_\\p{Ll}\\p{N}]{1,32}$');
	});
	it('rejects 26 options', () => {
		const options = Array.from({ length: 26 }, (_, i) => opt('o' + i));
		const r = parseDefinition(JSON.stringify({ name: 'x', description: 'x', options }));
		expect(r.ok).toBe(false);
		expect(r.errors.join()).toContain('options: at most 25');
	});
	it('names the offending option index and field', () => {
		const options = [opt('a'), opt('b'), opt('BAD')];
		const r = parseDefinition(JSON.stringify({ name: 'x', description: 'x', options }));
		expect(r.errors).toContain('options[2].name: must match ^[-_\\p{Ll}\\p{N}]{1,32}$');
	});
	it('rejects invalid JSON and non-objects', () => {
		expect(parseDefinition('{nope').ok).toBe(false);
		expect(parseDefinition('[]').ok).toBe(false);
	});
	it('rejects descriptions outside 1-100 characters', () => {
		expect(parseDefinition(JSON.stringify({ name: 'x', description: '' })).ok).toBe(false);
		expect(parseDefinition(JSON.stringify({ name: 'x', description: 'a'.repeat(101) })).ok).toBe(false);
	});
	it('rejects more than 25 choices', () => {
		const choices = Array.from({ length: 26 }, (_, i) => ({ name: 'c' + i, value: i }));
		const options = [{ ...opt('a'), choices }];
		const r = parseDefinition(JSON.stringify({ name: 'x', description: 'x', options }));
		expect(r.errors.join()).toContain('options[0].choices: at most 25');
	});
	it('validates whitelist, ephemeral and modals', () => {
		const bad = parseDefinition(
			JSON.stringify({
				name: 'x',
				description: 'x',
				whitelist: { users: [1], roles: 'r' },
				ephemeral: 'yes',
				modals: { 'a:b': { title: 't', fields: [] } },
			}),
		);
		expect(bad.ok).toBe(false);
		expect(bad.errors.length).toBeGreaterThanOrEqual(4);
		const good = parseDefinition(
			JSON.stringify({
				name: 'x',
				description: 'x',
				whitelist: { users: ['1'], roles: ['2'] },
				ephemeral: true,
				modals: {
					edit: { title: 'T', fields: [{ id: 'f', label: 'L', style: 'short', required: true, maxLength: 50 }] },
				},
			}),
		);
		expect(good.ok).toBe(true);
	});
});
