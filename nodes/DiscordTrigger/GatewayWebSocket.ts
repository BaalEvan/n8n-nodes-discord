import { ApplicationError, LoggerProxy, sleep, type IDataObject } from 'n8n-workflow';

import { getCloseCodeMeta } from './closeCodes';
import { FatalGatewayError } from './errors';

const OPCODE_DISPATCH = 0;
const OPCODE_HEARTBEAT = 1;
const OPCODE_IDENTIFY = 2;
const OPCODE_RESUME = 6;
const OPCODE_RECONNECT = 7;
const OPCODE_INVALID_SESSION = 9;
const OPCODE_HELLO = 10;
const OPCODE_HEARTBEAT_ACK = 11;

// Any close code other than 1000/1001 keeps the session resumable on Discord's side.
const RECONNECT_CLOSE_CODE = 4900;
const NEW_SESSION_CLOSE_CODES = [4007, 4009];

type EventHandler = (eventName: string, data: IDataObject, raw: IDataObject) => void;

export interface DisconnectInfo {
	canResume: boolean;
	fatal?: { code: number; name: string; description: string };
}

type DisconnectHandler = (info: DisconnectInfo) => void;

export interface GatewayResumeState {
	sessionId?: string;
	sequence?: number;
	resumeGatewayUrl?: string;
}

interface GatewayIdentifyOptions {
	token: string;
	intents: number;
	resumeState?: GatewayResumeState;
	onIdentify?: () => void;
}

export interface GatewayWebSocketOptions {
	random?: () => number;
}

export class GatewayWebSocket {
	private ws: WebSocket | null = null;
	private heartbeatEpoch = 0;
	private heartbeatAcked = true;
	private sequence: number | null = null;
	private sessionId: string | null = null;
	private resumeGatewayUrl: string | null = null;
	private closing = false;
	private ready = false;
	private pendingConnectReject: ((error: Error) => void) | null = null;
	private readonly random: () => number;

	constructor(
		private readonly gatewayUrl: string,
		private readonly workflowId: string,
		private readonly onEvent: EventHandler,
		private readonly onDisconnect: DisconnectHandler,
		options: GatewayWebSocketOptions = {},
	) {
		this.random = options.random ?? Math.random;
	}

	async connect(options: GatewayIdentifyOptions): Promise<void> {
		const resuming = this.adoptResumeState(options.resumeState);
		const baseUrl = resuming ? (this.resumeGatewayUrl ?? this.gatewayUrl) : this.gatewayUrl;
		const url = `${baseUrl}?v=10&encoding=json`;

		return new Promise((resolve, reject) => {
			let settled = false;
			this.pendingConnectReject = (error: Error) => {
				if (settled) return;
				settled = true;
				this.pendingConnectReject = null;
				reject(error);
			};

			const settleResolve = (): void => {
				if (settled) return;
				settled = true;
				this.pendingConnectReject = null;
				resolve();
			};
			const settleReject = (error: Error): void => {
				if (settled) return;
				settled = true;
				this.pendingConnectReject = null;
				reject(error);
			};

			try {
				this.ws = new WebSocket(url);

				this.ws.onmessage = (event: MessageEvent) => {
					try {
						const payload = JSON.parse(event.data as string) as IDataObject;
						this.handlePayload(payload, options, resuming, settleResolve);
					} catch (error) {
						LoggerProxy.error('Failed to handle Discord Gateway payload', {
							error: error instanceof Error ? error.message : String(error),
							workflowId: this.workflowId,
							nodeType: 'n8n-nodes-discord.discordTrigger',
						});
						settleReject(error instanceof Error ? error : new ApplicationError(String(error)));
					}
				};

				this.ws.onerror = () => {
					settleReject(new ApplicationError('Discord Gateway WebSocket error occurred'));
				};

				this.ws.onclose = (event: CloseEvent) => {
					this.stopHeartbeat();
					const code = event.code;
					const meta = getCloseCodeMeta(code);
					const fatal = meta !== undefined && !meta.reconnect;
					if (fatal || NEW_SESSION_CLOSE_CODES.includes(code)) {
						this.clearSession();
					}

					if (!this.ready) {
						// Connection closed before READY arrived — surface a clear error
						// instead of hanging the trigger awaiting a Promise that never resolves.
						if (fatal) {
							settleReject(new FatalGatewayError(code));
							return;
						}
						const reason = meta
							? `${meta.name}: ${meta.description}`
							: event.reason || 'connection closed before READY';
						settleReject(
							new ApplicationError(`Discord Gateway closed with code ${code} (${reason}).`),
						);
						return;
					}

					if (this.closing) return;
					this.closing = true;

					const info: DisconnectInfo = { canResume: this.sessionId !== null };
					if (fatal) {
						info.fatal = { code, name: meta.name, description: meta.description };
					}
					this.onDisconnect(info);
				};
			} catch (error) {
				settleReject(error instanceof Error ? error : new ApplicationError(String(error)));
			}
		});
	}

	async close(code = 1000): Promise<void> {
		this.closing = true;
		this.stopHeartbeat();

		if (this.pendingConnectReject) {
			this.pendingConnectReject(new ApplicationError('Discord Gateway connection aborted by close request'));
		}

		const ws = this.ws;
		this.ws = null;
		if (!ws) {
			return;
		}

		// Drop event/payload handling immediately so any frames in flight during
		// the closing handshake do not reach handlePayload / onEvent.
		ws.onmessage = null;
		ws.onerror = null;

		// Resolve only after the underlying WebSocket has actually transitioned
		// to CLOSED. n8n awaits closeFunction; this guarantees the runtime sees a
		// fully terminated connection before any subsequent re-activation.
		await new Promise<void>((resolve) => {
			let settled = false;
			const finish = () => {
				if (settled) return;
				settled = true;
				ws.onclose = null;
				resolve();
			};

			if (ws.readyState === WebSocket.CLOSED) {
				finish();
				return;
			}

			ws.onclose = finish;

			try {
				ws.close(code);
			} catch {
				finish();
				return;
			}

			// Safety: do not block n8n's closeFunction indefinitely if Discord
			// or the network never returns the close-frame ack.
			void sleep(5000).then(finish);
		});
	}

