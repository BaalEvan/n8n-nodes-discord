import { afterEach, describe, expect, it } from 'vitest';

import { FakeGateway } from './support/fakeGateway';

describe('harness', () => {
	const gateway = new FakeGateway();

	afterEach(async () => {
		await gateway.stop();
	});

	it('fake gateway sends HELLO and READY after IDENTIFY', async () => {
		const url = await gateway.start();
		const ws = new WebSocket(url);
		const messages: Array<{ op: number; t?: string; d: Record<string, unknown> }> = [];
		ws.onmessage = (event) => messages.push(JSON.parse(event.data as string));

		await new Promise<void>((resolve) => (ws.onopen = () => resolve()));
		await expect.poll(() => messages.length).toBe(1);
		expect(messages[0].op).toBe(10);
		expect(messages[0].d.heartbeat_interval).toBe(100);

		ws.send(JSON.stringify({ op: 2, d: { token: 'x' } }));
		await expect.poll(() => messages.some((m) => m.t === 'READY')).toBe(true);
		const ready = messages.find((m) => m.t === 'READY')!;
		expect(ready.d.session_id).toBe('sess-1');
		ws.close();
	});
});
