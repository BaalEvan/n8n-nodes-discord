import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type ITriggerFunctions,
	type ITriggerResponse,
} from 'n8n-workflow';

import {
	closeStaleConnection,
	identifyBudgetFor,
	productionHolder,
	registerConnection,
	registryKey,
	tokenFingerprint,
	unregisterConnection,
} from './connectionRegistry';
import { DiscordGatewayConnection } from './DiscordGatewayConnection';
import { triggerProperties } from './events';
import { registerGatewaySender, unregisterGatewaySender } from './gatewaySendBus';

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

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const event = this.getNodeParameter('event') as string;
		const connectionName = (this.getNodeParameter('connectionName', 'default') as string) || 'default';

		const credentials = await this.getCredentials('discordGatewayBotApi');
		const fingerprint = tokenFingerprint(credentials.botToken as string);
		const mode = this.getMode() === 'manual' ? 'manual' : 'trigger';

		const workflowId = this.getWorkflow().id ?? '';
		const nodeId = this.getNode().id;
		const key = registryKey(workflowId, nodeId, mode);

		if (mode === 'manual') {
			if (productionHolder(fingerprint)) {
				throw new NodeOperationError(
					this.getNode(),
					'This bot token is in use by an active Discord Trigger. Use the test bot token for manual runs.',
				);
			}
		}

		// Defensive cleanup for cases where n8n's lifecycle does not invoke
		// closeFunction before re-running trigger() (workflow re-activation, hot
		// reload during dev, etc.).
		// We include workflow ID for process-wide uniqueness, and node ID because
		// it is persistent across renames.
		await closeStaleConnection(key);

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

		const connection = new DiscordGatewayConnection(this, event, onEvent, {
			identifyBudget: identifyBudgetFor(fingerprint),
		});

		// Register the connection BEFORE connecting to ensure that if trigger()
		// is called again while connect() is in progress, the next call can
		// find and close this connection.
		registerConnection(key, fingerprint, mode, connection);

		// Manual runs never take over a connection name, so they cannot displace
		// the production sender.
		const sender = (payload: { op: number; d: unknown }) => connection.sendCommand(payload);
		if (mode === 'trigger') {
			registerGatewaySender(connectionName, sender);
		}

		try {
			await connection.start();
		} catch (error) {
			// If connection fails, make sure we don't leave a dead reference in the map
			unregisterConnection(key, connection);
			if (mode === 'trigger') {
				unregisterGatewaySender(connectionName, sender);
			}
			throw new NodeOperationError(this.getNode(), error as Error);
		}

		return {
			closeFunction: async () => {
				if (mode === 'trigger') {
					unregisterGatewaySender(connectionName, sender);
				}
				unregisterConnection(key, connection);
				await connection.close();
			},
		};
	}
}
