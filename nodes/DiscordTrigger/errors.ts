import { ApplicationError } from 'n8n-workflow';

import { getCloseCodeMeta } from './closeCodes';

export class FatalGatewayError extends ApplicationError {
	readonly closeCode: number;

	constructor(closeCode: number, message?: string) {
		const meta = getCloseCodeMeta(closeCode);
		const reason = meta ? `${meta.name}: ${meta.description}` : 'non-recoverable close code';
		super(
			message ??
				`Discord Gateway closed with code ${closeCode} (${reason}). This close code is non-recoverable; check the bot token, enabled intents, and Developer Portal settings.`,
		);
		this.name = 'FatalGatewayError';
		this.closeCode = closeCode;
	}
}

export class InvalidSessionError extends ApplicationError {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidSessionError';
	}
}

export function httpStatusOf(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) return undefined;
	const candidate = error as {
		httpCode?: unknown;
		statusCode?: unknown;
		status?: unknown;
		response?: { status?: unknown; statusCode?: unknown };
		extra?: { status?: unknown };
	};
	for (const value of [
		candidate.httpCode,
		candidate.statusCode,
		candidate.status,
		candidate.response?.status,
		candidate.response?.statusCode,
		candidate.extra?.status,
	]) {
		const status = Number(value);
		if (Number.isInteger(status) && status > 0) return status;
	}
	return undefined;
}
