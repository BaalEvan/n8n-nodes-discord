import { LoggerProxy, NodeOperationError, sleep, type IDataObject } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
	DiscordGatewayConnection,
	type DiscordGatewayConnectionOptions,
} from '../nodes/DiscordTrigger/DiscordGatewayConnection';
import { FatalGatewayError } from '../nodes/DiscordTrigger/errors';
import { IdentifyBudget } from '../nodes/DiscordTrigger/reconnectPolicy';
import { PACKAGE_VERSION } from '../nodes/DiscordTrigger/version';
import { FakeGateway } from './support/fakeGateway';
import {
	createFakeTrigger,
	gatewaySettings,
	type FakeTrigger,
	type FakeTriggerOptions,
} from './support/fakeTrigger';

const backoff = { baseDelayMs: 10, maxDelayMs: 50, random: () => 0.5 };
const noop = () => {};

describe('DiscordGatewayConnection', () => {
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

	function create(
		trigger: FakeTrigger,
		options: DiscordGatewayConnectionOptions = {},
	): DiscordGatewayConnection {
		const connection = new DiscordGatewayConnection(
			trigger,
			gatewaySettings(trigger),
			(data) => trigger.emitted.push(data),
			{
				backoff,
				identifySpacingMs: 0,
				invalidSessionWait: { minMs: 0, maxMs: 0 },
				...options,
			},
		);
		connections.push(connection);
		return connection;
	}

	async function setup(
		triggerOptions: Partial<FakeTriggerOptions> = {},
		options: DiscordGatewayConnectionOptions = {},
	) {
		const url = await gateway.start();
		const trigger = createFakeTrigger({ gatewayUrl: url, ...triggerOptions });
		return { trigger, connection: create(trigger, options) };
	}

	const countOp = (op: number) =>
		gateway.connections.reduce(
			(total, connection) => total + connection.received.filter((m) => m.op === op).length,
			0,
		);

	const emittedEvents = (trigger: FakeTrigger) => trigger.emitted.map((item) => item.event);

	async function forceResumeViaAckLoss(trigger: FakeTrigger) {
		await expect.poll(() => trigger.staticData.sessionId).toBe('sess-1');
		gateway.ackHeartbeats = false;
		await expect.poll(() => gateway.connections.length).toBeGreaterThanOrEqual(2);
		gateway.ackHeartbeats = true;
		return gateway.connections[1];
	}

	it('reconnects past five failures', async () => {
		const { trigger, connection } = await setup({ failGatewayBotTimes: 8 });
		await connection.start();
		await expect.poll(() => gateway.connections.length, { timeout: 2000 }).toBe(1);
		await expect.poll(() => countOp(2), { timeout: 2000 }).toBe(1);
		expect(trigger.rest.filter((r) => r.url.endsWith('/gateway/bot')).length).toBe(9);
	});

	it('start() resolves when the gateway is unreachable at activation', async () => {
		const { trigger, connection } = await setup({ failGatewayBotTimes: 3 });
		await expect(connection.start()).resolves.toBeUndefined();
		await expect.poll(() => trigger.staticData.sessionId).toBe('sess-1');
		expect(gateway.connections.length).toBe(1);
	});

	it('heartbeat ACK loss resumes on resume_gateway_url', async () => {
		const { trigger, connection } = await setup();
		await connection.start();
		const resumed = await forceResumeViaAckLoss(trigger);
		expect(resumed.path).toBe('/resume');
		await expect
			.poll(() => resumed.received.find((m) => m.op === 6)?.d)
			.toMatchObject({ session_id: 'sess-1' });
		await expect.poll(() => gateway.connections[0].closeCode).toBe(4900);
	});

	it('session id survives RESUMED', async () => {
		const { trigger, connection } = await setup();
		await connection.start();
		await forceResumeViaAckLoss(trigger);
		await expect.poll(() => emittedEvents(trigger)).toContain('RESUMED');
		gateway.dispatch('MESSAGE_CREATE', {});
		await expect.poll(() => emittedEvents(trigger)).toContain('MESSAGE_CREATE');
		const staticData = trigger.getWorkflowStaticData('node');
		expect(staticData.sessionId).toBe('sess-1');
		expect(staticData.resumeGatewayUrl).toMatch(/\/resume$/);
	});

	it('op 7 triggers resume', async () => {
		const { connection } = await setup();
		await connection.start();
		gateway.sendToAll({ op: 7, d: null });
		await expect.poll(() => gateway.connections.length).toBe(2);
		const resumed = gateway.connections[1];
		expect(resumed.path).toBe('/resume');
		await expect
			.poll(() => resumed.received.find((m) => m.op === 6)?.d)
			.toMatchObject({ session_id: 'sess-1' });
		expect(resumed.received.some((m) => m.op === 2)).toBe(false);
	});

	it('INVALID_SESSION false identifies fresh', async () => {
		const { trigger, connection } = await setup();
		await connection.start();
		gateway.onResume = 'invalid';
		gateway.sendToAll({ op: 7, d: null });
		await expect.poll(() => gateway.connections.length).toBeGreaterThanOrEqual(3);
		const [, resumeAttempt, fresh] = gateway.connections;
		expect(resumeAttempt.path).toBe('/resume');
		expect(resumeAttempt.received.some((m) => m.op === 6)).toBe(true);
		await expect.poll(() => fresh.received.some((m) => m.op === 2)).toBe(true);
		expect(fresh.received.some((m) => m.op === 6)).toBe(false);
		expect(fresh.path).toBe('/');
		await expect.poll(() => trigger.staticData.sessionId).toBe('sess-2');
	});

	it('stale saved session from an older build', async () => {
		const { trigger, connection } = await setup({
			staticData: { sessionId: 'old', sequence: 5, resumeGatewayUrl: 'ws://127.0.0.1:1/resume' },
		});
		gateway.onResume = 'invalid';
		await connection.start();
		await expect.poll(() => trigger.staticData.sessionId).toBe('sess-1');
		expect(gateway.connections).toHaveLength(1);
		const [first] = gateway.connections;
		expect(first.path).toBe('/');
		expect(first.received.some((m) => m.op === 2)).toBe(true);
		expect(first.received.some((m) => m.op === 6)).toBe(false);
		gateway.dispatch('MESSAGE_CREATE', {});
		await expect.poll(() => emittedEvents(trigger)).toContain('MESSAGE_CREATE');
	});

	it('fatal code before READY rejects', async () => {
		const { connection } = await setup();
		gateway.onIdentify = { closeWith: 4004 };
		const error = await connection.start().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(FatalGatewayError);
		expect((error as FatalGatewayError).closeCode).toBe(4004);
	});

	it('fatal code after READY stops for good', async () => {
		const { trigger, connection } = await setup();
		await connection.start();
		gateway.closeAll(4014);
		await expect.poll(() => trigger.errors.length).toBe(1);
		await sleep(300);
		expect(gateway.connections.length).toBe(1);
		expect(trigger.errors.length).toBe(1);
		expect(trigger.errors[0]).toBeInstanceOf(NodeOperationError);
		expect(trigger.errors[0].message).toContain('4014');
	});

	it('deliberate close clears session and closes 1000', async () => {
		const { trigger, connection } = await setup();
		await connection.start();
		expect(trigger.staticData.sessionId).toBe('sess-1');
		await connection.close();
		await expect.poll(() => gateway.connections[0].closeCode).toBe(1000);
		expect(trigger.staticData).not.toHaveProperty('sessionId');
		expect(trigger.staticData).not.toHaveProperty('sequence');
		expect(trigger.staticData).not.toHaveProperty('resumeGatewayUrl');

		await create(trigger).start();
		await expect.poll(() => gateway.connections.length).toBe(2);
		const next = gateway.connections[1];
		expect(next.received.some((m) => m.op === 2)).toBe(true);
		expect(next.received.some((m) => m.op === 6)).toBe(false);
	});

	it('first heartbeat is jittered', async () => {
		const { connection } = await setup();
		gateway.heartbeatIntervalMs = 200;
		await connection.start();
		const [first] = gateway.connections;
		await expect.poll(() => first.received.findIndex((m) => m.op === 1)).toBeGreaterThanOrEqual(0);
		const index = first.received.findIndex((m) => m.op === 1);
		expect(first.receivedAt[index] - first.helloAt).toBeGreaterThanOrEqual(90);
	});

	it('identify budget pauses identifies', async () => {
		const { connection } = await setup({}, { identifyBudget: new IdentifyBudget(3) });
		gateway.onIdentify = { closeWith: 4003 };
		await connection.start();
		await expect.poll(() => countOp(2)).toBe(3);
		await sleep(300);
		expect(countOp(2)).toBe(3);
	});

	it('HTTP 401 from /gateway/bot at activation is fatal', async () => {
		const { trigger, connection } = await setup({ gatewayBotHttpStatus: 401 });
		const error = await connection.start().catch((e: unknown) => e);
		expect(error).toBeInstanceOf(FatalGatewayError);
		expect((error as FatalGatewayError).closeCode).toBe(4004);
		expect(gateway.connections.length).toBe(0);
		expect(trigger.rest.length).toBe(1);
	});

	it('HTTP 403 from /gateway/bot is transient', async () => {
		const { trigger, connection } = await setup({ gatewayBotHttpStatus: 403 });
		await expect(connection.start()).resolves.toBeUndefined();
		const gatewayBotCalls = () => trigger.rest.filter((r) => r.url.endsWith('/gateway/bot')).length;
		await expect.poll(gatewayBotCalls).toBeGreaterThanOrEqual(3);
		expect(trigger.errors).toHaveLength(0);
		trigger.gatewayBotHttpStatus = undefined;
		await expect.poll(() => trigger.staticData.sessionId).toBe('sess-1');
		expect(trigger.errors).toHaveLength(0);
	});

	it('HTTP 401 from /gateway/bot on reconnect stops for good', async () => {
		const { trigger, connection } = await setup();
		await connection.start();
		trigger.gatewayBotHttpStatus = 401;
		gateway.sendToAll({ op: 9, d: false });
		await expect.poll(() => trigger.errors.length).toBe(1);
		await sleep(300);
		expect(trigger.errors.length).toBe(1);
		expect(trigger.errors[0]).toBeInstanceOf(NodeOperationError);
		expect(gateway.connections.length).toBe(1);
		expect(trigger.rest.filter((r) => r.url.endsWith('/gateway/bot')).length).toBe(2);
	});

	it('a failed handshake closes its socket before reconnecting', async () => {
		const { trigger, connection } = await setup();
		gateway.malformedIdentifyReplies = 1;
		await connection.start();
		await expect.poll(() => trigger.staticData.sessionId).toBe('sess-1');
		await expect.poll(() => gateway.connections[0].closeCode).toBe(4900);
		await expect.poll(() => gateway.openConnections).toBe(1);
		expect(gateway.connections.length).toBe(2);
	});

	it('a missing HELLO times out and retries', async () => {
		const { trigger, connection } = await setup({}, { connectTimeoutMs: 100 });
		gateway.sendHello = false;
		await connection.start();
		await expect.poll(() => gateway.connections.length).toBeGreaterThanOrEqual(2);
		gateway.sendHello = true;
		await expect.poll(() => trigger.staticData.sessionId, { timeout: 2000 }).toBe('sess-1');
		expect(gateway.connections[0].closeCode).toBe(4900);
	});

	it('logs the package version on READY and RESUMED', async () => {
		const logs: Array<{ message: string; meta: IDataObject }> = [];
		LoggerProxy.init({
			error: noop,
			warn: noop,
			debug: noop,
			info: (message: string, meta: IDataObject) => logs.push({ message, meta }),
		} as never);
		const { connection } = await setup();
		await connection.start();
		const connected = () => logs.filter((l) => l.message === 'Discord Gateway connected');
		expect(connected()[0].meta).toMatchObject({
			version: PACKAGE_VERSION,
			sessionId: 'sess-1',
			resumed: false,
		});
		gateway.sendToAll({ op: 7, d: null });
		await expect.poll(() => connected().length).toBe(2);
		expect(connected()[1].meta).toMatchObject({
			version: PACKAGE_VERSION,
			sessionId: 'sess-1',
			resumed: true,
		});
	});

	it('passes a timeout to GET /gateway/bot', async () => {
		const { trigger, connection } = await setup();
		await connection.start();
		const request = trigger.requests.find((r) => String(r.url).endsWith('/gateway/bot'));
		expect(request?.timeout).toBe(15000);
	});

	it('backoff keeps growing when every session drops right after READY', async () => {
		const { connection } = await setup(
			{},
			{ backoff: { baseDelayMs: 20, maxDelayMs: 1000, random: () => 0.5 } },
		);
		gateway.closeAfterReady = 4000;
		await connection.start();
		await expect.poll(() => gateway.connections.length, { timeout: 3000 }).toBeGreaterThanOrEqual(6);
		const hellos = gateway.connections.map((c) => c.helloAt);
		expect(hellos[5] - hellos[4]).toBeGreaterThanOrEqual(200);
	});

	it('backoff resets once a session stays up for the stable period', async () => {
		const { connection } = await setup(
			{},
			{ backoff: { baseDelayMs: 20, maxDelayMs: 1000, random: () => 0.5 }, stablePeriodMs: 100 },
		);
		gateway.closeAfterReady = 4000;
		await connection.start();
		await expect.poll(() => gateway.connections.length, { timeout: 3000 }).toBeGreaterThanOrEqual(4);
		gateway.closeAfterReady = null;
		await expect.poll(() => gateway.openConnections, { timeout: 3000 }).toBe(1);
		const count = gateway.connections.length;
		await sleep(250);
		expect(gateway.connections.length).toBe(count);
		const droppedAt = Date.now();
		gateway.closeAll(4000);
		await expect.poll(() => gateway.connections.length).toBe(count + 1);
		expect(gateway.connections[count].helloAt - droppedAt).toBeLessThan(100);
	});

	it('spaces IDENTIFY sends by the identify interval', async () => {
		const { connection } = await setup({}, { identifySpacingMs: 150 });
		gateway.onIdentify = { closeWith: 4003 };
		await connection.start();
		await expect.poll(() => countOp(2), { timeout: 3000 }).toBeGreaterThanOrEqual(3);
		const identifyTimes = gateway.connections
			.map((c) => c.receivedAt[c.received.findIndex((m) => m.op === 2)])
			.filter((t) => t !== undefined);
		for (let i = 1; i < identifyTimes.length; i++) {
			expect(identifyTimes[i] - identifyTimes[i - 1]).toBeGreaterThanOrEqual(140);
		}
	});

	it('waits after INVALID_SESSION before identifying again', async () => {
		const { trigger, connection } = await setup(
			{},
			{ invalidSessionWait: { minMs: 100, maxMs: 300 } },
		);
		await connection.start();
		const sentAt = Date.now();
		gateway.sendToAll({ op: 9, d: false });
		await expect.poll(() => gateway.connections.length).toBe(2);
		expect(gateway.connections[1].helloAt - sentAt).toBeGreaterThanOrEqual(190);
		await expect.poll(() => trigger.staticData.sessionId).toBe('sess-2');
	});

	it('waits after INVALID_SESSION on a resume before identifying', async () => {
		const { trigger, connection } = await setup(
			{},
			{ invalidSessionWait: { minMs: 100, maxMs: 300 } },
		);
		await connection.start();
		gateway.onResume = 'invalid';
		gateway.sendToAll({ op: 7, d: null });
		await expect.poll(() => gateway.connections.length).toBe(3);
		const [, resumeAttempt, fresh] = gateway.connections;
		const resumeSentAt = resumeAttempt.receivedAt[resumeAttempt.received.findIndex((m) => m.op === 6)];
		expect(fresh.helloAt - resumeSentAt).toBeGreaterThanOrEqual(190);
		await expect.poll(() => trigger.staticData.sessionId).toBe('sess-2');
	});

	it('falls back to IDENTIFY after three failed resumes', async () => {
		const { trigger, connection } = await setup();
		await connection.start();
		gateway.rejectResumes = true;
		gateway.sendToAll({ op: 7, d: null });
		await expect.poll(() => trigger.staticData.sessionId, { timeout: 3000 }).toBe('sess-2');
		expect(gateway.connections.map((c) => c.path)).toEqual(['/', '/resume', '/resume', '/resume', '/']);
		expect(gateway.connections[4].received.some((m) => m.op === 2)).toBe(true);
	});

	it('still reconnects when handling a disconnect throws', async () => {
		LoggerProxy.init({
			error: noop,
			info: noop,
			debug: noop,
			warn: (message: string) => {
				if (message === 'Discord Gateway disconnected, reconnecting') throw new Error('logger down');
			},
		} as never);
		const { trigger, connection } = await setup();
		await connection.start();
		gateway.sendToAll({ op: 7, d: null });
		await expect.poll(() => gateway.connections.length).toBe(2);
		await expect.poll(() => emittedEvents(trigger)).toContain('RESUMED');
	});
});
