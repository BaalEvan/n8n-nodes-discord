import { createPublicKey, verify } from 'node:crypto';

import {
	ApplicationError,
	NodeConnectionTypes,
	type IDataObject,
	type IHookFunctions,
	type INodeType,
	type INodeTypeDescription,
	type IWebhookFunctions,
	type IWebhookResponseData,
} from 'n8n-workflow';

const DISCORD_WEBHOOK_TYPE_PING = 0;
const DISCORD_WEBHOOK_TYPE_EVENT = 1;

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

const HEX_REGEX = /^[0-9a-f]+$/i;

function isHex(value: string): boolean {
	return HEX_REGEX.test(value) && value.length % 2 === 0;
}

function buildEd25519PublicKey(publicKeyHex: string): ReturnType<typeof createPublicKey> {
	const trimmed = publicKeyHex.trim();
	if (!isHex(trimmed) || trimmed.length !== 64) {
		throw new ApplicationError(
			'Discord public key must be a 64-character hexadecimal string (32 bytes).',
		);
	}
	const rawKey = Buffer.from(trimmed, 'hex');
	const der = Buffer.concat([ED25519_SPKI_PREFIX, rawKey]);
	return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function verifyDiscordSignature(
	rawBody: string,
	signatureHex: string,
	timestamp: string,
	publicKeyHex: string,
): boolean {
	if (!signatureHex || !timestamp || !isHex(signatureHex)) {
		return false;
	}
	try {
		const key = buildEd25519PublicKey(publicKeyHex);
		const signature = Buffer.from(signatureHex, 'hex');
		const message = Buffer.from(timestamp + rawBody);
		return verify(null, message, key, signature);
	} catch {
		return false;
	}
}

function readRawBody(request: { rawBody?: unknown; body?: unknown }): string {
	const raw = request.rawBody;
	if (Buffer.isBuffer(raw)) {
		return raw.toString('utf8');
	}
	if (typeof raw === 'string') {
		return raw;
	}
	const body = request.body;
	if (Buffer.isBuffer(body)) {
		return body.toString('utf8');
	}
	if (typeof body === 'string') {
		return body;
	}
	if (body && typeof body === 'object') {
		return JSON.stringify(body);
	}
	return '';
}

function getHeaderValue(headers: Record<string, unknown>, name: string): string {
	const value = headers[name.toLowerCase()];
	if (Array.isArray(value)) {
		return typeof value[0] === 'string' ? value[0] : '';
	}
	return typeof value === 'string' ? value : '';
}

function parseAdditionalEventTypes(value: string): string[] {
	if (!value) {
		return [];
	}
	return value
		.split(/[\s,]+/)
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function extractEventType(payload: IDataObject): string {
	const event = payload.event;
	if (event && typeof event === 'object') {
		const type = (event as IDataObject).type;
		if (typeof type === 'string') {
			return type;
		}
	}
	return '';
}

export class DiscordWebhookEventTrigger implements INodeType {
	// Discord's Webhook Event URL is configured manually in the Discord
	// Developer Portal — there is no API to register/check/delete it. These
	// no-op methods exist only to satisfy the webhook-lifecycle-complete lint
	// rule; n8n still serves the webhook regardless of what they return.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return true;
			},
		},
	};

	description: INodeTypeDescription = {
		displayName: 'Discord Webhook Event Trigger',
		name: 'discordWebhookEventTrigger',
		icon: { light: 'file:discord.svg', dark: 'file:discord.dark.svg' },
		group: ['trigger'],
		codex: {
			categories: ['Communication'],
			subcategories: {
				Communication: ['Messaging'],
			},
			alias: [
				'application webhook',
				'entitlement',
				'authorization',
				'quest',
				'lobby',
				'monetization',
				'purchase',
				'subscription',
				'webhook event',
			],
		},
		version: 1,
		subtitle: '={{$parameter["path"]}}',
		description:
			'Receive Discord Application Webhook Events (e.g. APPLICATION_AUTHORIZED, ENTITLEMENT_CREATE) via HTTPS webhook with Ed25519 signature verification',
		defaults: {
			name: 'Discord Webhook Event Trigger',
		},
		usableAsTool: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'discordGatewayInteractionApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: '={{$parameter["path"]}}',
				isFullPath: false,
			},
		],
		properties: [
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				default: 'discord-webhook-events',
				required: true,
				placeholder: 'discord-webhook-events',
				description:
					'URL slug appended to the n8n webhook base URL. Configure this full URL as the "Webhook Events Endpoint URL" in the Discord application portal.',
			},
			{
				displayName: 'Event Types',
				name: 'eventTypes',
				type: 'multiOptions',
				default: [],
				description:
					'Only forward events whose type appears in this list. Leave empty to forward every event type.',
				options: [
					{
						name: 'APPLICATION_AUTHORIZED',
						value: 'APPLICATION_AUTHORIZED',
						description: 'User authorized your application or added it to a server',
					},
					{
						name: 'APPLICATION_DEAUTHORIZED',
						value: 'APPLICATION_DEAUTHORIZED',
						description: 'User deauthorized your application',
					},
					{
						name: 'ENTITLEMENT_CREATE',
						value: 'ENTITLEMENT_CREATE',
						description: 'User was granted an entitlement (purchase, subscription, etc.)',
					},
					{
						name: 'LOBBY_MESSAGE_CREATE',
						value: 'LOBBY_MESSAGE_CREATE',
						description: 'A message was sent in a lobby your application is a member of',
					},
					{
						name: 'QUEST_USER_ENROLLMENT',
						value: 'QUEST_USER_ENROLLMENT',
						description: 'User enrolled in a Discord Quest associated with your application',
					},
				],
			},
			{
				displayName: 'Additional Event Types',
				name: 'additionalEventTypes',
				type: 'string',
				default: '',
				placeholder: 'CUSTOM_EVENT_TYPE, ANOTHER_EVENT',
				description:
					'Comma or whitespace separated event type names to forward in addition to those selected above. Use this to allow event types Discord adds after this node was published.',
			},
			{
				displayName:
					'Discord verifies this endpoint by sending a PING (type 0) which is answered automatically with 204. Actual events (type 1) are acknowledged with 204 and emitted on the output. If the Event Types filter is empty, every event is forwarded.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		],
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const credentials = await this.getCredentials<{ applicationId: string; publicKey: string }>(
			'discordGatewayInteractionApi',
		);
		const publicKey = (credentials.publicKey ?? '').toString();

		const headers = this.getHeaderData() as Record<string, unknown>;
		const signature = getHeaderValue(headers, 'x-signature-ed25519');
		const timestamp = getHeaderValue(headers, 'x-signature-timestamp');

		const request = this.getRequestObject() as unknown as {
			rawBody?: unknown;
			body?: unknown;
		};
		const rawBody = readRawBody(request);

		const response = this.getResponseObject();

		if (!verifyDiscordSignature(rawBody, signature, timestamp, publicKey)) {
			response.status(401).send('invalid request signature');
			return { noWebhookResponse: true };
		}

		let payload: IDataObject;
		try {
			payload = (rawBody.length > 0 ? JSON.parse(rawBody) : {}) as IDataObject;
		} catch {
			response.status(400).send('invalid request body');
			return { noWebhookResponse: true };
		}

		if (payload.type === DISCORD_WEBHOOK_TYPE_PING) {
			response.status(204).send('');
			return { noWebhookResponse: true };
		}

		response.status(204).send('');

		if (payload.type === DISCORD_WEBHOOK_TYPE_EVENT) {
			const selected = this.getNodeParameter('eventTypes', []) as string[];
			const additionalRaw = this.getNodeParameter('additionalEventTypes', '') as string;
			const additional = parseAdditionalEventTypes(additionalRaw);
			const allowed = [...selected, ...additional];

			if (allowed.length > 0) {
				const eventType = extractEventType(payload);
				if (!allowed.includes(eventType)) {
					return { noWebhookResponse: true };
				}
			}
		}

		return {
			noWebhookResponse: true,
			workflowData: [this.helpers.returnJsonArray([payload])],
		};
	}
}
