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

		const second = createConnection(trigger, token);
		await second.start();
		gateway.closeAll(4014);
		await expect.poll(() => trigger.errors.length).toBe(2);
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

	it('no alertUserId means no REST alert calls', async () => {
		const { trigger, token } = await setup('tok-none');
		const connection = createConnection(trigger, token, '');
		await connection.start();
		await gateway.stop();
		await sleep(300);
		await connection.close();
		expect(trigger.rest.filter((r) => r.method === 'POST')).toHaveLength(0);
	});
});
