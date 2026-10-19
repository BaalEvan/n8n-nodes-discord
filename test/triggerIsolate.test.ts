import { LoggerProxy, sleep } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { alertText } from '../nodes/DiscordTrigger/alerts';
import { getCloseCodeMeta } from '../nodes/DiscordTrigger/closeCodes';
import { DiscordTrigger } from '../nodes/DiscordTrigger/DiscordTrigger.node';
import { FakeGateway } from './support/fakeGateway';
import {
	createFakeTrigger,
	runTrigger,
	type FakeTrigger,
	type FakeTriggerOptions,
} from './support/fakeTrigger';

vi.mock('../nodes/DiscordTrigger/DiscordGatewayConnection', async (importOriginal) => {
	const actual =
		await importOriginal<typeof import('../nodes/DiscordTrigger/DiscordGatewayConnection')>();
	class FastConnection extends actual.DiscordGatewayConnection {
		constructor(...args: ConstructorParameters<typeof actual.DiscordGatewayConnection>) {
			const [trigger, settings, onEvent, options] = args;
			super(trigger, settings, onEvent, {
				backoff: { baseDelayMs: 10, maxDelayMs: 50, random: () => 0.5 },
				identifySpacingMs: 0,
				invalidSessionWait: { minMs: 0, maxMs: 0 },
				outageCheckMs: 20,
				stablePeriodMs: 20,
				...options,
				alertAfterMs: 100,
			});
		}
	}
	return { ...actual, DiscordGatewayConnection: FastConnection };
});

const noop = () => {};
const meta4014 = getCloseCodeMeta(4014)!;
const fatal4014 = alertText('fatal', {
	code: 4014,
	name: meta4014.name,
	description: meta4014.description,
});

