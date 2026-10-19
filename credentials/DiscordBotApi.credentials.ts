import type {
	Icon,
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DiscordBotApi implements ICredentialType {
	name = 'discordGatewayBotApi';

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-miscased, n8n-nodes-base/cred-class-field-display-name-missing-api
	displayName = 'Discord Bot API (Gateway fork)';

	icon: Icon = { light: 'file:../icons/discord.svg', dark: 'file:../icons/discord.dark.svg' };

	documentationUrl = 'https://docs.discord.com/developers/topics/oauth2#bots';

	properties: INodeProperties[] = [
		{
			displayName: 'Bot Token',
			name: 'botToken',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			description: 'Discord bot token. Do not include the "Bot" prefix.',
		},
		{
			displayName: 'Application ID',
			name: 'applicationId',
			type: 'string',
			default: '',
			description: 'Optional Discord application ID, used as a default for application command operations.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bot {{$credentials.botToken}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://discord.com/api/v10',
			url: '/users/@me',
		},
	};
}
