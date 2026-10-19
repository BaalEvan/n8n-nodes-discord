import { LoggerProxy } from 'n8n-workflow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FatalGatewayError, httpStatusOf } from '../nodes/DiscordTrigger/errors';
import { DiscordGatewayConnection } from '../nodes/DiscordTrigger/DiscordGatewayConnection';
import { DiscordTrigger } from '../nodes/DiscordTrigger/DiscordTrigger.node';
import { FakeGateway } from './support/fakeGateway';
import { createFakeTrigger, gatewaySettings, runTrigger, type FakeTrigger } from './support/fakeTrigger';

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

const TOKEN = 'tok-secret-8c';

function dump(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (_key, v: unknown) => {
		if (v instanceof Error) {
			return { ...v, name: v.name, message: v.message, stack: v.stack, cause: v.cause };
		}
		if (typeof v === 'object' && v !== null) {
			if (seen.has(v)) return '[circular]';
			seen.add(v);
		}
		return v;
	});
}

describe('bot token never leaves the REST boundary', () => {
	let gateway: FakeGateway;
	let url: string;
	let logged: unknown[];
	let closers: Array<() => Promise<void>>;
	const node = new DiscordTrigger();

	beforeEach(async () => {
		logged = [];
		const sink = (...args: unknown[]) => void logged.push(args);
		LoggerProxy.init({ error: sink, warn: sink, info: sink, debug: sink } as never);
		gateway = new FakeGateway();
		url = await gateway.start();
		closers = [];
	});

	afterEach(async () => {
		for (const close of closers) await close();
		await gateway.stop();
	});

	async function activate() {
		const fake = createFakeTrigger({ gatewayUrl: url, token: TOKEN });
		const response = await runTrigger(node, fake);
		closers.push(response.closeFunction ?? (async () => {}));
		await expect.poll(() => fake.staticData.sessionId).toBe('sess-1');
		return fake;
	}

	const gatewayBotCalls = (fake: FakeTrigger) =>
		fake.rest.filter((r) => r.url.endsWith('/gateway/bot')).length;

	async function failReconnect(fake: FakeTrigger) {
		gateway.sendToAll({ op: 9, d: false });
		await expect.poll(() => gatewayBotCalls(fake), { timeout: 3000 }).toBeGreaterThanOrEqual(4);
		fake.gatewayBotHttpStatus = undefined;
		fake.gatewayBotErrorCode = undefined;
	}

	it('keeps the token out of logs and errors on a reconnect 403', async () => {
		const fake = await activate();
		fake.gatewayBotHttpStatus = 403;
		await failReconnect(fake);
		expect(dump(logged)).not.toContain(TOKEN);
		expect(dump(fake.errors)).not.toContain(TOKEN);
	});

	it('keeps the token out of logs and errors on a reconnect network failure', async () => {
		const fake = await activate();
		fake.gatewayBotErrorCode = 'EAI_AGAIN';
		await failReconnect(fake);
		expect(dump(logged)).not.toContain(TOKEN);
		expect(dump(fake.errors)).not.toContain(TOKEN);
	});

	it.each([
		['http 403', { gatewayBotHttpStatus: 403 }, 403, undefined],
		['EAI_AGAIN', { gatewayBotErrorCode: 'EAI_AGAIN' }, undefined, 'EAI_AGAIN'],
	])('rethrows a sanitized error from getGatewayUrl on %s', async (_n, failure, status, code) => {
		const fake = createFakeTrigger({ gatewayUrl: url, token: TOKEN });
		Object.assign(fake, failure);
		const connection = new DiscordGatewayConnection(fake, gatewaySettings(fake), () => {});
		const error = await (
			connection as unknown as { getGatewayUrl(): Promise<string> }
		)
			.getGatewayUrl()
			.then(
				() => undefined,
				(e: unknown) => e as Error,
			);
		expect(error).toBeInstanceOf(Error);
		expect(dump(error)).not.toContain(TOKEN);
		for (const key of ['config', 'request', 'response']) expect(error).not.toHaveProperty(key);
		expect(httpStatusOf(error)).toBe(status);
		expect((error as { extra?: { code?: string } }).extra?.code).toBe(code);
	});

	it('maps 401 from getGatewayUrl to a token-free FatalGatewayError', async () => {
		const fake = createFakeTrigger({ gatewayUrl: url, token: TOKEN, gatewayBotHttpStatus: 401 });
		const connection = new DiscordGatewayConnection(fake, gatewaySettings(fake), () => {});
		const error = await (connection as unknown as { getGatewayUrl(): Promise<string> })
			.getGatewayUrl()
			.then(
				() => undefined,
				(e: unknown) => e as Error,
			);
		expect(error).toBeInstanceOf(FatalGatewayError);
		expect((error as FatalGatewayError).closeCode).toBe(4004);
		expect(dump(error)).not.toContain(TOKEN);
	});
});
