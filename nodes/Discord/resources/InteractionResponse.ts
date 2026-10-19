import type {
	IDataObject,
	IExecuteSingleFunctions,
	IHttpRequestOptions,
	INodeProperties,
} from 'n8n-workflow';

import {
	buildAllowedMentionsFromCollection,
	createAllowedMentionsCollectionField,
} from '../shared/allowedMentions';
import {
	buildAttachmentMetadata,
	buildDiscordMultipartBody,
	createAttachmentsCollectionField,
	type DiscordAttachmentInput,
	type DiscordMultipartFile,
} from '../shared/attachments';
import {
	buildEmbedsFromCollection,
	createEmbedsCollectionField,
	validateEmbeds,
} from '../shared/embeds';
import {
	DISCORD_MESSAGE_FLAG_IS_COMPONENTS_V2,
	buildButtonsActionRow,
	buildMediaGalleryComponent,
	buildMentionableSelectActionRow,
	buildSeparatorComponents,
	buildStringSelectActionRow,
	buildTextDisplayComponents,
	buildTextInputsActionRow,
	buildV2FileComponents,
	createButtonComponentsField,
	createComponentsJsonField,
	createMediaGalleryField,
	createMentionableSelectComponentField,
	createSeparatorComponentField,
	createStringSelectComponentField,
	createTextDisplayField,
	createTextInputComponentField,
	createV2FileComponentField,
	hasV2LayoutComponents,
	validateComponents,
	validateV2Components,
	type DiscordComponent,
} from '../shared/components';
import { parseOptionalJsonField, createRawJsonField } from '../shared/messagePayload';
import { createOperationSelector, defineDiscordRestOperation } from '../shared/operation';

const INTERACTION_CALLBACK_TYPE = {
	CHANNEL_MESSAGE_WITH_SOURCE: 4,
	DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5,
	DEFERRED_UPDATE_MESSAGE: 6,
	UPDATE_MESSAGE: 7,
	APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: 8,
	MODAL: 9,
	LAUNCH_ACTIVITY: 12,
} as const;

type InteractionCallbackType =
	(typeof INTERACTION_CALLBACK_TYPE)[keyof typeof INTERACTION_CALLBACK_TYPE];

const responseTypeOptions = [
	{
		name: 'Channel Message With Source (4)',
		value: INTERACTION_CALLBACK_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
		description: 'Respond to an interaction by sending a new message',
	},
	{
		name: 'Deferred Channel Message With Source (5)',
		value: INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
		description: 'ACK now and send a follow-up later; user sees a loading state',
	},
	{
		name: 'Deferred Update Message (6)',
		value: INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
		description: 'ACK a component interaction; original message is unchanged for now',
	},
	{
		name: 'Update Message (7)',
		value: INTERACTION_CALLBACK_TYPE.UPDATE_MESSAGE,
		description: 'Edit the message a component is attached to',
	},
	{
		name: 'Application Command Autocomplete Result (8)',
		value: INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
		description: 'Respond to autocomplete interactions with suggested choices',
	},
	{
		name: 'Modal (9)',
		value: INTERACTION_CALLBACK_TYPE.MODAL,
		description: 'Respond with a modal containing text inputs',
	},
	{
		name: 'Launch Activity (12)',
		value: INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
		description: 'Launch the activity associated with this application',
	},
];

interface MessagePayloadOptions {
	includePoll?: boolean;
	includeTts?: boolean;
}

function readAttachmentInputs(this: IExecuteSingleFunctions): DiscordAttachmentInput[] {
	const raw = this.getNodeParameter('attachments', {}) as IDataObject;
	const collection = raw?.attachment;
	if (!Array.isArray(collection)) {
		return [];
	}

	return collection
		.filter((entry): entry is IDataObject => !!entry && typeof entry === 'object')
		.map((entry) => {
			const input: DiscordAttachmentInput = {
				binaryPropertyName: String(entry.binaryPropertyName ?? '').trim(),
			};
			const filename = typeof entry.filename === 'string' ? entry.filename.trim() : '';
			if (filename) input.filename = filename;
			const description = typeof entry.description === 'string' ? entry.description.trim() : '';
			if (description) input.description = description;
			const contentType = typeof entry.contentType === 'string' ? entry.contentType.trim() : '';
			if (contentType) input.contentType = contentType;
			return input;
		})
		.filter((input) => input.binaryPropertyName.length > 0);
}

