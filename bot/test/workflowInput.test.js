import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { workflowInput } = loadModule('workflowInput');

describe('workflowInput', () => {
	it('passes the kind as mode and the classified interaction', () => {
		const classified = { kind: 'modal', commandName: 'x' };
		expect(workflowInput(classified)).toEqual({ mode: 'modal', interaction: classified });
	});
	it('uses the kind for every interaction type', () => {
		for (const kind of ['command', 'autocomplete', 'component', 'modal']) {
			expect(workflowInput({ kind }).mode).toBe(kind);
		}
	});
});
