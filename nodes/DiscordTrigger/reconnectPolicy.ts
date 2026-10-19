export interface BackoffOptions {
	baseDelayMs: number;
	maxDelayMs: number;
	random: () => number;
}

export const DEFAULT_BACKOFF: BackoffOptions = {
	baseDelayMs: 1000,
	maxDelayMs: 60000,
	random: Math.random,
};

export function nextReconnectDelay(attempt: number, opts: BackoffOptions = DEFAULT_BACKOFF): number {
	const capped = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** (attempt - 1));
	return Math.round(capped * (0.5 + opts.random() * 0.5));
}

export class IdentifyBudget {
	private readonly records: number[] = [];

	constructor(
		private readonly limit = 900,
		private readonly windowMs = 86_400_000,
		private readonly now: () => number = Date.now,
	) {}

	record(): void {
		this.prune();
		this.records.push(this.now());
	}

	count(): number {
		this.prune();
		return this.records.length;
	}

	msSinceLastRecord(): number {
		this.prune();
		if (this.records.length === 0) return Infinity;
		return this.now() - this.records[this.records.length - 1];
	}

	msUntilAvailable(): number {
		this.prune();
		if (this.records.length < this.limit) return 0;
		return this.records[0] + this.windowMs - this.now();
	}

	private prune(): void {
		const cutoff = this.now() - this.windowMs;
		while (this.records.length > 0 && this.records[0] <= cutoff) {
			this.records.shift();
		}
	}
}
