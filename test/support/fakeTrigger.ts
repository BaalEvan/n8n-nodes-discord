import type { IDataObject, ITriggerFunctions, ITriggerResponse } from 'n8n-workflow';

import type { GatewayConnectionSettings } from '../../nodes/DiscordTrigger/DiscordGatewayConnection';

export const NO_BRIDGE_MESSAGE = 'No bridge acquired for this context. Call acquire() first.';

export interface FakeTriggerOptions {
	gatewayUrl: string;
	params?: Record<string, unknown>;
	mode?: 'trigger' | 'manual';
	workflowId?: string;
	nodeId?: string;
	token?: string;
	failGatewayBotTimes?: number;
	gatewayBotHttpStatus?: number;
	staticData?: IDataObject;
	isolate?: boolean;
}

export type RestHelper = 'httpRequest' | 'httpRequestWithAuthentication';

export interface FakeTrigger extends ITriggerFunctions {
	token: string;
	emitted: IDataObject[];
	errors: Error[];
	rest: Array<{ method: string; url: string; body?: unknown; helper: RestHelper }>;
	requests: IDataObject[];
	sentMessages: string[];
	staticData: IDataObject;
	gatewayBotHttpStatus?: number;
	gatewayBotErrorCode?: string;
	failMessagePosts: number;
	failChannelPosts: number;
	messagePostGate: Promise<void> | null;
	bridgeErrors: Error[];
	withIsolate<T>(fn: () => Promise<T>): Promise<T>;
}

interface FakeRequest {
	method: string;
	url: string;
	body?: unknown;
	headers?: Record<string, unknown>;
}

const DEFAULT_PARAMS: Record<string, unknown> = {
	event: '*',
	autoCalculateIntents: true,
	intents: [],
	includeBotMessages: false,
	emitRawPayload: false,
	connectionName: 'default',
};

function networkError(code: string, request: FakeRequest): Error {
	return Object.assign(new Error(`getaddrinfo ${code} discord.com`), {
		isAxiosError: true,
		code,
		config: { method: request.method, url: request.url, headers: { ...request.headers } },
		request: { _header: `GET /api/v10/gateway/bot
Authorization: ${request.headers?.Authorization}` },
	});
}

function httpError(status: number, request: FakeRequest): Error {
	return Object.assign(new Error(`Request failed with status code ${status}`), {
		isAxiosError: true,
		status,
		config: { method: request.method, url: request.url, headers: { ...request.headers } },
		response: { status, data: { message: status === 401 ? '401: Unauthorized' : 'Forbidden' } },
	});
}

export function createFakeTrigger(opts: FakeTriggerOptions): FakeTrigger {
	const params = { ...DEFAULT_PARAMS, ...opts.params };
	const staticData: IDataObject = opts.staticData ?? {};
	const token = opts.token ?? 'test-token';
	const isolate = opts.isolate ?? true;
	let gatewayFailures = opts.failGatewayBotTimes ?? 0;
	let isolateDepth = 0;

	const requireBridge = () => {
		if (!isolate || isolateDepth > 0) return;
		const error = new Error(NO_BRIDGE_MESSAGE);
		trigger.bridgeErrors.push(error);
		throw error;
	};

	async function respond(helper: RestHelper, request: FakeRequest) {
		const { method, url, body } = request;
		trigger.rest.push({ method, url, body, helper });
		trigger.requests.push({ ...request, helper } as IDataObject);
		if (helper === 'httpRequest' && request.headers?.Authorization !== `Bot ${token}`) {
			throw httpError(401, request);
		}
		if (method === 'GET' && url.endsWith('/gateway/bot')) {
			if (trigger.gatewayBotErrorCode !== undefined) {
				throw networkError(trigger.gatewayBotErrorCode, request);
			}
			if (trigger.gatewayBotHttpStatus !== undefined) {
				if (helper === 'httpRequest') throw httpError(trigger.gatewayBotHttpStatus, request);
				throw Object.assign(new Error('Authorization failed - please check your credentials'), {
					httpCode: String(trigger.gatewayBotHttpStatus),
				});
			}
			if (gatewayFailures > 0) {
				gatewayFailures--;
				throw new Error('fake gateway/bot failure');
			}
			return { url: opts.gatewayUrl };
		}
		if (method === 'POST' && url.endsWith('/users/@me/channels')) {
			if (trigger.failChannelPosts > 0) {
				trigger.failChannelPosts--;
				throw new Error('fake channel POST failure');
			}
			return { id: 'dm-1' };
		}
		if (method === 'POST' && url.endsWith('/channels/dm-1/messages')) {
			if (trigger.messagePostGate) await trigger.messagePostGate;
			if (trigger.failMessagePosts > 0) {
				trigger.failMessagePosts--;
				throw new Error('fake message POST failure');
			}
			trigger.sentMessages.push((body as { content: string }).content);
			return { id: 'm-1' };
		}
		throw new Error(`fake trigger: unexpected request ${method} ${url}`);
	}

	const trigger = {
		token,
		emitted: [] as IDataObject[],
		errors: [] as Error[],
		rest: [] as FakeTrigger['rest'],
		requests: [] as IDataObject[],
		sentMessages: [] as string[],
		staticData,
		gatewayBotHttpStatus: opts.gatewayBotHttpStatus,
		failMessagePosts: 0,
		failChannelPosts: 0,
		messagePostGate: null as Promise<void> | null,
		bridgeErrors: [] as Error[],
		async withIsolate<T>(fn: () => Promise<T>): Promise<T> {
			isolateDepth++;
			try {
				return await fn();
			} finally {
				isolateDepth--;
			}
		},
		getCredentials: async () => {
			requireBridge();
			return { botToken: token };
		},
		getNodeParameter: (name: string, fallback?: unknown) => {
			requireBridge();
			return name in params ? params[name] : fallback;
		},
		getWorkflowStaticData: () => staticData,
		getWorkflow: () => ({ id: opts.workflowId ?? 'wf-1' }),
		getNode: () => ({ id: opts.nodeId ?? 'node-1', name: 'Discord Trigger' }),
		getMode: () => opts.mode ?? 'trigger',
		emit(data: Array<Array<{ json: IDataObject }>>) {
			for (const item of data[0] ?? []) trigger.emitted.push(item.json);
		},
		emitError(error: Error) {
			trigger.errors.push(error);
		},
		helpers: {
			returnJsonArray: (data: IDataObject | IDataObject[]) =>
				(Array.isArray(data) ? data : [data]).map((json) => ({ json })),
			httpRequest: async (request: FakeRequest) => respond('httpRequest', request),
			async httpRequestWithAuthentication(_credentialName: string, request: FakeRequest) {
				requireBridge();
				return await respond('httpRequestWithAuthentication', request);
			},
		},
	};

	return trigger as unknown as FakeTrigger;
}

// n8n runs trigger() and the returned closeFunction inside workflow.expression.withIsolate().
export async function runTrigger(
	node: { trigger(this: ITriggerFunctions): Promise<ITriggerResponse> },
	fake: FakeTrigger,
): Promise<ITriggerResponse> {
	const response = await fake.withIsolate(async () => await node.trigger.call(fake));
	const closeFunction = response.closeFunction;
	if (closeFunction) {
		response.closeFunction = async () =>
			await fake.withIsolate(async () => await closeFunction.call(response));
	}
	return response;
}

export function gatewaySettings(
	fake: FakeTrigger,
	overrides: Partial<GatewayConnectionSettings> = {},
): GatewayConnectionSettings {
	return {
		token: fake.token,
		event: '*',
		intents: 1,
		includeBotMessages: false,
		emitRawPayload: false,
		...overrides,
	};
}