async function readAttachmentFiles(
	this: IExecuteSingleFunctions,
	inputs: DiscordAttachmentInput[],
): Promise<DiscordMultipartFile[]> {
	const files: DiscordMultipartFile[] = [];
	for (const input of inputs) {
		const binaryData = this.helpers.assertBinaryData(input.binaryPropertyName);
		const buffer = await this.helpers.getBinaryDataBuffer(input.binaryPropertyName);
		files.push({
			name: input.filename ?? binaryData.fileName ?? input.binaryPropertyName,
			data: buffer,
			contentType: input.contentType ?? binaryData.mimeType,
		});
	}
	return files;
}

function buildMessagePayload(
	this: IExecuteSingleFunctions,
	options: MessagePayloadOptions = {},
): IDataObject {
	const data: IDataObject = {};

	const content = this.getNodeParameter('content', '') as string;
	if (typeof content === 'string' && content.length > 0) {
		data.content = content;
	}

	const embedsValue = this.getNodeParameter('embeds', {}) as IDataObject;
	const embeds = buildEmbedsFromCollection(embedsValue);
	if (embeds.length > 0) {
		validateEmbeds(embeds);
		data.embeds = embeds;
	}

	const rows: DiscordComponent[] = [];

	const buttonRowRaw = this.getNodeParameter('buttonRow', {}) as unknown;
	rows.push(...buildButtonsActionRow(buttonRowRaw));

	const stringSelectRaw = this.getNodeParameter('stringSelect', {}) as unknown;
	rows.push(...buildStringSelectActionRow(stringSelectRaw));

	const mentionableSelectRaw = this.getNodeParameter('mentionableSelect', {}) as unknown;
	rows.push(...buildMentionableSelectActionRow(mentionableSelectRaw));

	// Raw JSON components are appended after the guided rows, acting as an
	// escape hatch / extension (e.g. v2 layout) rather than overriding the GUI.
	const componentsRaw = this.getNodeParameter('components', '') as string;
	const componentsJson = parseOptionalJsonField<unknown>(componentsRaw, 'components');
	if (Array.isArray(componentsJson)) {
		rows.push(...(componentsJson as DiscordComponent[]));
	}

	const textDisplaysRaw = this.getNodeParameter('textDisplays', {}) as unknown;
	rows.push(...buildTextDisplayComponents(textDisplaysRaw));

	const separatorsRaw = this.getNodeParameter('separators', {}) as unknown;
	rows.push(...buildSeparatorComponents(separatorsRaw));

	const mediaGalleryRaw = this.getNodeParameter('mediaGallery', {}) as unknown;
	const mediaGallery = buildMediaGalleryComponent(mediaGalleryRaw);
	if (mediaGallery !== undefined) {
		rows.push(mediaGallery);
	}

	const v2FilesRaw = this.getNodeParameter('v2Files', {}) as unknown;
	rows.push(...buildV2FileComponents(v2FilesRaw));

	if (rows.length > 0) {
		validateComponents(rows);
		validateV2Components(rows);
		data.components = rows as unknown as IDataObject[];
	}

	const allowedMentions = buildAllowedMentionsFromCollection(
		this.getNodeParameter('allowedMentions', {}),
	);
	if (allowedMentions !== undefined) {
		data.allowed_mentions = allowedMentions;
	}

	const flags = this.getNodeParameter('flags', 0) as number;
	let resolvedFlags = typeof flags === 'number' && flags > 0 ? flags : 0;
	// Auto-OR the IS_COMPONENTS_V2 flag when v2 layout components are present;
	// preserves any flag bits the user explicitly set in the Flags field.
	if (rows.length > 0 && hasV2LayoutComponents(rows)) {
		resolvedFlags |= DISCORD_MESSAGE_FLAG_IS_COMPONENTS_V2;
	}
	if (resolvedFlags > 0) {
		data.flags = resolvedFlags;
	}

	if (options.includeTts) {
		const tts = this.getNodeParameter('tts', false) as boolean;
		if (tts === true) {
			data.tts = true;
		}
	}

	if (options.includePoll) {
		const pollRaw = this.getNodeParameter('poll', '') as string;
		const poll = parseOptionalJsonField<unknown>(pollRaw, 'poll');
		if (poll !== undefined) {
			data.poll = poll as IDataObject;
		}
	}

	const overrideRaw = this.getNodeParameter('payload', '') as string;
	const override = parseOptionalJsonField<IDataObject>(overrideRaw, 'payload');
	if (override !== undefined && typeof override === 'object' && !Array.isArray(override)) {
		Object.assign(data, override);
	}

	return data;
}

