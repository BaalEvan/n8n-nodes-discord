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
