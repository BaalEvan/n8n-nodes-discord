import type { INodeProperties } from 'n8n-workflow';

import { gatewayIntentOptions } from '../../Discord/shared/intents';
import { applicationCommandEvents } from './applicationCommand';
import { autoModerationEvents } from './autoModeration';
import { channelThreadEvents } from './channelThread';
import { coreEvents } from './core';
import { entitlementEvents } from './entitlement';
import { guildEvents } from './guild';
import { guildScheduledEventEvents } from './guildScheduledEvent';
import { integrationEvents } from './integration';
import { interactionEvents } from './interaction';
import { inviteEvents } from './invite';
import { messageEvents } from './message';
import { pollEvents } from './poll';
import { presenceEvents } from './presence';
import { reactionEvents } from './reaction';
import { soundboardEvents } from './soundboard';
import { stageInstanceEvents } from './stageInstance';
import { subscriptionEvents } from './subscription';
import { typingEvents } from './typing';
import type { DiscordEventMeta } from './types';
import { userEvents } from './user';
import { voiceEvents } from './voice';

export type { DiscordEventMeta } from './types';
export { shouldEmitGatewayEvent } from './policies';
export { coreEvents } from './core';
export { applicationCommandEvents } from './applicationCommand';
export { autoModerationEvents } from './autoModeration';
export { channelThreadEvents } from './channelThread';
export { entitlementEvents } from './entitlement';
export { guildEvents } from './guild';
export { guildScheduledEventEvents } from './guildScheduledEvent';
export { integrationEvents } from './integration';
export { interactionEvents } from './interaction';
export { inviteEvents } from './invite';
export { messageEvents } from './message';
export { pollEvents } from './poll';
export { presenceEvents } from './presence';
export { reactionEvents } from './reaction';
export { soundboardEvents } from './soundboard';
export { stageInstanceEvents } from './stageInstance';
export { subscriptionEvents } from './subscription';
export { typingEvents } from './typing';
export { userEvents } from './user';
export { voiceEvents } from './voice';

export const allDiscordGatewayEvents: DiscordEventMeta[] = [
	...coreEvents,
	...applicationCommandEvents,
	...autoModerationEvents,
	...channelThreadEvents,
	...entitlementEvents,
	...guildEvents,
	...guildScheduledEventEvents,
	...integrationEvents,
	...interactionEvents,
	...inviteEvents,
	...messageEvents,
	...reactionEvents,
	...pollEvents,
	...presenceEvents,
	...soundboardEvents,
	...stageInstanceEvents,
	...subscriptionEvents,
	...typingEvents,
	...userEvents,
	...voiceEvents,
];

export const privilegedDiscordGatewayEvents: DiscordEventMeta[] = allDiscordGatewayEvents.filter(
	(event) => event.privileged === true,
);

const eventMetaByName: Record<string, DiscordEventMeta> = allDiscordGatewayEvents.reduce(
	(acc, event) => {
		acc[event.name] = event;
		return acc;
	},
	{} as Record<string, DiscordEventMeta>,
);

export function getEventMeta(name: string): DiscordEventMeta | undefined {
	return eventMetaByName[name];
}

const eventOptionsFromMeta = allDiscordGatewayEvents
	.map((event) => ({ name: event.displayName, value: event.name }))
	.sort((a, b) => a.name.localeCompare(b.name));

export const gatewayEventOptions = [
	{ name: 'Any Event', value: '*' },
	...eventOptionsFromMeta,
];

export const discordTriggerEvents = allDiscordGatewayEvents;

export const triggerProperties: INodeProperties[] = [
	{
		displayName: 'Event',
		name: 'event',
		type: 'options',
		noDataExpression: true,
		required: true,
		options: gatewayEventOptions,
		default: '',
		description: 'Discord Gateway event to listen for. Full Gateway event coverage is tracked in the TODO.',
	},
	{
		displayName: 'Connection Name',
		name: 'connectionName',
		type: 'string',
		default: 'default',
		description:
			'Identifier used by the Discord Gateway Send node to route commands to this connection. Default "default" works if you only have one Discord Trigger active.',
	},
	{
		displayName: 'Alert User ID',
		name: 'alertUserId',
		type: 'string',
		default: '',
		description: 'Discord user ID to DM on outages and fatal errors. Empty disables alerts.',
	},
	{
		displayName: 'Alert After (Minutes)',
		name: 'alertAfterMinutes',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 10,
		description: 'How long the Gateway must stay disconnected before the owner is alerted',
	},
	{
		displayName:
			'Some events require privileged intents that must be enabled separately in the Discord Developer Portal under your application → Bot → Privileged Gateway Intents: MESSAGE_CONTENT (needed to see message text in MESSAGE_CREATE / MESSAGE_UPDATE), GUILD_MEMBERS (needed for GUILD_MEMBER_ADD / UPDATE / REMOVE), GUILD_PRESENCES (needed for PRESENCE_UPDATE). If the intent is requested without being enabled, Discord closes the Gateway connection with code 4014.',
		name: 'privilegedIntentsNotice',
		type: 'notice',
		default: '',
	},
	{
		displayName: 'Auto Calculate Intents',
		name: 'autoCalculateIntents',
		type: 'boolean',
		default: true,
		description:
			'Whether to derive Gateway intents from the selected event. Auto-calculate includes privileged intents when the event needs them (e.g., MESSAGE_CONTENT for MESSAGE_CREATE) — make sure those are enabled in the Discord Developer Portal.',
	},
	{
		displayName: 'Intents',
		name: 'intents',
		type: 'multiOptions',
		options: gatewayIntentOptions,
		default: ['GUILDS'],
		displayOptions: {
			show: {
				autoCalculateIntents: [false],
			},
		},
		description:
			'Gateway intents to send with Identify. Privileged intents (MESSAGE_CONTENT, GUILD_MEMBERS, GUILD_PRESENCES) must be enabled in the Discord Developer Portal or Discord closes the connection with code 4014.',
	},
	{
		displayName: 'Include Bot Messages',
		name: 'includeBotMessages',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				event: ['MESSAGE_CREATE', 'MESSAGE_UPDATE', '*'],
			},
		},
		description:
			'Whether to emit messages authored by bots (including this bot), webhooks, or Discord system. Default off prevents infinite loops when this workflow also sends messages. Only applies to MESSAGE_CREATE and MESSAGE_UPDATE events.',
	},
	{
		displayName: 'Emit Raw Gateway Payload',
		name: 'emitRawPayload',
		type: 'boolean',
		default: false,
		description: 'Whether to emit the full Gateway payload instead of only the event data with metadata',
	},
];
