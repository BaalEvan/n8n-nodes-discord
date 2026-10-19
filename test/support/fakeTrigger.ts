import type { IDataObject, ITriggerFunctions } from 'n8n-workflow';

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
}

export interface FakeTrigger extends ITriggerFunctions {
	emitted: IDataObject[];
	errors: Error[];
	rest: Array<{ method: string; url: string; body?: unknown }>;
	requests: IDataObject[];
	sentMessages: string[];
	staticData: IDataObject;
	gatewayBotHttpStatus?: number;
	failMessagePosts: number;
	failChannelPosts: number;
	messagePostGate: Promise<void> | null;
}

const DEFAULT_PARAMS: Record<string, unknown> = {
	event: '*',
	autoCalculateIntents: true,
	intents: [],
	includeBotMessages: false,
	emitRawPayload: false,
	connectionName: 'default',
};

export function createFakeTrigger(opts: FakeTriggerOptions): FakeTrigger {
	const params = { ...DEFAULT_PARAMS, ...opts.params };
	const staticData: IDataObject = opts.staticData ?? {};
	let gatewayFailures = opts.failGatewayBotTimes ?? 0;

	const trigger = {
		emitted: [] as IDataObject[],
		errors: [] as Error[],
		rest: [] as Array<{ method: string; url: string; body?: unknown }>,
		requests: [] as IDataObject[],
		sentMessages: [] as string[],
		staticData,
		gatewayBotHttpStatus: opts.gatewayBotHttpStatus,
		failMessagePosts: 0,
		failChannelPosts: 0,
		messagePostGate: null as Promise<void> | null,
		getCredentials: async () => ({ botToken: opts.token ?? 'test-token' }),
		getNodeParameter: (name: string, fallback?: unknown) =>
			name in params ? params[name] : fallback,
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
			async httpRequestWithAuthentication(
				_credentialName: string,
				request: { method: string; url: string; body?: unknown },
			) {
				const { method, url, body } = request;
				trigger.rest.push({ method, url, body });
				trigger.requests.push({ ...request } as IDataObject);
				if (method === 'GET' && url.endsWith('/gateway/bot')) {
					if (trigger.gatewayBotHttpStatus !== undefined) {
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
			},
		},
	};

	return trigger as unknown as FakeTrigger;
}
