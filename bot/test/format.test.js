import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { formatResult, commandErrorText, isErrorResult } = loadModule('format', ['result']);

const command = (o = {}) => ({ route: 'deferCommand', ephemeral: false, classified: { commandName: 'ping' }, ...o });
const update = (o = {}) => command({ route: 'deferUpdate', ...o });

describe('commandErrorText', () => {
	it('uses the global constraints copy', () => {
		expect(commandErrorText('ping')).toBe(
			'Something went wrong running /ping. The details are in the n8n execution log.',
		);
	});
});

describe('isErrorResult', () => {
	it('recognises the item n8n emits for a failed sub-workflow', () => {
		expect(isErrorResult({ error: 'boom' })).toBe(true);
	});
	it('does not treat a result with other keys as an error', () => {
		expect(isErrorResult({ error: 'x', content: 'y' })).toBe(false);
		expect(isErrorResult({})).toBe(false);
		expect(isErrorResult(undefined)).toBe(false);
	});
});

describe('formatResult for deferCommand', () => {
	it('edits the original with content, embeds and components, without flags', () => {
		const r = formatResult({ content: 'pong' }, false, command());
		expect(r).toEqual({ action: 'edit', message: { content: 'pong', embeds: [], components: [] } });
	});
	it('an empty result becomes Done.', () => {
		expect(formatResult({}, false, command())).toEqual({
			action: 'edit',
			message: { content: 'Done.', embeds: [], components: [] },
		});
	});
	it('truncates long content', () => {
		const r = formatResult({ content: 'a'.repeat(2500) }, false, command());
		expect(r.message.content).toHaveLength(2000);
	});
	it('attaches the file when the item carries binary file', () => {
		expect(formatResult({ content: 'got it' }, true, command()).action).toBe('editWithFile');
	});
	it('a sub-workflow error gives commandError with the copy', () => {
		expect(formatResult({ error: 'boom' }, false, command())).toEqual({
			action: 'commandError',
			errorText: 'Something went wrong running /ping. The details are in the n8n execution log.',
		});
	});
});

describe('formatResult for deferUpdate', () => {
	it('edits the clicked message when the result has a message', () => {
		expect(formatResult({ content: 'clicked x' }, false, update()).action).toBe('edit');
		expect(formatResult({ embeds: [{ title: 't' }] }, false, update()).action).toBe('edit');
		expect(formatResult({ components: [{ type: 1, components: [] }] }, false, update()).action).toBe('edit');
	});
	it('skips the edit when the result has no message, so the clicked message stays', () => {
		expect(formatResult({}, false, update())).toEqual({ action: 'skip' });
		expect(formatResult({ followups: [{ content: 'x' }] }, true, update())).toEqual({ action: 'skip' });
	});
	it('a sub-workflow error gives updateError, so the clicked message is not overwritten', () => {
		expect(formatResult({ error: 'boom' }, false, update()).action).toBe('updateError');
	});
});