describe('trigger() background work outside the expression isolate', () => {
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

	async function activate(options: Partial<FakeTriggerOptions>) {
		const fake = createFakeTrigger({ gatewayUrl: url, ...options });
		const response = await runTrigger(node, fake);
		closers.push(response.closeFunction ?? (async () => {}));
		await expect.poll(() => fake.staticData.sessionId).toBe('sess-1');
		return fake;
	}

	const bridgeErrors = (fake: FakeTrigger) => fake.bridgeErrors.map((e) => e.message);

	async function settle(fake: FakeTrigger, done: () => boolean, timeout = 3000) {
		await expect.poll(() => done() || fake.bridgeErrors.length > 0, { timeout }).toBe(true);
		expect(bridgeErrors(fake)).toEqual([]);
	}

	const backgroundRest = (fake: FakeTrigger) => fake.rest.slice(1);

	it('identifies again after INVALID_SESSION false', async () => {
		const fake = await activate({ token: 'tok-iso-invalid' });
		gateway.sendToAll({ op: 9, d: false });
		await settle(fake, () => fake.staticData.sessionId === 'sess-2');
		expect(fake.staticData.sessionId).toBe('sess-2');
		const [, fresh] = gateway.connections;
		expect(fresh.received.some((m) => m.op === 2)).toBe(true);
		expect(fake.rest.filter((r) => r.url.endsWith('/gateway/bot'))).toHaveLength(2);
		expect(fake.rest.every((r) => r.helper === 'httpRequest')).toBe(true);
	});

	it('identifies again after three failed resumes', async () => {
		const fake = await activate({ token: 'tok-iso-resumes' });
		gateway.rejectResumes = true;
		gateway.sendToAll({ op: 7, d: null });
		await settle(fake, () => fake.staticData.sessionId === 'sess-2');
		expect(gateway.connections.map((c) => c.path)).toEqual(['/', '/resume', '/resume', '/resume', '/']);
	});

	it('emits events dispatched after activation', async () => {
		const fake = await activate({ token: 'tok-iso-events' });
		gateway.dispatch('MESSAGE_CREATE', { content: 'hi', author: { bot: false } });
		await settle(fake, () => fake.emitted.some((e) => e.event === 'MESSAGE_CREATE'));
		expect(fake.emitted.find((e) => e.event === 'MESSAGE_CREATE')).toEqual({
			event: 'MESSAGE_CREATE',
			data: { content: 'hi', author: { bot: false } },
		});
	});

	it('DMs the owner about a long outage and the recovery', async () => {
		const fake = await activate({
			token: 'tok-iso-outage',
			params: { alertUserId: '42', alertAfterMinutes: 1 },
		});
		const port = gateway.port;
		await gateway.stop();
		await settle(fake, () => fake.sentMessages.length >= 1);
		expect(fake.sentMessages).toEqual([alertText('down', { minutes: 1 })]);

		await gateway.start(port);
		await settle(fake, () => fake.sentMessages.length >= 2);
		expect(fake.sentMessages).toEqual([
			alertText('down', { minutes: 1 }),
			alertText('recovered', { minutes: 1 }),
		]);
		const posts = backgroundRest(fake).filter((r) => r.method === 'POST');
		expect(posts.map((r) => r.helper)).toEqual(['httpRequest', 'httpRequest', 'httpRequest']);
	});

	it('DMs the owner when a fatal close follows READY', async () => {
		const fake = await activate({ token: 'tok-iso-fatal', params: { alertUserId: '42' } });
		gateway.closeAll(4014);
		await settle(fake, () => fake.sentMessages.length >= 1);
		expect(fake.sentMessages).toEqual([fatal4014]);
		expect(fake.errors).toHaveLength(1);
		const [channel, message] = fake.requests.slice(1);
		expect(channel).toMatchObject({
			method: 'POST',
			url: 'https://discord.com/api/v10/users/@me/channels',
			headers: { Authorization: 'Bot tok-iso-fatal' },
			body: { recipient_id: '42' },
			timeout: 15000,
			helper: 'httpRequest',
		});
		expect(message).toMatchObject({
			method: 'POST',
			url: 'https://discord.com/api/v10/channels/dm-1/messages',
			headers: { Authorization: 'Bot tok-iso-fatal' },
			timeout: 15000,
			helper: 'httpRequest',
		});
	});

	it('stops for good on HTTP 401 from /gateway/bot during a reconnect, without leaking the token', async () => {
		const logged: unknown[][] = [];
		const record = (...a: unknown[]) => logged.push(a);
		LoggerProxy.init({ error: record, warn: record, info: record, debug: record } as never);
		const token = 'tok-iso-secret-401';
		const fake = await activate({ token, params: { alertUserId: '42' } });
		fake.gatewayBotHttpStatus = 401;
		gateway.sendToAll({ op: 9, d: false });
		await settle(fake, () => fake.errors.length >= 1 && fake.sentMessages.length >= 1);
		await sleep(150);
		expect(fake.errors).toHaveLength(1);
		expect(fake.errors[0].message).toContain('HTTP 401');
		expect(gateway.connections).toHaveLength(1);
		expect(JSON.stringify(logged)).not.toContain(token);
		expect(fake.errors.map((e) => e.message).join(' ')).not.toContain(token);
		expect(fake.sentMessages.join(' ')).not.toContain(token);
	});

	it('keeps retrying on HTTP 403 from /gateway/bot during a reconnect', async () => {
		const fake = await activate({ token: 'tok-iso-403' });
		fake.gatewayBotHttpStatus = 403;
		gateway.sendToAll({ op: 9, d: false });
		const gatewayBotCalls = () => fake.rest.filter((r) => r.url.endsWith('/gateway/bot')).length;
		await settle(fake, () => gatewayBotCalls() >= 4);
		expect(fake.errors).toHaveLength(0);
		fake.gatewayBotHttpStatus = undefined;
		await settle(fake, () => fake.staticData.sessionId === 'sess-2');
		expect(fake.errors).toHaveLength(0);
	});
});