function buildAutocompleteData(this: IExecuteSingleFunctions): IDataObject {
	const choicesRaw = this.getNodeParameter('choices', '[]') as string;
	const choices = parseOptionalJsonField<unknown>(choicesRaw, 'choices');
	if (!Array.isArray(choices)) {
		throw new Error('Autocomplete choices must be a JSON array');
	}
	return { choices };
}

function buildModalData(this: IExecuteSingleFunctions): IDataObject {
	const customId = (this.getNodeParameter('customId', '') as string).trim();
	const title = (this.getNodeParameter('title', '') as string).trim();
	if (!customId) {
		throw new Error('Modal responses require a custom_id');
	}
	if (!title) {
		throw new Error('Modal responses require a title');
	}

	const rows: DiscordComponent[] = [];

	// Guided text inputs: each input becomes its own action row (Discord requirement).
	const textInputsRaw = this.getNodeParameter('modalTextInputs', {}) as unknown;
	rows.push(...buildTextInputsActionRow(textInputsRaw));

	// Raw JSON modalComponents are appended after the guided rows as an escape hatch.
	const componentsRaw = this.getNodeParameter('modalComponents', '[]') as string;
	const componentsJson = parseOptionalJsonField<unknown>(componentsRaw, 'modalComponents');
	if (Array.isArray(componentsJson)) {
		rows.push(...(componentsJson as DiscordComponent[]));
	}

	if (rows.length === 0) {
		throw new Error('Modal responses require at least one text input or raw component row');
	}

	validateComponents(rows);

	return {
		custom_id: customId,
		title,
		components: rows as unknown as IDataObject[],
	};
}

function applyMultipartIfAttachments(
	requestOptions: IHttpRequestOptions,
	payloadJson: IDataObject,
	inputs: DiscordAttachmentInput[],
	files: DiscordMultipartFile[],
): IHttpRequestOptions {
	if (files.length === 0) {
		return {
			...requestOptions,
			body: payloadJson,
		};
	}

	const attachments = buildAttachmentMetadata(inputs);
	const existing = (payloadJson.attachments ?? payloadJson['attachments']) as
		| IDataObject[]
		| undefined;
	const merged = Array.isArray(existing) ? [...attachments, ...existing] : attachments;
	const finalPayload: IDataObject = { ...payloadJson, attachments: merged };

	const { body, headers } = buildDiscordMultipartBody({ payloadJson: finalPayload, files });
	return {
		...requestOptions,
		body,
		headers: {
			...(requestOptions.headers ?? {}),
			...headers,
		},
	};
}

export async function presendInitialCallback(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const responseType = this.getNodeParameter('responseType', 4) as InteractionCallbackType;

	let data: IDataObject | undefined;
	let attachmentInputs: DiscordAttachmentInput[] = [];
	let files: DiscordMultipartFile[] = [];

	switch (responseType) {
		case INTERACTION_CALLBACK_TYPE.CHANNEL_MESSAGE_WITH_SOURCE:
		case INTERACTION_CALLBACK_TYPE.UPDATE_MESSAGE: {
			data = buildMessagePayload.call(this, { includePoll: true, includeTts: true });
			attachmentInputs = readAttachmentInputs.call(this);
			files = await readAttachmentFiles.call(this, attachmentInputs);
			break;
		}
		case INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: {
			const flags = this.getNodeParameter('flags', 0) as number;
			data = {};
			if (typeof flags === 'number' && flags > 0) data.flags = flags;
			if (Object.keys(data).length === 0) data = undefined;
			break;
		}
		case INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE:
		case INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY: {
			data = undefined;
			break;
		}
		case INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT: {
			data = buildAutocompleteData.call(this);
			break;
		}
		case INTERACTION_CALLBACK_TYPE.MODAL: {
			data = buildModalData.call(this);
			break;
		}
		default:
			throw new Error(`Unsupported interaction response type: ${String(responseType)}`);
	}

	const body: IDataObject = { type: responseType };
	if (data !== undefined) body.data = data;

	if (files.length > 0) {
		const dataPayload = (body.data as IDataObject | undefined) ?? {};
		const wrapped = applyMultipartIfAttachments(requestOptions, dataPayload, attachmentInputs, files);
		const form = wrapped.body as FormData;
		const cleanedForm = new FormData();
		cleanedForm.append('payload_json', JSON.stringify({ type: responseType, data: dataPayload }));
		for (const [key, value] of form.entries()) {
			if (key === 'payload_json') continue;
			cleanedForm.append(key, value as Blob, value instanceof Blob ? undefined : undefined);
		}
		return {
			...wrapped,
			body: cleanedForm,
		};
	}

	return {
		...requestOptions,
		body,
	};
}

