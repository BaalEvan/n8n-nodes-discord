import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { filterMessage, listenerInputs } = loadModule('listeners');

const BOT = 'bot1';

describe('filterMessage', () => {
	it('maps MESSAGE_CREATE to create and keeps the message', () => {
		const message = { id: 'm1', author: { id: 'u1' }, content: 'hi' };
		expect(filterMessage('MESSAGE_CREATE', message, BOT)).toEqual({ event: 'create', message });
	});
	it('maps MESSAGE_UPDATE and MESSAGE_DELETE', () => {
		expect(filterMessage('MESSAGE_UPDATE', { id: 'm1' }, BOT).event).toBe('update');
		expect(filterMessage('MESSAGE_DELETE', { id: 'm1', channel_id: 'c1' }, BOT)).toEqual({
			event: 'delete',
			message: { id: 'm1', channel_id: 'c1' },
		});
	});
	it('drops the bot own messages on create and update', () => {
		expect(filterMessage('MESSAGE_CREATE', { id: 'm1', author: { id: BOT } }, BOT)).toBeNull();
		expect(filterMessage('MESSAGE_UPDATE', { id: 'm1', author: { id: BOT } }, BOT)).toBeNull();
	});
	it('keeps webhook messages, whose author id differs from the bot', () => {
		const message = { id: 'm1', webhook_id: 'w1', author: { id: 'w1', bot: true } };
		expect(filterMessage('MESSAGE_CREATE', message, BOT)).toEqual({ event: 'create', message });
	});
	it('keeps a delete even when it has no author', () => {
		expect(filterMessage('MESSAGE_DELETE', { id: 'm1' }, BOT).event).toBe('delete');
	});
	it('drops events that are not message events', () => {
		expect(filterMessage('INTERACTION_CREATE', {}, BOT)).toBeNull();
		expect(filterMessage('GUILD_CREATE', {}, BOT)).toBeNull();
	});
	it('drops everything when the bot user id is unknown, so no listener sees its own output', () => {
		expect(filterMessage('MESSAGE_CREATE', { id: 'm1', author: { id: 'u1' } }, '')).toBeNull();
		expect(filterMessage('MESSAGE_CREATE', { id: 'm1', author: { id: 'u1' } }, undefined)).toBeNull();
	});
	it('treats a missing message as an empty object', () => {
		expect(filterMessage('MESSAGE_DELETE', undefined, BOT)).toEqual({ event: 'delete', message: {} });
	});
});

describe('listenerInputs', () => {
	const filtered = { event: 'create', message: { id: 'm1' } };
	it('gives one input per listener row with the row name and workflow id', () => {
		const rows = [
			{ id: 1, event: 'create', workflowId: 'wfA', name: 'A' },
			{ id: 2, event: 'create', workflowId: 'wfB', name: 'B' },
		];
		expect(listenerInputs(rows, filtered)).toEqual([
			{ event: 'create', message: { id: 'm1' }, listener: { name: 'A', workflowId: 'wfA' } },
			{ event: 'create', message: { id: 'm1' }, listener: { name: 'B', workflowId: 'wfB' } },
		]);
	});
	it('skips rows without a workflow id (empty lookup output)', () => {
		expect(listenerInputs([{}, { workflowId: '' }, null], filtered)).toEqual([]);
	});
	it('gives nothing without a filtered message', () => {
		expect(listenerInputs([{ workflowId: 'wfA', name: 'A' }], null)).toEqual([]);
	});
	it('stringifies numeric workflow ids', () => {
		expect(listenerInputs([{ workflowId: 12, name: 'A' }], filtered)[0].listener.workflowId).toBe('12');
	});
});
