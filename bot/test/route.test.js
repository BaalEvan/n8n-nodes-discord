import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { decideRoute } = loadModule('route', ['definition', 'whitelist', 'customId']);

const OWNER = 'own';
const def = {
	name: 'mail',
	description: 'Mail',
	whitelist: { users: ['u1'] },
	ephemeral: true,
	modals: {
		edit: {
			title: 'Edit',
			fields: [
				{ id: 'title', label: 'Title', style: 'short', required: true, maxLength: 40 },
				{ id: 'body', label: 'Body', style: 'paragraph' },
			],
		},
	},
};
const row = { workflowId: 'wf1', definition: JSON.stringify(def) };
const cls = (o = {}) => ({
	kind: 'command',
	commandName: 'mail',
	action: null,
	payload: null,
	userId: 'u1',
	roleIds: [],
	guildId: 'g1',
	...o,
});

describe('decideRoute', () => {
	it('stranger gives refuse', () => {
		const r = decideRoute(cls({ userId: 'nobody' }), row, OWNER);
		expect(r.route).toBe('refuse');
		expect(r.ephemeral).toBe(true);
	});
	it('missing row for a command gives unknownCommand', () => {
		expect(decideRoute(cls(), null, OWNER)).toMatchObject({ route: 'unknownCommand', ephemeral: true });
	});
	it('command gives deferCommand with workflowId', () => {
		expect(decideRoute(cls(), row, OWNER)).toMatchObject({ route: 'deferCommand', workflowId: 'wf1' });
	});
	it('ephemeral comes from the definition', () => {
		expect(decideRoute(cls(), row, OWNER).ephemeral).toBe(true);
		const open = { workflowId: 'w', definition: JSON.stringify({ ...def, ephemeral: false }) };
		expect(decideRoute(cls(), open, OWNER).ephemeral).toBe(false);
		const none = {
			workflowId: 'w',
			definition: JSON.stringify({ name: 'mail', description: 'd', whitelist: { users: ['u1'] } }),
		};
		expect(decideRoute(cls(), none, OWNER).ephemeral).toBe(false);
	});
	it('autocomplete gives autocomplete', () => {
		expect(decideRoute(cls({ kind: 'autocomplete' }), row, OWNER).route).toBe('autocomplete');
	});
	it('button with a modal action gives openModal with the same custom_id', () => {
		const r = decideRoute(cls({ kind: 'component', action: 'edit', payload: '7' }), row, OWNER);
		expect(r.route).toBe('openModal');
		expect(r.modal.custom_id).toBe('mail:edit:7');
		expect(r.modal.title).toBe('Edit');
		const inputs = r.modal.components.map((c) => c.components[0]);
		expect(inputs[0]).toMatchObject({ type: 4, custom_id: 'title', label: 'Title', style: 1, required: true, max_length: 40 });
		expect(inputs[1]).toMatchObject({ custom_id: 'body', style: 2 });
	});
	it('button without a modal action defers an update', () => {
		expect(decideRoute(cls({ kind: 'component', action: 'archive', payload: 'x' }), row, OWNER)).toMatchObject({
			route: 'deferUpdate',
			workflowId: 'wf1',
		});
	});
	it('modal submit gives deferUpdate', () => {
		expect(decideRoute(cls({ kind: 'modal', action: 'edit', payload: '7' }), row, OWNER)).toMatchObject({
			route: 'deferUpdate',
			workflowId: 'wf1',
		});
	});
	it('stale custom_id gives unknownComponent', () => {
		expect(decideRoute(cls({ kind: 'component', commandName: null }), row, OWNER).route).toBe('unknownComponent');
		expect(decideRoute(cls({ kind: 'component', action: 'a', payload: 'p' }), null, OWNER).route).toBe('unknownComponent');
		expect(decideRoute(cls({ kind: 'modal', commandName: null }), row, OWNER).route).toBe('unknownComponent');
	});
	it('an unparseable stored definition is treated as unavailable', () => {
		expect(decideRoute(cls(), { workflowId: 'w', definition: '{' }, OWNER).route).toBe('unknownCommand');
	});
	it('refused component click gives refuse, ephemeral', () => {
		const r = decideRoute(cls({ kind: 'component', action: 'archive', payload: 'x', userId: 'nobody' }), row, OWNER);
		expect(r).toMatchObject({ route: 'refuse', ephemeral: true });
	});
	it('stale modal action does not open a modal', () => {
		const r = decideRoute(cls({ kind: 'component', action: 'gone', payload: '7' }), row, OWNER);
		expect(r.route).toBe('deferUpdate');
		expect(r.modal).toBeUndefined();
	});
	it('refused autocomplete gives refuseAutocomplete', () => {
		expect(decideRoute(cls({ kind: 'autocomplete', userId: 'nobody' }), row, OWNER).route).toBe('refuseAutocomplete');
	});
	it('autocomplete on an unavailable command gives refuseAutocomplete', () => {
		expect(decideRoute(cls({ kind: 'autocomplete' }), null, OWNER).route).toBe('refuseAutocomplete');
		expect(decideRoute(cls({ kind: 'autocomplete' }), { workflowId: 'w', definition: '{' }, OWNER).route).toBe('refuseAutocomplete');
	});
	it('unknown kind gives unknownCommand', () => {
		expect(decideRoute(cls({ kind: 'unknown' }), row, OWNER).route).toBe('unknownCommand');
	});
});
