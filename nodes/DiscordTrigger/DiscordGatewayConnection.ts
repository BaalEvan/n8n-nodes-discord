import {
	ApplicationError,
	LoggerProxy,
	NodeOperationError,
	sleep,
	type IDataObject,
	type ITriggerFunctions,
} from 'n8n-workflow';

import { DISCORD_API_BASE_URL } from '../Discord/shared/constants';
import { calculateIntents } from '../Discord/shared/intents';
import { alertText, claimFatalAlert, type AlertSink } from './alerts';
import { getCloseCodeMeta } from './closeCodes';
import { tokenFingerprint } from './connectionRegistry';
import { FatalGatewayError } from './errors';
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
const AUTH_FAILURE_STATUSES = [401, 403];
const DEFAULT_OUTAGE_CHECK_MS = 60_000;
const MS_PER_MINUTE = 60_000;

export interface DiscordGatewayConnectionOptions {
	backoff?: BackoffOptions;
	identifyBudget?: IdentifyBudget;
	alertSink?: AlertSink;
	alertAfterMs?: number;
	outageCheckMs?: number;
	now?: () => number;
	connectTimeoutMs?: number;
	token?: string;
}

export class DiscordGatewayConnection {
	private ws: GatewayWebSocket | null = null;
	private closing = false;
	private reconnectAttempts = 0;
	private readonly backoff: BackoffOptions;
	private readonly identifyBudget: IdentifyBudget;
	private readonly connectTimeoutMs?: number;
	private readonly fixedToken?: string;
	private readonly alertSink?: AlertSink;
	private readonly alertAfterMs: number;
	private readonly outageCheckMs: number;
	private readonly now: () => number;
	private fingerprint = 'unknown';
	private downSince: number | null = null;
	private downAlertSent = false;
	private outageLoopRunning = false;

	constructor(
		private readonly trigger: ITriggerFunctions,
		private readonly event: string,
		private readonly onEvent: (data: IDataObject) => void,
		options: DiscordGatewayConnectionOptions = {},
	) {
		this.backoff = options.backoff ?? DEFAULT_BACKOFF;
		this.identifyBudget = options.identifyBudget ?? new IdentifyBudget();
		this.connectTimeoutMs = options.connectTimeoutMs;
		this.fixedToken = options.token;
		this.alertSink = options.alertSink;
		this.alertAfterMs = options.alertAfterMs ?? 10 * MS_PER_MINUTE;
		this.outageCheckMs = options.outageCheckMs ?? DEFAULT_OUTAGE_CHECK_MS;
		this.now = options.now ?? Date.now;
	}

	async start(): Promise<void> {
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

		const token =
			this.fixedToken ??
			((await this.trigger.getCredentials('discordGatewayBotApi')).botToken as string);
		this.fingerprint = tokenFingerprint(token);
		const autoCalculateIntents = this.trigger.getNodeParameter('autoCalculateIntents') as boolean;
		const selectedIntents = autoCalculateIntents
			? []
			: (this.trigger.getNodeParameter('intents') as string[]);
		const intents = calculateIntents(this.event, selectedIntents);

		const resumeState = this.readResumeState();
		if (!resumeState) {
			const waitMs = this.identifyBudget.msUntilAvailable();
			if (waitMs > 0) {
				throw new ApplicationError(
					`Discord Gateway identify budget exhausted; next identify allowed in ${Math.ceil(waitMs / 1000)} s`,
				);
			}
		}

		if (this.closing) return;
		const gatewayUrl = resumeState?.resumeGatewayUrl ?? (await this.getGatewayUrl());

		if (this.closing) return;
		const ws = this.createWebSocket(gatewayUrl);
		this.ws = ws;
		await ws
			.connect({
				token,
				intents,
				resumeState,
				onIdentify: () => this.identifyBudget.record(),
			})
			.catch((error: unknown) => {
				void ws.close(RECONNECT_CLOSE_CODE);
				throw error;
			})
			.finally(() => this.persistSessionState());

		if (this.closing) {
			await ws.close();
			return;
		}

		this.reconnectAttempts = 0;
	}

