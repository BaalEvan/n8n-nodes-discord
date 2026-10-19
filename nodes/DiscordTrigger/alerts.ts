import { LoggerProxy, type IDataObject, type ITriggerFunctions } from 'n8n-workflow';

import { DISCORD_API_BASE_URL } from '../Discord/shared/constants';
import { httpStatusOf } from './errors';

export const REST_TIMEOUT_MS = 15_000;

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

export function releaseFatalAlerts(fingerprint: string): void {
	for (const key of sentFatalAlerts) {
		if (key.startsWith(`${fingerprint}:`)) sentFatalAlerts.delete(key);
	}
}

export function botAuthHeaders(token: string): IDataObject {
	return { Authorization: `Bot ${token}` };
}

export function createDmAlertSink(
	trigger: ITriggerFunctions,
	token: string,
	userId: string,
): AlertSink {
	let channelId: string | undefined;

	const request = (url: string, body: IDataObject) =>
		trigger.helpers.httpRequest({
			method: 'POST',
			url: `${DISCORD_API_BASE_URL}${url}`,
			headers: botAuthHeaders(token),
			body,
			json: true,
			timeout: REST_TIMEOUT_MS,
		}) as Promise<IDataObject>;

	return {
		async send(kind, text) {
			try {
				if (!channelId) {
					const channel = await request('/users/@me/channels', { recipient_id: userId });
					if (typeof channel.id !== 'string') return false;
					channelId = channel.id;
				}
				await request(`/channels/${channelId}/messages`, { content: text });
				return true;
			} catch (error) {
				LoggerProxy.warn('Discord owner alert failed', {
					kind,
					status: httpStatusOf(error),
					error: error instanceof Error ? error.message : String(error),
					nodeType: 'n8n-nodes-discord.discordTrigger',
				});
				return false;
			}
		},
	};
}
