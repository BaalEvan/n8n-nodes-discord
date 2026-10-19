import type { Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class DiscordInteractionApi implements ICredentialType {
	name = 'discordGatewayInteractionApi';

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-miscased, n8n-nodes-base/cred-class-field-display-name-missing-api
	displayName = 'Discord Interaction API (Gateway fork)';

	icon: Icon = { light: 'file:../icons/discord.svg', dark: 'file:../icons/discord.dark.svg' };

	documentationUrl = 'https://docs.discord.com/developers/interactions/receiving-and-responding';

	properties: INodeProperties[] = [
		{
			displayName: 'Application ID',
			name: 'applicationId',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Public Key',
			name: 'publicKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Public key used to verify HTTP interaction signatures.',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://discord.com/api/v10',
			url: '/gateway',
			method: 'GET',
		},
	};
}
