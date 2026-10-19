import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type INodeType,
	type INodeTypeDescription,
	type ITriggerFunctions,
	type ITriggerResponse,
} from 'n8n-workflow';

import { DiscordGatewayConnection } from './DiscordGatewayConnection';
import { triggerProperties } from './events';
import { registerGatewaySender, unregisterGatewaySender } from './gatewaySendBus';

// Module-level registry of active connections keyed by workflow + node id.
// Defensive cleanup for cases where n8n's lifecycle does not invoke
// closeFunction before re-running trigger() (workflow re-activation, hot
// reload during dev, etc.). Without this, the previous WebSocket stays open
// and Discord continues delivering events to it in parallel with the new one,
// causing duplicate emits that accumulate per re-activation.
const activeConnections = new Map<string, DiscordGatewayConnection>();

async function closeStaleConnection(registryKey: string): Promise<void> {
	const stale = activeConnections.get(registryKey);
	if (!stale) {
		return;
	}

	activeConnections.delete(registryKey);
	await stale.close();
}

function registerActiveConnection(
	registryKey: string,
	connection: DiscordGatewayConnection,
): void {
	activeConnections.set(registryKey, connection);
}

function unregisterActiveConnection(
	registryKey: string,
	connection: DiscordGatewayConnection,
): void {
	if (activeConnections.get(registryKey) === connection) {
		activeConnections.delete(registryKey);
	}
}

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

		const workflowId = this.getWorkflow().id ?? '';
		const nodeId = this.getNode().id;
		const registryKey = `${workflowId}:${nodeId}`;

		// Defensive cleanup for cases where n8n's lifecycle does not invoke
		// closeFunction before re-running trigger() (workflow re-activation, hot
		// reload during dev, etc.).
		// We include workflow ID for process-wide uniqueness, and node ID because
		// it is persistent across renames.
		await closeStaleConnection(registryKey);

		const onEvent = (eventData: IDataObject) => {
			this.emit([this.helpers.returnJsonArray([eventData])]);
		};

		const connection = new DiscordGatewayConnection(this, event, onEvent);

		// Register the connection BEFORE connecting to ensure that if trigger()
		// is called again while connect() is in progress, the next call can
		// find and close this connection.
		registerActiveConnection(registryKey, connection);

		const sender = (payload: { op: number; d: unknown }) => connection.sendCommand(payload);
		registerGatewaySender(connectionName, sender);

		try {
			await connection.start();
		} catch (error) {
			// If connection fails, make sure we don't leave a dead reference in the map
			unregisterActiveConnection(registryKey, connection);
			unregisterGatewaySender(connectionName, sender);
			throw new NodeOperationError(this.getNode(), error as Error);
		}

		return {
			closeFunction: async () => {
				unregisterGatewaySender(connectionName, sender);
				unregisterActiveConnection(registryKey, connection);
				await connection.close();
			},
		};
	}
}
