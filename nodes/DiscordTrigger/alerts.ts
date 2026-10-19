import type { IDataObject, ITriggerFunctions } from 'n8n-workflow';

import { DISCORD_API_BASE_URL } from '../Discord/shared/constants';

export type AlertKind = 'fatal' | 'down' | 'recovered';

export interface AlertSink {
	send(kind: AlertKind, text: string): Promise<boolean>;
}

export type AlertDetails =
	| { code: number; name: string; description: string }
	| { minutes: number };

export function alertText(kind: 'fatal', details: { code: number; name: string; description: string }): string;
export function alertText(kind: 'down' | 'recovered', details: { minutes: number }): string;
export function alertText(kind: AlertKind, details: AlertDetails): string {
	if (kind === 'fatal') {
		const { code, name, description } = details as { code: number; name: string; description: string };
		return `Discord bot stopped: Gateway closed with ${code} ${name}. ${description} Fix the token or intents, then reactivate the workflow.`;
	}
	const { minutes } = details as { minutes: number };
	if (kind === 'down') {
		return `Discord bot has been disconnected from the Gateway for ${minutes} minutes. Still retrying.`;
	}
	return `Discord bot reconnected after ${minutes} minutes offline.`;
}

// Fatal alerts go out once per process per token fingerprint and close code.
const sentFatalAlerts = new Set<string>();

export function claimFatalAlert(key: string): boolean {
	if (sentFatalAlerts.has(key)) return false;
	sentFatalAlerts.add(key);
	return true;
}

export function createDmAlertSink(trigger: ITriggerFunctions, userId: string): AlertSink {
	let channelId: string | undefined;

	const request = (url: string, body: IDataObject) =>
		trigger.helpers.httpRequestWithAuthentication.call(trigger, 'discordGatewayBotApi', {
			method: 'POST',
			url: `${DISCORD_API_BASE_URL}${url}`,
			body,
			json: true,
		}) as Promise<IDataObject>;

	return {
		async send(_kind, text) {
			try {
				if (!channelId) {
					const channel = await request('/users/@me/channels', { recipient_id: userId });
					if (typeof channel.id !== 'string') return false;
					channelId = channel.id;
				}
				await request(`/channels/${channelId}/messages`, { content: text });
				return true;
			} catch {
				return false;
			}
		},
	};
}
