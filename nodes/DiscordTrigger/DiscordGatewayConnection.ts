import {
	ApplicationError,
	LoggerProxy,
	NodeOperationError,
	sleep,
	type IDataObject,
	type ITriggerFunctions,
} from 'n8n-workflow';

import { DISCORD_API_BASE_URL } from '../Discord/shared/constants';
import {
	alertText,
	botAuthHeaders,
	claimFatalAlert,
	releaseFatalAlerts,
	REST_TIMEOUT_MS,
	type AlertSink,
} from './alerts';
import { getCloseCodeMeta } from './closeCodes';
import { tokenFingerprint } from './connectionRegistry';
import { FatalGatewayError, httpStatusOf, InvalidSessionError } from './errors';
import { shouldEmitGatewayEvent } from './events/policies';
import {
	GatewayWebSocket,
	RECONNECT_CLOSE_CODE,
	type DisconnectInfo,
	type GatewayResumeState,
} from './GatewayWebSocket';
import {
	DEFAULT_BACKOFF,
	IdentifyBudget,
	nextReconnectDelay,
	type BackoffOptions,
} from './reconnectPolicy';
import { PACKAGE_VERSION } from './version';

const NODE_TYPE = 'n8n-nodes-discord.discordTrigger';
const SESSION_KEYS = ['sessionId', 'sequence', 'resumeGatewayUrl'];
const MAX_WAIT_STEP_MS = 1000;
const AUTH_FAILURE_STATUS = 401;
const DEFAULT_OUTAGE_CHECK_MS = 60_000;
const DEFAULT_STABLE_PERIOD_MS = 60_000;
const DEFAULT_IDENTIFY_SPACING_MS = 5000;
const DEFAULT_INVALID_SESSION_WAIT = { minMs: 1000, maxMs: 5000 };
const MAX_FAILED_RESUMES = 3;
const MS_PER_MINUTE = 60_000;

export interface DiscordGatewayConnectionOptions {
	backoff?: BackoffOptions;
	identifyBudget?: IdentifyBudget;
	alertSink?: AlertSink;
	alertAfterMs?: number;
	outageCheckMs?: number;
	now?: () => number;
	connectTimeoutMs?: number;
	stablePeriodMs?: number;
	identifySpacingMs?: number;
	invalidSessionWait?: { minMs: number; maxMs: number };
}

export interface GatewayConnectionSettings {
	token: string;
	event: string;
	intents: number;
	includeBotMessages: boolean;
	emitRawPayload: boolean;
}

export class DiscordGatewayConnection {
	private ws: GatewayWebSocket | null = null;
	private closing = false;
	private reconnectAttempts = 0;
	private readonly backoff: BackoffOptions;
	private readonly identifyBudget: IdentifyBudget;
	private readonly connectTimeoutMs?: number;
	private readonly alertSink?: AlertSink;
	private readonly alertAfterMs: number;
	private readonly outageCheckMs: number;
	private readonly now: () => number;
	private readonly stablePeriodMs: number;
	private readonly identifySpacingMs: number;
	private readonly invalidSessionWait: { minMs: number; maxMs: number };
	private readonly fingerprint: string;
	private downSince: number | null = null;
	private downAlertSent = false;
	private outageLoopRunning = false;
	private lastUpAt = 0;
	private pendingRecovered: string | null = null;
	private connectedAt: number | null = null;
	private sessionEpoch = 0;
	private failedResumes = 0;
	private invalidSessionPending = false;
	private downAlertInFlight = false;

	constructor(
		private readonly trigger: ITriggerFunctions,
		private readonly settings: GatewayConnectionSettings,
		private readonly onEvent: (data: IDataObject) => void,
		options: DiscordGatewayConnectionOptions = {},
	) {
		this.backoff = options.backoff ?? DEFAULT_BACKOFF;
		this.identifyBudget = options.identifyBudget ?? new IdentifyBudget();
		this.connectTimeoutMs = options.connectTimeoutMs;
		this.fingerprint = tokenFingerprint(settings.token);
		this.alertSink = options.alertSink;
		this.alertAfterMs = options.alertAfterMs ?? 10 * MS_PER_MINUTE;
		this.outageCheckMs = options.outageCheckMs ?? DEFAULT_OUTAGE_CHECK_MS;
		this.now = options.now ?? Date.now;
		this.stablePeriodMs = options.stablePeriodMs ?? DEFAULT_STABLE_PERIOD_MS;
		this.identifySpacingMs = options.identifySpacingMs ?? DEFAULT_IDENTIFY_SPACING_MS;
		this.invalidSessionWait = options.invalidSessionWait ?? DEFAULT_INVALID_SESSION_WAIT;
	}

