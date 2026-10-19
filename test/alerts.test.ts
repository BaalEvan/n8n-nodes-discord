import { LoggerProxy, sleep } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { alertText, createDmAlertSink } from '../nodes/DiscordTrigger/alerts';
import { getCloseCodeMeta } from '../nodes/DiscordTrigger/closeCodes';
import { DiscordGatewayConnection } from '../nodes/DiscordTrigger/DiscordGatewayConnection';
import { FakeGateway } from './support/fakeGateway';
import { createFakeTrigger, type FakeTrigger } from './support/fakeTrigger';

const backoff = { baseDelayMs: 10, maxDelayMs: 50, random: () => 0.5 };
const noop = () => {};

const meta4014 = getCloseCodeMeta(4014)!;
const fatal4014 = alertText('fatal', {
	code: 4014,
	name: meta4014.name,
	description: meta4014.description,
});

describe('owner alerts', () => {
	let gateway: FakeGateway;
	let connections: DiscordGatewayConnection[];

	beforeEach(() => {
		gateway = new FakeGateway();
		connections = [];
	});

	afterEach(async () => {
		LoggerProxy.init({ error: noop, warn: noop, info: noop, debug: noop } as never);
		for (const connection of connections) await connection.close();
		await gateway.stop();
	});

	async function setup(token: string) {
		const url = await gateway.start();
		return { trigger: createFakeTrigger({ gatewayUrl: url, token }), token };
	}

	function createConnection(trigger: FakeTrigger, token: string, userId = '42') {
		const connection = new DiscordGatewayConnection(trigger, '*', noop, {
			backoff,
			token,
			alertSink: userId ? createDmAlertSink(trigger, userId) : undefined,
			alertAfterMs: 100,
			outageCheckMs: 20,
		});
		connections.push(connection);
		return connection;
	}

	const messagePosts = (trigger: FakeTrigger) =>
		trigger.rest.filter((r) => r.method === 'POST' && r.url.endsWith('/messages'));
	const channelPosts = (trigger: FakeTrigger) =>
		trigger.rest.filter((r) => r.method === 'POST' && r.url.endsWith('/users/@me/channels'));
	const contents = (trigger: FakeTrigger) =>
		messagePosts(trigger).map((r) => (r.body as { content: string }).content);

	it('fatal alert DMs the owner once', async () => {
		const { trigger, token } = await setup('tok-fatal-once');
		const first = createConnection(trigger, token);
		await first.start();
		gateway.closeAll(4014);
		await expect.poll(() => contents(trigger)).toEqual([fatal4014]);
		expect(channelPosts(trigger)).toHaveLength(1);
		expect(channelPosts(trigger)[0].body).toEqual({ recipient_id: '42' });

		gateway.onIdentify = { closeWith: 4014 };
		const second = createConnection(trigger, token);
		await expect(second.start()).rejects.toThrow();
		await sleep(150);
		expect(messagePosts(trigger)).toHaveLength(1);
	});

	it('down then recovered', async () => {
		const { trigger, token } = await setup('tok-down');
		const connection = createConnection(trigger, token);
		await connection.start();
		const port = gateway.port;
		await gateway.stop();
		await expect
			.poll(() => contents(trigger))
			.toEqual([alertText('down', { minutes: 1 })]);
		await sleep(150);
		expect(contents(trigger)).toHaveLength(1);

		await gateway.start(port);
		await expect
			.poll(() => contents(trigger))
			.toEqual([alertText('down', { minutes: 1 }), alertText('recovered', { minutes: 1 })]);
	});

	it('failing alert does not crash', async () => {
		const { trigger, token } = await setup('tok-fail');
		trigger.failMessagePosts = Infinity;
		const connection = createConnection(trigger, token);
		await connection.start();
		gateway.closeAll(4014);
		await expect.poll(() => trigger.errors.length).toBe(1);
		await expect.poll(() => messagePosts(trigger).length).toBe(1);
		await sleep(150);
		expect(messagePosts(trigger)).toHaveLength(1);
		expect(trigger.errors).toHaveLength(1);
	});

	it('a failed down alert is retried on the next check', async () => {
		const { trigger, token } = await setup('tok-retry');
		trigger.failMessagePosts = 2;
		const connection = createConnection(trigger, token);
		await connection.start();
		await gateway.stop();
		await expect.poll(() => messagePosts(trigger).length).toBeGreaterThanOrEqual(3);
		await sleep(150);
		expect(messagePosts(trigger)).toHaveLength(3);
	});

	it('logs a failed alert without request details', async () => {
		const warnings: unknown[][] = [];
		LoggerProxy.init({
			error: noop,
			warn: (...a: unknown[]) => warnings.push(a),
			info: noop,
			debug: noop,
		} as never);
		const { trigger, token } = await setup('tok-log');
		trigger.failMessagePosts = 1;
		const sink = createDmAlertSink(trigger, '42');
		expect(await sink.send('down', 'x')).toBe(false);
		const alertWarnings = warnings.filter((w) => w[0] === 'Discord owner alert failed');
		expect(alertWarnings).toHaveLength(1);
		const meta = alertWarnings[0][1] as Record<string, unknown>;
		expect(meta.kind).toBe('down');
		expect(meta.error).toBe('fake message POST failure');
		expect(Object.keys(meta).sort()).toEqual(['error', 'kind', 'nodeType', 'status']);
		expect(JSON.stringify(meta)).not.toContain(token);
	});

	it('retries the channel POST after it failed', async () => {
		const { trigger } = await setup('tok-chan');
		trigger.failChannelPosts = 1;
		const sink = createDmAlertSink(trigger, '42');
		expect(await sink.send('down', 'a')).toBe(false);
		expect(await sink.send('down', 'a')).toBe(true);
		expect(channelPosts(trigger)).toHaveLength(2);
		expect(messagePosts(trigger)).toHaveLength(1);
	});

	it('a later fatal on the same token alerts again after a READY', async () => {
		const { trigger, token } = await setup('tok-rearm');
		const first = createConnection(trigger, token);
		await first.start();
		gateway.closeAll(4014);
		await expect.poll(() => messagePosts(trigger).length).toBe(1);

		const second = createConnection(trigger, token);
		await second.start();
		await expect.poll(() => gateway.openConnections).toBe(1);
		gateway.closeAll(4014);
		await expect.poll(() => messagePosts(trigger).length).toBe(2);
	});

	it('sends recovered when READY arrives while the down alert is in flight', async () => {
		const { trigger, token } = await setup('tok-inflight');
		let release = noop;
		trigger.messagePostGate = new Promise<void>((resolve) => (release = resolve));
		const connection = createConnection(trigger, token);
		await connection.start();
		const port = gateway.port;
		await gateway.stop();
		await expect.poll(() => messagePosts(trigger).length).toBe(1);
		await gateway.start(port);
		await expect.poll(() => gateway.connections.length).toBeGreaterThanOrEqual(2);
		await sleep(150);
		release();
		await expect
			.poll(() => contents(trigger).map((c) => c.slice(0, 22)))
			.toEqual(['Discord bot has been d', 'Discord bot reconnecte']);
	});

	it('retries a failed recovered alert on the next check', async () => {
		const { trigger, token } = await setup('tok-recov');
		const connection = createConnection(trigger, token);
		await connection.start();
		const port = gateway.port;
		await gateway.stop();
		await expect.poll(() => messagePosts(trigger).length).toBe(1);
		trigger.failMessagePosts = 1;
		await gateway.start(port);
		await expect.poll(() => messagePosts(trigger).length).toBe(3);
		await sleep(150);
		expect(messagePosts(trigger)).toHaveLength(3);
		expect(contents(trigger)[2]).toBe(alertText('recovered', { minutes: 1 }));
	});
});
