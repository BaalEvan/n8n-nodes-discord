import { LoggerProxy } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	identifyBudgetFor,
	registryKey,
	tokenFingerprint,
} from '../nodes/DiscordTrigger/connectionRegistry';
import { DiscordTrigger } from '../nodes/DiscordTrigger/DiscordTrigger.node';
import { FakeGateway } from './support/fakeGateway';
import { createFakeTrigger, type FakeTriggerOptions } from './support/fakeTrigger';

const noop = () => {};
const MANUAL_ERROR =
	'This bot token is in use by an active Discord Trigger. Use the test bot token for manual runs.';

describe('connection registry', () => {
	let gateway: FakeGateway;
	let url: string;
	let closers: Array<() => Promise<void>>;
	const node = new DiscordTrigger();

	beforeEach(async () => {
		LoggerProxy.init({ error: noop, warn: noop, info: noop, debug: noop } as never);
		gateway = new FakeGateway();
		url = await gateway.start();
		closers = [];
	});

	afterEach(async () => {
		for (const close of closers) await close();
		await gateway.stop();
	});

	async function activate(options: Partial<FakeTriggerOptions> = {}) {
		const fake = createFakeTrigger({ gatewayUrl: url, ...options });
		const response = await node.trigger.call(fake);
		const close = response.closeFunction ?? (async () => {});
		closers.push(close);
		return { fake, close };
	}

	it('fingerprints tokens and builds keys', () => {
		expect(tokenFingerprint('abc')).toMatch(/^[0-9a-f]{16}$/);
		expect(tokenFingerprint('abc')).toBe(tokenFingerprint('abc'));
		expect(tokenFingerprint('abc')).not.toBe(tokenFingerprint('abd'));
		expect(registryKey('w', 'n', 'manual')).toBe('w:n:manual');
	});

	it('manual run on a production-held token is refused', async () => {
		await activate({ workflowId: 'A', token: 'tok-1' });
		await expect.poll(() => gateway.connections.length).toBe(1);

		await expect(activate({ workflowId: 'A', token: 'tok-1', mode: 'manual' })).rejects.toThrow(
			MANUAL_ERROR,
		);
		expect(gateway.connections.length).toBe(1);
		expect(gateway.openConnections).toBe(1);
	});

	it('manual run on another token works and leaves production alone', async () => {
		await activate({ workflowId: 'A', token: 'tok-1' });
		const manual = await activate({ workflowId: 'A', token: 'tok-2', mode: 'manual' });
		await expect.poll(() => gateway.openConnections).toBe(2);

		await manual.close();
		await expect.poll(() => gateway.openConnections).toBe(1);
		expect(gateway.connections.filter((c) => c.closeCode === undefined).length).toBe(1);
	});

	it('second production trigger on the same token is refused', async () => {
		await activate({ workflowId: 'A', nodeId: 'n1', token: 'tok-1' });
		await expect(activate({ workflowId: 'B', nodeId: 'n2', token: 'tok-1' })).rejects.toThrow(
			'This bot token is already used by another active Discord Trigger (A:n1:trigger). Only one active trigger per bot token is allowed.',
		);
		await expect.poll(() => gateway.connections.length).toBe(1);
		expect(gateway.openConnections).toBe(1);
	});

	it('re-activation of the same trigger replaces its own connection', async () => {
		await activate({ workflowId: 'A', token: 'tok-1' });
		await expect.poll(() => gateway.connections.length).toBe(1);
		await activate({ workflowId: 'A', token: 'tok-1' });

		await expect.poll(() => gateway.connections.length).toBe(2);
		await expect.poll(() => gateway.connections[0].closeCode).toBe(1000);
		await expect.poll(() => gateway.openConnections).toBe(1);
	});

	it('closeFunction releases the token', async () => {
		const a = await activate({ workflowId: 'A', nodeId: 'n1', token: 'tok-1' });
		await a.close();
		await activate({ workflowId: 'B', nodeId: 'n2', token: 'tok-1' });
		await expect.poll(() => gateway.connections.length).toBe(2);
		await expect.poll(() => gateway.openConnections).toBe(1);
	});

	it('shares one identify budget per token across reconnections', async () => {
		const fp = tokenFingerprint('tok-budget');
		const first = identifyBudgetFor(fp);
		expect(identifyBudgetFor(fp)).toBe(first);
		expect(identifyBudgetFor(tokenFingerprint('other'))).not.toBe(first);

		const a = await activate({ workflowId: 'A', token: 'tok-budget' });
		await expect.poll(() => first.count()).toBe(1);
		await a.close();
		await activate({ workflowId: 'A', token: 'tok-budget' });
		await expect.poll(() => first.count()).toBe(2);
		expect(identifyBudgetFor(fp)).toBe(first);
	});
});
