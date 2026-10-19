import { describe, expect, it } from 'vitest';

import { IdentifyBudget, nextReconnectDelay } from '../nodes/DiscordTrigger/reconnectPolicy';

const almostOne = () => 1 - Number.EPSILON;

describe('nextReconnectDelay', () => {
	it('delay doubles from base', () => {
		const opts = { baseDelayMs: 1000, maxDelayMs: 60000, random: almostOne };
		expect(Math.abs(nextReconnectDelay(1, opts) - 1000)).toBeLessThanOrEqual(1);
		expect(Math.abs(nextReconnectDelay(2, opts) - 2000)).toBeLessThanOrEqual(1);
		expect(Math.abs(nextReconnectDelay(3, opts) - 4000)).toBeLessThanOrEqual(1);
	});

	it('delay is capped at 60 s', () => {
		const opts = { baseDelayMs: 1000, maxDelayMs: 60000, random: almostOne };
		expect(nextReconnectDelay(20, opts)).toBeLessThanOrEqual(60000);
		expect(nextReconnectDelay(20, opts)).toBeGreaterThan(59000);
	});

	it('jitter keeps at least half', () => {
		const opts = { baseDelayMs: 1000, maxDelayMs: 60000, random: () => 0 };
		expect(nextReconnectDelay(20, opts)).toBe(30000);
		expect(nextReconnectDelay(1, opts)).toBe(500);
	});

	it('uses defaults when no options are given', () => {
		const delay = nextReconnectDelay(1);
		expect(delay).toBeGreaterThanOrEqual(500);
		expect(delay).toBeLessThanOrEqual(1000);
	});
});

describe('IdentifyBudget', () => {
	it('budget allows 900 then blocks', () => {
		let now = 1_000_000;
		const windowMs = 86_400_000;
		const budget = new IdentifyBudget(900, windowMs, () => now);
		const first = now;
		for (let i = 0; i < 899; i++) {
			budget.record();
			now += 10;
		}
		expect(budget.msUntilAvailable()).toBe(0);
		budget.record();
		now += 10;
		expect(budget.msUntilAvailable()).toBeGreaterThan(0);
		expect(budget.msUntilAvailable()).toBe(windowMs - (now - first));
	});

	it('budget frees after window', () => {
		let now = 0;
		const budget = new IdentifyBudget(900, 86_400_000, () => now);
		for (let i = 0; i < 900; i++) budget.record();
		expect(budget.msUntilAvailable()).toBeGreaterThan(0);
		now = 86_400_000 + 1;
		expect(budget.msUntilAvailable()).toBe(0);
	});
});
