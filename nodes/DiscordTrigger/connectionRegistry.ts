import { createHash } from 'node:crypto';

import type { DiscordGatewayConnection } from './DiscordGatewayConnection';
import { IdentifyBudget } from './reconnectPolicy';

export type ConnectionMode = 'trigger' | 'manual';

interface RegistryEntry {
	fingerprint: string;
	mode: ConnectionMode;
	connection: DiscordGatewayConnection;
	onTakeover?: () => void;
}

// Module-level registry of active connections keyed by workflow + node id + mode.
// Defensive cleanup for cases where n8n's lifecycle does not invoke
// closeFunction before re-running trigger() (workflow re-activation, hot
// reload during dev, etc.). Without this, the previous WebSocket stays open
// and Discord continues delivering events to it in parallel with the new one,
// causing duplicate emits that accumulate per re-activation.
const activeConnections = new Map<string, RegistryEntry>();

// One identify budget per token, kept for the life of the process so
// re-activation does not reset the daily identify count.
const identifyBudgets = new Map<string, IdentifyBudget>();

export function tokenFingerprint(token: string): string {
	return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

export function registryKey(workflowId: string, nodeId: string, mode: ConnectionMode): string {
	return `${workflowId}:${nodeId}:${mode}`;
}

export function identifyBudgetFor(fingerprint: string): IdentifyBudget {
	let budget = identifyBudgets.get(fingerprint);
	if (!budget) {
		budget = new IdentifyBudget();
		identifyBudgets.set(fingerprint, budget);
	}
	return budget;
}

export async function closeStaleConnection(key: string): Promise<void> {
	const stale = activeConnections.get(key);
	if (!stale) {
		return;
	}

	activeConnections.delete(key);
	await stale.connection.close();
}

export function registerConnection(
	key: string,
	fingerprint: string,
	mode: ConnectionMode,
	connection: DiscordGatewayConnection,
	onTakeover?: () => void,
): void {
	activeConnections.set(key, { fingerprint, mode, connection, onTakeover });
}

export function unregisterConnection(key: string, connection: DiscordGatewayConnection): void {
	if (activeConnections.get(key)?.connection === connection) {
		activeConnections.delete(key);
	}
}

export function productionHolder(fingerprint: string): string | undefined {
	for (const [key, entry] of activeConnections) {
		if (entry.mode === 'trigger' && entry.fingerprint === fingerprint) {
			return key;
		}
	}
	return undefined;
}

export function takeOverManualConnections(fingerprint: string): Promise<void> {
	const closing: Array<Promise<void>> = [];
	for (const [key, entry] of activeConnections) {
		if (entry.mode === 'manual' && entry.fingerprint === fingerprint) {
			activeConnections.delete(key);
			entry.onTakeover?.();
			closing.push(entry.connection.close());
		}
	}
	return Promise.all(closing).then(() => undefined);
}