export async function presendEditMessage(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const data = buildMessagePayload.call(this, { includePoll: false, includeTts: false });
	const attachmentInputs = readAttachmentInputs.call(this);
	const files = await readAttachmentFiles.call(this, attachmentInputs);
	return applyMultipartIfAttachments(requestOptions, data, attachmentInputs, files);
}

export async function presendCreateFollowup(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const data = buildMessagePayload.call(this, { includePoll: true, includeTts: true });
	const attachmentInputs = readAttachmentInputs.call(this);
	const files = await readAttachmentFiles.call(this, attachmentInputs);
	return applyMultipartIfAttachments(requestOptions, data, attachmentInputs, files);
}

const messageFieldOperations = [
	'createInitialCallback',
	'editOriginalResponse',
	'createFollowupMessage',
	'editFollowupMessage',
];

const messageFollowupOps = ['editOriginalResponse', 'createFollowupMessage', 'editFollowupMessage'];

export const interactionResponseOperations: INodeProperties[] = [
	createOperationSelector(
		'interactionResponse',
		[
			defineDiscordRestOperation({
				name: 'Create Followup Message',
				value: 'createFollowupMessage',
				action: 'Create followup message',
				method: 'POST',
				url: '=/webhooks/{{$parameter.applicationId}}/{{$parameter.interactionToken}}',
				preSend: [presendCreateFollowup],
			}),
			defineDiscordRestOperation({
				name: 'Create Initial Callback',
				value: 'createInitialCallback',
				action: 'Create initial callback',
				method: 'POST',
				url: '=/interactions/{{$parameter.interactionId}}/{{$parameter.interactionToken}}/callback',
				preSend: [presendInitialCallback],
			}),
			defineDiscordRestOperation({
				name: 'Delete Followup Message',
				value: 'deleteFollowupMessage',
				action: 'Delete followup message',
				method: 'DELETE',
				url: '=/webhooks/{{$parameter.applicationId}}/{{$parameter.interactionToken}}/messages/{{$parameter.messageId}}',
				successOutput: true,
			}),
			defineDiscordRestOperation({
				name: 'Delete Original Response',
				value: 'deleteOriginalResponse',
				action: 'Delete original response',
				method: 'DELETE',
				url: '=/webhooks/{{$parameter.applicationId}}/{{$parameter.interactionToken}}/messages/@original',
				successOutput: true,
			}),
			defineDiscordRestOperation({
				name: 'Edit Followup Message',
				value: 'editFollowupMessage',
				action: 'Edit followup message',
				method: 'PATCH',
				url: '=/webhooks/{{$parameter.applicationId}}/{{$parameter.interactionToken}}/messages/{{$parameter.messageId}}',
				preSend: [presendEditMessage],
			}),
			defineDiscordRestOperation({
				name: 'Edit Original Response',
				value: 'editOriginalResponse',
				action: 'Edit original response',
				method: 'PATCH',
				url: '=/webhooks/{{$parameter.applicationId}}/{{$parameter.interactionToken}}/messages/@original',
				preSend: [presendEditMessage],
			}),
			defineDiscordRestOperation({
				name: 'Get Followup Message',
				value: 'getFollowupMessage',
				action: 'Get followup message',
				method: 'GET',
				url: '=/webhooks/{{$parameter.applicationId}}/{{$parameter.interactionToken}}/messages/{{$parameter.messageId}}',
			}),
			defineDiscordRestOperation({
				name: 'Get Original Response',
				value: 'getOriginalResponse',
				action: 'Get original response',
				method: 'GET',
				url: '=/webhooks/{{$parameter.applicationId}}/{{$parameter.interactionToken}}/messages/@original',
			}),
		],
		'createInitialCallback',
	),
];

