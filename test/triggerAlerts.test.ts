import { LoggerProxy, sleep } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscordTrigger } from '../nodes/DiscordTrigger/DiscordTrigger.node';
import { FakeGateway } from './support/fakeGateway';
import { createFakeTrigger, type FakeTriggerOptions } from './support/fakeTrigger';

const captured = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('../nodes/DiscordTrigger/DiscordGatewayConnection', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('../nodes/DiscordTrigger/DiscordGatewayConnection')>();
	class Spy extends actual.DiscordGatewayConnection {
		constructor(...args: ConstructorParameters<typeof actual.DiscordGatewayConnection>) {
			super(...args);
			captured.push((args[3] ?? {}) as Record<string, unknown>);
		}
	}
	return { ...actual, DiscordGatewayConnection: Spy };
});

const noop = () => {};

describe('trigger() alert wiring', () => {
	let gateway: FakeGateway;
	let url: string;
	let closers: Array<() => Promise<void>>;
	const node = new DiscordTrigger();

	beforeEach(async () => {
		LoggerProxy.init({ error: noop, warn: noop, info: noop, debug: noop } as never);
		captured.length = 0;
		gateway = new FakeGateway();
		url = await gateway.start();
		closers = [];
	});

	afterEach(async () => {
		for (const close of closers) await close();
		await gateway.stop();
	});

	async function activate(options: Partial<FakeTriggerOptions>) {
		const fake = createFakeTrigger({ gatewayUrl: url, ...options });
		const response = await node.trigger.call(fake);
		closers.push(response.closeFunction ?? (async () => {}));
		return fake;
	}

	const messagePosts = (fake: { rest: Array<{ method: string; url: string }> }) =>
		fake.rest.filter((r) => r.method === 'POST' && r.url.endsWith('/messages'));

	it('activation failure with a bad token DMs the owner once', async () => {
		const fake = createFakeTrigger({
			gatewayUrl: url,
			token: 'tok-wire-401',
			gatewayBotHttpStatus: 401,
			params: { alertUserId: '42', alertAfterMinutes: 1 },
		});
		await expect(node.trigger.call(fake)).rejects.toThrow();
		await expect.poll(() => messagePosts(fake).length).toBe(1);
		await sleep(100);
		expect(messagePosts(fake)).toHaveLength(1);
		expect(fake.rest.filter((r) => r.url.endsWith('/users/@me/channels'))).toHaveLength(1);
	});

	it('empty alertUserId makes no alert calls and builds no sink', async () => {
		const fake = createFakeTrigger({
			gatewayUrl: url,
			token: 'tok-wire-none',
			gatewayBotHttpStatus: 401,
			params: { alertUserId: '', alertAfterMinutes: 1 },
		});
		await expect(node.trigger.call(fake)).rejects.toThrow();
		await sleep(100);
		expect(fake.rest.filter((r) => r.method === 'POST')).toHaveLength(0);
		expect(captured[0].alertSink).toBeUndefined();
	});

	it('converts alertAfterMinutes to milliseconds', async () => {
		await activate({ token: 'tok-wire-ms', params: { alertUserId: '42', alertAfterMinutes: 3 } });
		expect(captured[0].alertSink).toBeDefined();
		expect(captured[0].alertAfterMs).toBe(180_000);
	});
});
