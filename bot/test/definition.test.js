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

describe('parseDefinition scope', () => {
	const parse = (o) => parseDefinition(JSON.stringify({ name: 'x', description: 'x', ...o }));
	it('leaves a guild command without contexts or integration_types', () => {
		expect(parse({}).definition).toEqual({ name: 'x', description: 'x' });
		expect(parse({ scope: 'guild' }).ok).toBe(true);
	});
	it('defaults contexts and integration_types for a global command', () => {
		const r = parse({ scope: 'global' });
		expect(r.ok).toBe(true);
		expect(r.definition.contexts).toEqual([0, 1, 2]);
		expect(r.definition.integration_types).toEqual([0, 1]);
	});
	it('keeps contexts and integration_types given on a global command', () => {
		const r = parse({ scope: 'global', contexts: [0], integration_types: [1] });
		expect(r.definition.contexts).toEqual([0]);
		expect(r.definition.integration_types).toEqual([1]);
	});
	it('rejects an unknown scope', () => {
		const r = parse({ scope: 'everywhere' });
		expect(r.ok).toBe(false);
		expect(r.errors).toContain('scope: must be "guild" or "global"');
	});
	it('rejects bad contexts and integration_types', () => {
		expect(parse({ scope: 'global', contexts: [3] }).errors).toContain(
			'contexts: must be a non-empty array of distinct values from 0, 1, 2',
		);
		expect(parse({ scope: 'global', contexts: [] }).ok).toBe(false);
		expect(parse({ scope: 'global', contexts: [0, 0] }).ok).toBe(false);
		expect(parse({ scope: 'global', contexts: '0' }).ok).toBe(false);
		expect(parse({ scope: 'global', integration_types: [2] }).errors).toContain(
			'integration_types: must be a non-empty array of distinct values from 0, 1',
		);
	});
	it('rejects contexts and integration_types on a guild command', () => {
		expect(parse({ contexts: [0] }).errors).toContain('contexts: only for "scope": "global"');
		expect(parse({ scope: 'guild', integration_types: [0] }).errors).toContain(
			'integration_types: only for "scope": "global"',
		);
	});
	it('validates whitelist.everyone as a boolean', () => {
		expect(parse({ whitelist: { everyone: true } }).ok).toBe(true);
		expect(parse({ whitelist: { everyone: 'yes' } }).errors).toContain('whitelist.everyone: must be a boolean');
	});
});
