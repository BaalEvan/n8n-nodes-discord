import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class DiscordWebhookApi implements ICredentialType {
	name = 'discordGatewayWebhookApi';

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-miscased, n8n-nodes-base/cred-class-field-display-name-missing-api
	displayName = 'Discord Webhook API (Gateway fork)';

	icon: Icon = { light: 'file:../icons/discord.svg', dark: 'file:../icons/discord.dark.svg' };

	documentationUrl = 'https://docs.discord.com/developers/resources/webhook';

	properties: INodeProperties[] = [
		{
			displayName: 'Webhook URL',
			name: 'webhookUrl',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			placeholder: 'https://discord.com/api/webhooks/...',
			description: 'Discord webhook URL, including webhook ID and token.',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			url: '={{$credentials.webhookUrl}}',
			method: 'GET',
		},
	};
}
