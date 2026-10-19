import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';

import { allFields, allOperations } from './resources';
import { DISCORD_API_BASE_URL } from './shared/constants';

export class Discord implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Discord',
		name: 'discord',
		icon: { light: 'file:discord.svg', dark: 'file:discord.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		description: 'Interact with Discord API - users, messages, webhooks, guilds, interactions, and more',
		defaults: {
			name: 'Discord',
		},
		usableAsTool: true,
		codex: {
			categories: ['Communication'],
			subcategories: {
				Communication: ['Messaging', 'Server Management'],
			},
			alias: [
				'bot',
				'chat',
				'message',
				'guild',
				'server',
				'channel',
				'webhook',
				'embed',
				'slash command',
				'interaction',
				'moderation',
				'ban',
				'kick',
				'role',
				'voice',
				'emoji',
				'sticker',
				'soundboard',
				'lobby',
			],
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'discordGatewayBotApi',
				required: true,
				displayOptions: { show: { authentication: ['bot'] } },
			},
			{
				name: 'discordGatewayOAuth2Api',
				required: true,
				displayOptions: { show: { authentication: ['oauth2'] } },
			},
		],
		requestDefaults: {
			baseURL: DISCORD_API_BASE_URL,
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
		},
		properties: [
			{
				displayName: 'Authentication',
				name: 'authentication',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Bot Token', value: 'bot' },
					{ name: 'OAuth2 (User Token)', value: 'oauth2' },
				],
				default: 'bot',
				description:
					'Bot tokens are used for server automation. OAuth2 user tokens are required for operations that act on behalf of a specific user (e.g., list current user guilds, get user connections, create group DM, update role connection).',
			},
			{
				displayName:
					'Bot Token is for server automation (sending messages, moderation). OAuth2 (User Token) is required for operations that act on behalf of a specific user, marked "Requires OAuth2 user token" in their description (e.g., User: getCurrentConnections, getCurrentApplicationRoleConnection, updateCurrentApplicationRoleConnection, createGroupDm).',
				name: 'authenticationNotice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Application', value: 'application' },
					{ name: 'Application Command', value: 'applicationCommand' },
					{ name: 'Application Role Connection Metadata', value: 'applicationRoleConnectionMetadata' },
					{ name: 'Audit Log', value: 'auditLog' },
					{ name: 'Auto Moderation', value: 'autoModeration' },
					{ name: 'Channel', value: 'channel' },
					{ name: 'Emoji', value: 'emoji' },
					{ name: 'Entitlement', value: 'entitlement' },
					{ name: 'Guild', value: 'guild' },
					{ name: 'Guild Scheduled Event', value: 'guildScheduledEvent' },
					{ name: 'Guild Template', value: 'guildTemplate' },
					{ name: 'Interaction Response', value: 'interactionResponse' },
					{ name: 'Invite', value: 'invite' },
					{ name: 'Lobby', value: 'lobby' },
					{ name: 'Member', value: 'member' },
					{ name: 'Message', value: 'message' },
					{ name: 'Poll', value: 'poll' },
					{ name: 'Role', value: 'role' },
					{ name: 'SKU', value: 'sku' },
					{ name: 'Soundboard', value: 'soundboard' },
					{ name: 'Stage Instance', value: 'stageInstance' },
					{ name: 'Sticker', value: 'sticker' },
					{ name: 'Subscription', value: 'subscription' },
					{ name: 'User', value: 'user' },
					{ name: 'Voice', value: 'voice' },
					{ name: 'Webhook', value: 'webhook' },
				],
				default: 'user',
			},
			...allOperations,
			...allFields,
		],
	};
}