	getSessionState(): IDataObject {
		return {
			sessionId: this.sessionId,
			sequence: this.sequence,
			resumeGatewayUrl: this.resumeGatewayUrl,
		};
	}

	sendCommand(payload: { op: number; d: unknown }): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new ApplicationError(
				'Discord Gateway WebSocket is not open; cannot send command',
			);
		}
		this.ws.send(JSON.stringify(payload));
	}

	private adoptResumeState(resumeState: GatewayResumeState | undefined): boolean {
		if (!resumeState?.sessionId || typeof resumeState.sequence !== 'number') {
			return false;
		}
		this.sessionId = resumeState.sessionId;
		this.sequence = resumeState.sequence;
		this.resumeGatewayUrl = resumeState.resumeGatewayUrl ?? null;
		return true;
	}

	private clearSession(): void {
		this.sessionId = null;
		this.sequence = null;
		this.resumeGatewayUrl = null;
	}

	private handlePayload(
		payload: IDataObject,
		options: GatewayIdentifyOptions,
		resuming: boolean,
		resolve: () => void,
	): void {
		if (this.closing) {
			return;
		}

		const op = payload.op as number;

		if (typeof payload.s === 'number') {
			this.sequence = payload.s;
		}

		if (op === OPCODE_HELLO) {
			const data = payload.d as IDataObject;
			this.startHeartbeat(data.heartbeat_interval as number);
			this.identifyOrResume(options, resuming);
			return;
		}

		if (op === OPCODE_HEARTBEAT) {
			this.sendHeartbeat();
			return;
		}

		if (op === OPCODE_HEARTBEAT_ACK) {
			this.heartbeatAcked = true;
			return;
		}

		if (op === OPCODE_RECONNECT) {
			this.requestReconnect(
				{ canResume: this.sessionId !== null },
				'Discord Gateway requested a reconnect',
			);
			return;
		}

		if (op === OPCODE_INVALID_SESSION) {
			if (payload.d !== true) {
				this.clearSession();
			}
			this.requestReconnect(
				{ canResume: this.sessionId !== null },
				'Discord Gateway invalidated the session',
			);
			return;
		}

		if (op === OPCODE_DISPATCH) {
			const eventName = payload.t as string;
			const data = payload.d as IDataObject;

			if (eventName === 'READY') {
				this.sessionId = data.session_id as string;
				this.resumeGatewayUrl = data.resume_gateway_url as string;
				this.ready = true;
				resolve();
			} else if (eventName === 'RESUMED') {
				this.ready = true;
				resolve();
			}

			this.onEvent(eventName, data, payload);
		}
	}

	private identifyOrResume(options: GatewayIdentifyOptions, resuming: boolean): void {
		if (resuming) {
			this.send({
				op: OPCODE_RESUME,
				d: {
					token: options.token,
					session_id: this.sessionId,
					seq: this.sequence,
				},
			});
			return;
		}

		options.onIdentify?.();
		this.send({
			op: OPCODE_IDENTIFY,
			d: {
				token: options.token,
				intents: options.intents,
				properties: {
					os: 'linux',
					browser: 'n8n-nodes-discord',
					device: 'n8n-nodes-discord',
				},
			},
		});
	}

	private startHeartbeat(interval: number): void {
		this.stopHeartbeat();
		this.heartbeatAcked = true;
		const epoch = ++this.heartbeatEpoch;
		const runHeartbeatLoop = async (): Promise<void> => {
			let delay = interval * this.random();
			while (true) {
				await sleep(delay);
				if (this.closing || epoch !== this.heartbeatEpoch) {
					return;
				}
				if (!this.heartbeatAcked) {
					LoggerProxy.warn('Discord Gateway heartbeat ACK not received, reconnecting', {
						workflowId: this.workflowId,
						nodeType: 'n8n-nodes-discord.discordTrigger',
					});
					this.requestReconnect(
						{ canResume: this.sessionId !== null },
						'Discord Gateway heartbeat ACK not received',
					);
					return;
				}
				this.sendHeartbeat();
				delay = interval;
			}
		};
		runHeartbeatLoop().catch((error) => {
			LoggerProxy.error('Discord Gateway heartbeat failed', {
				error: error instanceof Error ? error.message : String(error),
				workflowId: this.workflowId,
				nodeType: 'n8n-nodes-discord.discordTrigger',
			});
		});
	}

	private stopHeartbeat(): void {
		this.heartbeatEpoch++;
	}

	private requestReconnect(info: DisconnectInfo, reason: string): void {
		const wasReady = this.ready;
		this.pendingConnectReject?.(new ApplicationError(reason));
		void this.close(RECONNECT_CLOSE_CODE);
		if (wasReady) {
			this.onDisconnect(info);
		}
	}

	private sendHeartbeat(): void {
		this.heartbeatAcked = false;
		this.send({
			op: OPCODE_HEARTBEAT,
			d: this.sequence,
		});
	}

	private send(payload: IDataObject): void {
		if (!this.ws) {
			return;
		}
		this.ws.send(JSON.stringify(payload));
	}
}