	async start(): Promise<void> {
		// A session saved by an earlier activation is never resumed.
		this.clearSessionState();
		await this.connectOnce().catch((error: unknown) => {
			if (error instanceof FatalGatewayError) {
				this.closing = true;
				this.clearSessionState();
				this.sendFatalAlert(error.closeCode);
				throw error;
			}
			this.handleConnectFailure(error);
		});
		this.startOutageLoop();
	}

	async close(): Promise<void> {
		this.closing = true;
		this.clearSessionState();
		const ws = this.ws;
		if (ws) {
			await ws.close(1000);
		}
	}

	sendCommand(payload: { op: number; d: unknown }): void {
		if (!this.ws) {
			throw new Error('Discord Gateway connection is not established');
		}
		this.ws.sendCommand(payload);
	}

	private async connectOnce(): Promise<void> {
		if (this.closing) return;

		const resumeState = this.readResumeState();
		if (!resumeState) {
			const waitMs = this.identifyBudget.msUntilAvailable();
			if (waitMs > 0) {
				throw new ApplicationError(
					`Discord Gateway identify budget exhausted; next identify allowed in ${Math.ceil(waitMs / 1000)} s`,
				);
			}
			const spacingMs = this.identifySpacingMs - this.identifyBudget.msSinceLastRecord();
			if (spacingMs > 0 && !(await this.waitUnlessClosing(spacingMs))) return;
		}

		if (this.closing) return;
		const gatewayUrl = resumeState?.resumeGatewayUrl ?? (await this.getGatewayUrl());

		if (this.closing) return;
		const ws = this.createWebSocket(gatewayUrl);
		this.ws = ws;
		await ws
			.connect({
				token: this.settings.token,
				intents: this.settings.intents,
				resumeState,
				onIdentify: () => this.identifyBudget.record(),
			})
			.catch((error: unknown) => {
				void ws.close(RECONNECT_CLOSE_CODE);
				this.persistSessionState();
				if (resumeState) this.recordFailedResume();
				throw error;
			});
		this.persistSessionState();

		if (this.closing) {
			await ws.close();
			return;
		}

		this.failedResumes = 0;
	}

	private recordFailedResume(): void {
		this.failedResumes++;
		if (this.failedResumes < MAX_FAILED_RESUMES) return;
		this.failedResumes = 0;
		this.clearSessionState();
		LoggerProxy.warn('Discord Gateway resume failed repeatedly, identifying a new session', {
			workflowId: this.trigger.getWorkflow().id,
			nodeType: NODE_TYPE,
		});
	}

	private handleConnectFailure(error: unknown): void {
		try {
			if (this.closing) return;

			if (error instanceof FatalGatewayError) {
				this.stopForGood(error.message, error.closeCode);
				return;
			}

			if (error instanceof InvalidSessionError) {
				this.invalidSessionPending = true;
			}
			this.markDown();
			LoggerProxy.warn('Discord Gateway connection attempt failed, retrying', {
				error: error instanceof Error ? error.message : String(error),
				attempt: this.reconnectAttempts + 1,
				workflowId: this.trigger.getWorkflow().id,
				nodeType: NODE_TYPE,
			});
			this.scheduleReconnect();
		} catch (handlerError) {
			LoggerProxy.error('Discord Gateway failed to handle a connection failure', {
				error: handlerError instanceof Error ? handlerError.message : String(handlerError),
				nodeType: NODE_TYPE,
			});
		}
	}

	private handleDisconnect(info: DisconnectInfo): void {
		if (this.closing) {
			return;
		}

		try {
			this.markDown();
			if (info.fatal) {
				this.stopForGood(new FatalGatewayError(info.fatal.code).message, info.fatal.code);
				return;
			}

			if (info.invalidSession) {
				this.invalidSessionPending = true;
			}
			if (info.canResume) {
				this.persistSessionState();
			} else {
				this.clearSessionState();
			}

			LoggerProxy.warn('Discord Gateway disconnected, reconnecting', {
				canResume: info.canResume,
				workflowId: this.trigger.getWorkflow().id,
				nodeType: NODE_TYPE,
			});
		} catch (error) {
			LoggerProxy.error('Discord Gateway failed to handle a disconnect', {
				error: error instanceof Error ? error.message : String(error),
				nodeType: NODE_TYPE,
			});
		}

		if (!this.closing) {
			this.scheduleReconnect();
		}
	}