	private handleConnectFailure(error: unknown): void {
		try {
			if (this.closing) return;

			if (error instanceof FatalGatewayError) {
				this.stopForGood(error.message, error.closeCode);
				return;
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

		if (info.fatal) {
			this.stopForGood(new FatalGatewayError(info.fatal.code).message, info.fatal.code);
			return;
		}

		if (info.canResume) {
			this.persistSessionState();
		} else {
			this.clearSessionState();
		}

		this.markDown();
		LoggerProxy.warn('Discord Gateway disconnected, reconnecting', {
			canResume: info.canResume,
			workflowId: this.trigger.getWorkflow().id,
			nodeType: NODE_TYPE,
		});
		this.scheduleReconnect();
	}

	private scheduleReconnect(): void {
		this.reconnectAttempts++;
		let delay = nextReconnectDelay(this.reconnectAttempts, this.backoff);
		if (!this.readResumeState()) {
			delay = Math.max(delay, this.identifyBudget.msUntilAvailable());
		}

		this.waitUnlessClosing(delay)
			.then(async (proceed) => {
				if (proceed) await this.connectOnce();
			})
			.catch((error) => this.handleConnectFailure(error));
	}

	private async waitUnlessClosing(ms: number): Promise<boolean> {
		let remaining = ms;
		while (remaining > 0 && !this.closing) {
			const step = Math.min(remaining, MAX_WAIT_STEP_MS);
			await sleep(step);
			remaining -= step;
		}
		return !this.closing;
	}

	private stopForGood(message: string, code: number): void {
		this.closing = true;
		this.clearSessionState();
		LoggerProxy.error('Discord Gateway closed with a non-recoverable code, not reconnecting', {
			error: message,
			workflowId: this.trigger.getWorkflow().id,
			nodeType: NODE_TYPE,
		});
		this.trigger.emitError(new NodeOperationError(this.trigger.getNode(), message));
		this.sendFatalAlert(code);
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
		const downSince = this.downSince;
		if (!sink || downSince === null || this.downAlertSent) return;
		const elapsed = this.now() - downSince;
		if (elapsed < this.alertAfterMs) return;
		const sent = await sink.send('down', alertText('down', { minutes: toMinutes(elapsed) }));
		if (sent && this.downSince !== null) {
			this.downAlertSent = true;
		}
	}

	private markUp(): void {
		const downSince = this.downSince;
		if (downSince === null) return;
		const alerted = this.downAlertSent;
		this.downSince = null;
		this.downAlertSent = false;
		if (alerted && this.alertSink) {
			const text = alertText('recovered', { minutes: toMinutes(this.now() - downSince) });
			void this.alertSink.send('recovered', text).catch(() => false);
		}
	}

	private async getGatewayUrl(): Promise<string> {
		const response = await this.trigger.helpers.httpRequestWithAuthentication
			.call(this.trigger, 'discordGatewayBotApi', {
				method: 'GET',
				url: `${DISCORD_API_BASE_URL}/gateway/bot`,
				json: true,
			})
			.catch((error: unknown) => {
				const status = httpStatusOf(error);
				if (status !== undefined && AUTH_FAILURE_STATUSES.includes(status)) {
					throw new FatalGatewayError(
						4004,
						`Discord rejected the bot token (HTTP ${status} from /gateway/bot). Check the Discord Gateway Bot API credential.`,
					);
				}
				throw error;
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
			this.markUp();
			LoggerProxy.info('Discord Gateway connected', {
				version: PACKAGE_VERSION,
				sessionId: this.trigger.getWorkflowStaticData('node').sessionId,
				resumed: eventName === 'RESUMED',
				workflowId: this.trigger.getWorkflow().id,
				nodeType: NODE_TYPE,
			});
		}

		if (this.event !== '*' && eventName !== this.event) {
			return;
		}

		const includeBotMessages = this.trigger.getNodeParameter(
			'includeBotMessages',
			false,
		) as boolean;
		if (!shouldEmitGatewayEvent(eventName, data, { includeBotMessages })) {
			return;
		}

		const emitRawPayload = this.trigger.getNodeParameter('emitRawPayload') as boolean;
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

function httpStatusOf(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const candidate = error as {
		httpCode?: unknown;
		statusCode?: unknown;
		status?: unknown;
		response?: { status?: unknown; statusCode?: unknown };
	};
	for (const value of [
		candidate.httpCode,
		candidate.statusCode,
		candidate.status,
		candidate.response?.status,
		candidate.response?.statusCode,
	]) {
		const status = Number(value);
		if (Number.isInteger(status) && status > 0) return status;
	}
	return undefined;
}
