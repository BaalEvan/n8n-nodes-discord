import { describe, expect, it } from 'vitest';

import pkg from '../package.json';
import { DiscordBotApi } from '../credentials/DiscordBotApi.credentials';
import { DiscordInteractionApi } from '../credentials/DiscordInteractionApi.credentials';
import { DiscordOAuth2Api } from '../credentials/DiscordOAuth2Api.credentials';
import { DiscordWebhookApi } from '../credentials/DiscordWebhookApi.credentials';
import { PACKAGE_VERSION } from '../nodes/DiscordTrigger/version';

const sources = import.meta.glob<string>('../{credentials,nodes}/**/*.ts', {
	query: '?raw',
	import: 'default',
	eager: true,
});

describe('package identity', () => {
	it('PACKAGE_VERSION matches package.json version', () => {
		expect(PACKAGE_VERSION).toBe(pkg.version);
	});

	it('no source file references the upstream credential names', () => {
		const entries = Object.entries(sources);
		expect(entries.length).toBeGreaterThan(0);
		for (const [file, content] of entries) {
			expect(content, file).not.toMatch(/'discord(Bot|OAuth2|Webhook|Interaction)Api'/);
		}
	});

	it('credential classes use the fork names', () => {
		expect(new DiscordBotApi().name).toBe('discordGatewayBotApi');
		expect(new DiscordOAuth2Api().name).toBe('discordGatewayOAuth2Api');
		expect(new DiscordWebhookApi().name).toBe('discordGatewayWebhookApi');
		expect(new DiscordInteractionApi().name).toBe('discordGatewayInteractionApi');
	});

	it('credential display names are distinct from upstream', () => {
		expect(new DiscordBotApi().displayName).toBe('Discord Gateway Bot API');
		expect(new DiscordOAuth2Api().displayName).toBe('Discord Gateway OAuth2 API');
		expect(new DiscordWebhookApi().displayName).toBe('Discord Gateway Webhook API');
		expect(new DiscordInteractionApi().displayName).toBe('Discord Gateway Interaction API');
	});
});