	private scheduleReconnect(): void {
		this.reconnectAttempts++;
		let delay = nextReconnectDelay(this.reconnectAttempts, this.backoff);
		if (this.invalidSessionPending) {
			this.invalidSessionPending = false;
			const { minMs, maxMs } = this.invalidSessionWait;
			delay = Math.max(delay, Math.round(minMs + this.backoff.random() * (maxMs - minMs)));
		}
		if (!this.readResumeState()) {
			delay = Math.max(delay, this.identifyBudget.msUntilAvailable());
		}

		this.waitUnlessClosing(delay)
			.then(async (proceed) => {
				if (proceed) await this.connectOnce();
			})
			.catch((error) => this.handleConnectFailure(error));
	}

	private async waitUnlessClosing(ms: number, stillValid = () => true): Promise<boolean> {
		let remaining = ms;
		while (remaining > 0 && !this.closing && stillValid()) {
			const step = Math.min(remaining, MAX_WAIT_STEP_MS);
			await sleep(step);
			remaining -= step;
		}
		return !this.closing && stillValid();
	}

	private stopForGood(message: string, code: number): void {
		this.closing = true;
		this.clearSessionState();
		this.sendFatalAlert(code);
		LoggerProxy.error('Discord Gateway closed with a non-recoverable code, not reconnecting', {
			error: message,
			workflowId: this.trigger.getWorkflow().id,
			nodeType: NODE_TYPE,
		});
		this.trigger.emitError(new NodeOperationError(this.trigger.getNode(), message));
	}

	private sendFatalAlert(code: number): void {
		if (!this.alertSink) return;
		if (!claimFatalAlert(`${this.fingerprint}:${code}`)) return;
		const meta = getCloseCodeMeta(code);
		const text = alertText('fatal', {
			code,
			name: meta?.name ?? 'UNKNOWN',
			description: meta?.description ?? 'Non-recoverable close code.',
		});
		void this.alertSink.send('fatal', text).catch(() => false);
	}

	private markDown(): void {
		this.sessionEpoch++;
		this.connectedAt = null;
		if (this.downSince === null) {
			this.downSince = this.now();
		}
	}

	private startOutageLoop(): void {
		if (!this.alertSink || this.outageLoopRunning || this.closing) return;
		this.outageLoopRunning = true;
		void this.runOutageLoop().finally(() => {
			this.outageLoopRunning = false;
		});
	}

	private async runOutageLoop(): Promise<void> {
		while (await this.waitUnlessClosing(this.outageCheckMs)) {
			try {
				await this.checkOutage();
			} catch {
				continue;
			}
		}
	}

	private async checkOutage(): Promise<void> {
		const sink = this.alertSink;
		if (!sink) return;

		const pending = this.pendingRecovered;
		if (pending !== null) {
			this.pendingRecovered = null;
			await sink.send('recovered', pending);
		}

		const downSince = this.downSince;
		if (downSince === null || this.downAlertSent || this.connectedAt !== null) return;
		const elapsed = this.now() - downSince;
		if (elapsed < this.alertAfterMs) return;
		this.downAlertInFlight = true;
		let sent: boolean;
		try {
			sent = await sink.send('down', alertText('down', { minutes: toMinutes(elapsed) }));
		} finally {
			this.downAlertInFlight = false;
		}
		if (this.downSince === downSince) {
			if (sent) this.downAlertSent = true;
			return;
		}
		await this.sendRecovered(toMinutes(this.lastUpAt - downSince));
	}

	private async sendRecovered(minutes: number): Promise<void> {
		const sink = this.alertSink;
		if (!sink) return;
		const text = alertText('recovered', { minutes });
		const sent = await sink.send('recovered', text).catch(() => false);
		if (!sent) this.pendingRecovered = text;
	}