export const interactionResponseFields: INodeProperties[] = [
	{
		displayName: 'Application',
		name: 'applicationId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 123456789012345678',
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: [
					'createFollowupMessage',
					'deleteFollowupMessage',
					'deleteOriginalResponse',
					'editFollowupMessage',
					'editOriginalResponse',
					'getFollowupMessage',
					'getOriginalResponse',
				],
			},
		},
		description: 'Application ID. Discord snowflake ID of the application.',
	},
	{
		displayName: 'Interaction',
		name: 'interactionId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 123456789012345678',
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback'],
			},
		},
		description: 'Interaction ID. Discord snowflake ID of the interaction.',
	},
	{
		displayName: 'Interaction Token',
		name: 'interactionToken',
		type: 'string',
		typeOptions: {
			password: true,
		},
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
			},
		},
		description: 'Interaction token from the Discord interaction payload',
	},
	{
		displayName: 'Message',
		name: 'messageId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 123456789012345678',
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['deleteFollowupMessage', 'editFollowupMessage', 'getFollowupMessage'],
			},
		},
		description: 'Message ID. Discord snowflake ID of the followup message.',
	},
	{
		displayName: 'Response Type',
		name: 'responseType',
		type: 'options',
		default: 4,
		required: true,
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback'],
			},
		},
		options: responseTypeOptions,
		description: 'Discord interaction callback type. Determines which fields below are sent.',
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
		description: 'Message text content',
	},
	createEmbedsCollectionField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
	}),
	createButtonComponentsField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
		name: 'buttonRow',
	}),
	createStringSelectComponentField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
		name: 'stringSelect',
	}),
	createMentionableSelectComponentField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
		name: 'mentionableSelect',
	}),
	createComponentsJsonField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
	}),
	createTextDisplayField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
	}),
	createSeparatorComponentField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
	}),
	createMediaGalleryField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
	}),
	createV2FileComponentField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
	}),
	createAttachmentsCollectionField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
	}),
	createAllowedMentionsCollectionField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
	}),
	{
		displayName: 'Flags',
		name: 'flags',
		type: 'number',
		default: 0,
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFieldOperations,
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
		description:
			'Discord message flags bitfield. 64 = EPHEMERAL, 4096 = SUPPRESS_NOTIFICATIONS, 32768 = IS_COMPONENTS_V2. Combine with bitwise OR.',
	},
	{
		displayName: 'TTS',
		name: 'tts',
		type: 'boolean',
		default: false,
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback', 'createFollowupMessage'],
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
		description: 'Whether the message should be sent as text-to-speech',
	},
	{
		displayName: 'Poll',
		name: 'poll',
		type: 'json',
		default: '',
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback', 'createFollowupMessage'],
			},
			hide: {
				responseType: [
					INTERACTION_CALLBACK_TYPE.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.DEFERRED_UPDATE_MESSAGE,
					INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
					INTERACTION_CALLBACK_TYPE.MODAL,
					INTERACTION_CALLBACK_TYPE.LAUNCH_ACTIVITY,
				],
			},
		},
		description: 'Raw Discord poll object JSON',
	},
	{
		displayName: 'Choices',
		name: 'choices',
		type: 'json',
		default: '[]',
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback'],
				responseType: [INTERACTION_CALLBACK_TYPE.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT],
			},
		},
		description:
			'Autocomplete choices as a JSON array. Each entry: {"name": "...", "value": ..., "name_localizations"?: {...}}.',
	},
	{
		displayName: 'Custom ID',
		name: 'customId',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback'],
				responseType: [INTERACTION_CALLBACK_TYPE.MODAL],
			},
		},
		description: 'Modal custom_id delivered with the modal submit interaction. Max 100 characters.',
	},
	{
		displayName: 'Title',
		name: 'title',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback'],
				responseType: [INTERACTION_CALLBACK_TYPE.MODAL],
			},
		},
		description: 'Modal title displayed to the user. Max 45 characters.',
	},
	createTextInputComponentField({
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback'],
				responseType: [INTERACTION_CALLBACK_TYPE.MODAL],
			},
		},
		name: 'modalTextInputs',
	}),
	createRawJsonField(
		'Modal Components',
		'modalComponents',
		'Raw JSON array of action rows containing text inputs for the modal. Appended after guided text inputs as an escape hatch.',
		'[{"type":1,"components":[{"type":4,"custom_id":"name","label":"Name","style":1}]}]',
		{
			displayOptions: {
				show: {
					resource: ['interactionResponse'],
					operation: ['createInitialCallback'],
					responseType: [INTERACTION_CALLBACK_TYPE.MODAL],
				},
			},
			default: '[]',
		},
	),
	{
		displayName: 'Payload',
		name: 'payload',
		type: 'json',
		default: '',
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: messageFollowupOps,
			},
		},
		description:
			'Optional raw Discord JSON body. Keys here OVERRIDE the guided fields above when both are supplied (escape hatch for fields not exposed in the UI).',
	},
	{
		displayName: 'Payload',
		name: 'payload',
		type: 'json',
		default: '',
		displayOptions: {
			show: {
				resource: ['interactionResponse'],
				operation: ['createInitialCallback'],
				responseType: [
					INTERACTION_CALLBACK_TYPE.CHANNEL_MESSAGE_WITH_SOURCE,
					INTERACTION_CALLBACK_TYPE.UPDATE_MESSAGE,
				],
			},
		},
		description:
			'Optional raw Discord JSON body merged into "data". Keys here OVERRIDE the guided fields above (escape hatch).',
	},
];
