import type {
	Icon,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class DiscordOAuth2Api implements ICredentialType {
	name = 'discordGatewayOAuth2Api';

	extends = ['oAuth2Api'];

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-miscased, n8n-nodes-base/cred-class-field-display-name-missing-api, n8n-nodes-base/cred-class-field-display-name-missing-oauth2
	displayName = 'Discord OAuth2 API (Gateway fork)';

	icon: Icon = { light: 'file:../icons/discord.svg', dark: 'file:../icons/discord.dark.svg' };

	documentationUrl = 'https://docs.discord.com/developers/topics/oauth2';

	properties: INodeProperties[] = [
		{
			displayName: 'Grant Type',
			name: 'grantType',
			type: 'hidden',
			default: 'authorizationCode',
		},
		{
			displayName: 'Authorization URL',
			name: 'authUrl',
			type: 'hidden',
			default: 'https://discord.com/oauth2/authorize',
			required: true,
		},
		{
			displayName: 'Access Token URL',
			name: 'accessTokenUrl',
			type: 'hidden',
			default: 'https://discord.com/api/oauth2/token',
			required: true,
		},
		{
			displayName: 'Client ID',
			name: 'clientId',
			type: 'string',
			default: '',
			required: true,
		},
		{
			displayName: 'Client Secret',
			name: 'clientSecret',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
		},
		{
			displayName: 'Scope',
			name: 'scope',
			type: 'string',
			default: 'identify guilds email connections role_connections.write applications.commands',
			description: 'Discord OAuth2 scopes. Bot-token automation should use the Discord Bot API credential instead.',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'hidden',
			default: 'body',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://discord.com/api/v10',
			url: '/users/@me',
		},
	};
}