	private markSessionUp(): void {
		const epoch = ++this.sessionEpoch;
		this.connectedAt = this.now();
		void this.waitUnlessClosing(this.stablePeriodMs, () => epoch === this.sessionEpoch)
			.then((stable) => {
				if (!stable) return;
				this.reconnectAttempts = 0;
				this.markUp();
			})
			.catch(() => undefined);
	}

	private markUp(): void {
		const downSince = this.downSince;
		if (downSince === null) return;
		const alerted = this.downAlertSent;
		this.downSince = null;
		this.downAlertSent = false;
		this.lastUpAt = this.connectedAt ?? this.now();
		const outageMs = this.lastUpAt - downSince;
		// An unsent down alert (REST down too) is reported here with the outage length.
		if (alerted || (!this.downAlertInFlight && outageMs >= this.alertAfterMs)) {
			void this.sendRecovered(toMinutes(outageMs));
		}
	}

	private async getGatewayUrl(): Promise<string> {
		const response = await this.trigger.helpers
			.httpRequest({
				method: 'GET',
				url: `${DISCORD_API_BASE_URL}/gateway/bot`,
				headers: botAuthHeaders(this.settings.token),
				json: true,
				timeout: REST_TIMEOUT_MS,
			})
			.catch((error: unknown) => {
				const status = httpStatusOf(error);
				if (status === AUTH_FAILURE_STATUS) {
					throw new FatalGatewayError(
						4004,
						`Discord rejected the bot token (HTTP ${status} from /gateway/bot). Check the Discord Gateway Bot API credential.`,
					);
				}
				const code = (error as { code?: unknown } | null)?.code;
				const reason = error instanceof Error ? error.message : String(error);
				throw new ApplicationError(`Discord REST request failed: ${reason}`, {
					extra: { status, code: typeof code === 'string' ? code : undefined },
				});
			});

		const data = response as IDataObject;
		return data.url as string;
	}

	private createWebSocket(gatewayUrl: string): GatewayWebSocket {
		return new GatewayWebSocket(
			gatewayUrl,
			this.trigger.getWorkflow().id || '',
			(eventName, data, raw) => this.handleEvent(eventName, data, raw),
			(info) => this.handleDisconnect(info),
			{ random: this.backoff.random, connectTimeoutMs: this.connectTimeoutMs },
		);
	}

	private handleEvent(eventName: string, data: IDataObject, raw: IDataObject): void {
		this.persistSessionState();
		if (eventName === 'READY' || eventName === 'RESUMED') {
			releaseFatalAlerts(this.fingerprint);
			this.markSessionUp();
			LoggerProxy.info('Discord Gateway connected', {
				version: PACKAGE_VERSION,
				sessionId: this.trigger.getWorkflowStaticData('node').sessionId,
				resumed: eventName === 'RESUMED',
				workflowId: this.trigger.getWorkflow().id,
				nodeType: NODE_TYPE,
			});
		}

		const { event, includeBotMessages, emitRawPayload } = this.settings;
		if (event !== '*' && eventName !== event) {
			return;
		}

		if (!shouldEmitGatewayEvent(eventName, data, { includeBotMessages })) {
			return;
		}

		this.onEvent(
			emitRawPayload
				? raw
				: {
						event: eventName,
						data,
					},
		);
	}

	private readResumeState(): GatewayResumeState | undefined {
		const { sessionId, sequence, resumeGatewayUrl } = this.trigger.getWorkflowStaticData('node');
		if (typeof sessionId !== 'string' || typeof sequence !== 'number') {
			return undefined;
		}
		return {
			sessionId,
			sequence,
			resumeGatewayUrl: typeof resumeGatewayUrl === 'string' ? resumeGatewayUrl : undefined,
		};
	}

	private clearSessionState(): void {
		const staticData = this.trigger.getWorkflowStaticData('node');
		for (const key of SESSION_KEYS) {
			delete staticData[key];
		}
	}

	private persistSessionState(): void {
		if (!this.ws || this.closing) {
			return;
		}
		const staticData = this.trigger.getWorkflowStaticData('node');
		const sessionState = this.ws.getSessionState();
		for (const [key, value] of Object.entries(sessionState)) {
			if (value === null || value === undefined) {
				delete staticData[key];
			} else {
				staticData[key] = value;
			}
		}
	}
}

function toMinutes(ms: number): number {
	return Math.max(1, Math.round(ms / MS_PER_MINUTE));
}
