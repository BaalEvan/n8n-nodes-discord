import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { classifyInteraction } = loadModule('classify', ['customId']);

const base = { id: 'i1', token: 'tok', application_id: 'app', guild_id: 'g1', channel_id: 'c1' };

describe('classifyInteraction', () => {
	it('type 2 with member.roles', () => {
		const c = classifyInteraction({
			...base,
			type: 2,
			member: { user: { id: 'u1' }, roles: ['r1', 'r2'] },
			data: { name: 'todo', options: [{ name: 'text', type: 3, value: 'x' }] },
		});
		expect(c).toMatchObject({
			kind: 'command',
			commandName: 'todo',
			userId: 'u1',
			roleIds: ['r1', 'r2'],
			guildId: 'g1',
			channelId: 'c1',
			interactionId: 'i1',
			token: 'tok',
			applicationId: 'app',
			options: { text: 'x' },
			subcommand: null,
			resolved: {},
			messageId: null,
		});
	});
	it('type 2 with user and no member gives roleIds []', () => {
		const c = classifyInteraction({
			id: 'i',
			token: 't',
			application_id: 'a',
			type: 2,
			user: { id: 'u9' },
			data: { name: 'ping' },
		});
		expect(c.userId).toBe('u9');
		expect(c.roleIds).toEqual([]);
		expect(c.guildId).toBeNull();
		expect(c.options).toEqual({});
	});
	it('flattens a subcommand and exposes its name', () => {
		const c = classifyInteraction({
			...base,
			type: 2,
			user: { id: 'u' },
			data: { name: 'todo', options: [{ name: 'add', type: 1, options: [{ name: 'text', type: 3, value: 'x' }] }] },
		});
		expect(c.subcommand).toBe('add');
		expect(c.options).toEqual({ text: 'x' });
	});
	it('flattens a subcommand group two levels deep', () => {
		const c = classifyInteraction({
			...base,
			type: 2,
			user: { id: 'u' },
			data: {
				name: 'x',
				options: [
					{ name: 'get', type: 2, options: [{ name: 'id', type: 1, options: [{ name: 'id', type: 4, value: '5' }] }] },
				],
			},
		});
		expect(c.subcommand).toBe('get id');
		expect(c.options).toEqual({ id: '5' });
	});
	it('passes resolved through', () => {
		const resolved = { attachments: { 1: { url: 'u' } } };
		const c = classifyInteraction({ ...base, type: 2, user: { id: 'u' }, data: { name: 'x', resolved } });
		expect(c.resolved).toBe(resolved);
	});
	it('type 4 gives autocomplete with focused option', () => {
		const c = classifyInteraction({
			...base,
			type: 4,
			user: { id: 'u' },
			data: {
				name: 'x',
				options: [
					{ name: 'a', type: 3, value: 'v' },
					{ name: 'q', type: 3, value: 'par', focused: true },
				],
			},
		});
		expect(c).toMatchObject({ kind: 'autocomplete', commandName: 'x', focused: 'q', options: { a: 'v', q: 'par' } });
	});
	it('type 3 select gives values and decoded custom_id', () => {
		const c = classifyInteraction({
			...base,
			type: 3,
			user: { id: 'u' },
			message: { id: 'm1' },
			data: { custom_id: 'cmd:pick:a:b', component_type: 3, values: ['one', 'two'] },
		});
		expect(c).toMatchObject({
			kind: 'component',
			commandName: 'cmd',
			action: 'pick',
			payload: 'a:b',
			values: ['one', 'two'],
			messageId: 'm1',
		});
	});
	it('type 3 with a stale custom_id has no commandName', () => {
		const c = classifyInteraction({ ...base, type: 3, user: { id: 'u' }, data: { custom_id: 'legacy' } });
		expect(c.kind).toBe('component');
		expect(c.commandName).toBeNull();
		expect(c.action).toBeNull();
	});
	it('type 5 gives fields', () => {
		const c = classifyInteraction({
			...base,
			type: 5,
			user: { id: 'u' },
			data: {
				custom_id: 'cmd:edit:7',
				components: [
					{ type: 1, components: [{ type: 4, custom_id: 'title', value: 'Hi' }] },
					{ type: 1, components: [{ type: 4, custom_id: 'body', value: 'There' }] },
				],
			},
		});
		expect(c).toMatchObject({
			kind: 'modal',
			commandName: 'cmd',
			action: 'edit',
			payload: '7',
			fields: { title: 'Hi', body: 'There' },
		});
	});
	it('unknown type and empty input do not crash', () => {
		expect(classifyInteraction({ type: 1 }).kind).toBe('unknown');
		expect(classifyInteraction(undefined).kind).toBe('unknown');
	});
});
