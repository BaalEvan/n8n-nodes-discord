import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type ITriggerFunctions,
	type ITriggerResponse,
} from 'n8n-workflow';

import { calculateIntents } from '../Discord/shared/intents';
import {
	closeStaleConnection,
	identifyBudgetFor,
	productionHolder,
	registerConnection,
	registryKey,
	takeOverManualConnections,
	tokenFingerprint,
	unregisterConnection,
} from './connectionRegistry';
import { createDmAlertSink } from './alerts';
import { DiscordGatewayConnection } from './DiscordGatewayConnection';
import { triggerProperties } from './events';
import { getGatewaySender, registerGatewaySender, unregisterGatewaySender } from './gatewaySendBus';

export class DiscordTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Discord Trigger',
		name: 'discordTrigger',
		icon: { light: 'file:discord.svg', dark: 'file:discord.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Listen to Discord Gateway events over a persistent WebSocket connection. Set "Connection Name" to allow the Discord Gateway Send node to push commands through this connection.',
		defaults: {
			name: 'Discord Trigger',
		},
		usableAsTool: true,
		codex: {
			categories: ['Communication'],
			subcategories: {
				Communication: ['Messaging'],
			},
			alias: [
				'bot',
				'gateway',
				'websocket',
				'event',
				'message create',
				'interaction',
				'guild member add',
				'voice state',
				'listen',
				'webhook',
			],
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'discordGatewayBotApi',
				required: true,
			},
		],
		properties: triggerProperties,
	};

	// Credentials and parameters resolve only while n8n holds the expression
	// isolate (trigger() and closeFunction), so everything the background
	// connection needs is read here once.
	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const event = this.getNodeParameter('event') as string;
		const connectionName = (this.getNodeParameter('connectionName', 'default') as string) || 'default';

		const credentials = await this.getCredentials('discordGatewayBotApi');
		const botToken = credentials.botToken;
		if (typeof botToken !== 'string' || botToken === '') {
			throw new NodeOperationError(this.getNode(), 'The Discord credential has no bot token.');
		}

		const autoCalculateIntents = this.getNodeParameter('autoCalculateIntents') as boolean;
		const selectedIntents = autoCalculateIntents
			? []
			: (this.getNodeParameter('intents') as string[]);
		const includeBotMessages = this.getNodeParameter('includeBotMessages', false) as boolean;
		const emitRawPayload = this.getNodeParameter('emitRawPayload') as boolean;
		const alertUserId = ((this.getNodeParameter('alertUserId', '') as string) || '').trim();
		const alertAfterMinutes = Math.max(
			1,
			Number(this.getNodeParameter('alertAfterMinutes', 10)) || 10,
		);

		const fingerprint = tokenFingerprint(botToken);
		const mode = this.getMode() === 'manual' ? 'manual' : 'trigger';

		const workflowId = this.getWorkflow().id ?? '';
		const nodeId = this.getNode().id;
		const key = registryKey(workflowId, nodeId, mode);

		const refuseManualOnProductionToken = () => {
			if (mode === 'manual' && productionHolder(fingerprint)) {
				throw new NodeOperationError(
					this.getNode(),
					'This bot token is in use by an active Discord Trigger. Use the test bot token for manual runs.',
				);
			}
		};

		refuseManualOnProductionToken();
		await closeStaleConnection(key);
		refuseManualOnProductionToken();

		if (mode === 'trigger') {
			const holder = productionHolder(fingerprint);
			if (holder) {
				throw new NodeOperationError(
					this.getNode(),
					`This bot token is already used by another active Discord Trigger (${holder}). Only one active trigger per bot token is allowed.`,
				);
			}
		}

		const onEvent = (eventData: IDataObject) => {
			this.emit([this.helpers.returnJsonArray([eventData])]);
		};

		const connection = new DiscordGatewayConnection(
			this,
			{
				token: botToken,
				event,
				intents: calculateIntents(event, selectedIntents),
				includeBotMessages,
				emitRawPayload,
			},
			onEvent,
			{
				identifyBudget: identifyBudgetFor(fingerprint),
				alertSink: alertUserId ? createDmAlertSink(this, botToken, alertUserId) : undefined,
				alertAfterMs: alertAfterMinutes * 60_000,
			},
		);

		const sender = (payload: { op: number; d: unknown }) => connection.sendCommand(payload);
		let senderRegistered = false;
		const releaseSender = () => {
			if (senderRegistered) {
				unregisterGatewaySender(connectionName, sender);
				senderRegistered = false;
			}
		};

		// Production wins: a manual run on the same token is closed and told why.
		const takeover =
			mode === 'trigger' ? takeOverManualConnections(fingerprint) : Promise.resolve();

		// Register the connection BEFORE connecting to ensure that if trigger()
		// is called again while connect() is in progress, the next call can
		// find and close this connection.
		registerConnection(
			key,
			fingerprint,
			mode,
			connection,
			mode === 'manual'
				? () => {
						releaseSender();
						this.emitError(
							new NodeOperationError(
								this.getNode(),
								'A production Discord Trigger took over this bot token.',
							),
						);
					}
				: undefined,
		);

		// Manual runs only take a connection name nobody holds, so they never
		// displace a production sender.
		if (mode === 'trigger' || getGatewaySender(connectionName) === undefined) {
			registerGatewaySender(connectionName, sender);
			senderRegistered = true;
		}

		await takeover;

		try {
			await connection.start();
		} catch (error) {
			// If connection fails, make sure we don't leave a dead reference in the map
			unregisterConnection(key, connection);
			releaseSender();
			throw new NodeOperationError(this.getNode(), error as Error);
		}

		return {
			closeFunction: async () => {
				releaseSender();
				unregisterConnection(key, connection);
				await connection.close();
			},
		};
	}
}
