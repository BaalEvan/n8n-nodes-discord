import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { loadModule } = require('./load.js');
const {
	FLOW_COMMANDS,
	FLOW_CONFIG_KEYS,
	flowDisplayName,
	flowChoices,
	flowInput,
	flowPlan,
	flowQuoted,
	flowLastStep,
	flowUploaded,
	flowFailure,
	flowFileLinks,
	flowSuccess,
	flowReplyText,
} = loadModule('invoiceFlow', ['invoice', 'driveFolder']);
const {
	replies,
	notices,
	failureNote,
	notRegisteredNote,
	ambiguousNote,
	incompleteNote,
	b2bNotice,
	zlecenieNotice,
	clientNotice,
} = loadModule('invoice');

const USER = '111111111111111111';
const CHANNEL = '1280850553357991980';
const PDF = {
	url: 'https://cdn.discordapp.com/attachments/1/2/faktura.pdf?ex=1',
	filename: 'faktura.pdf',
	size: 1000,
	content_type: 'application/pdf',
};
const ROW = {
	discordID: USER,
	fullname: 'Jan Kowalski',
	shortname: 'Jan',
	b2bentity: 'Firma IT',
	contract: 'B2B',
	email: 'jan@example.com',
};
const CONFIG = [
	{ key: 'invoiceDriveRootId', value: 'ROOT' },
	{ key: 'invoiceNotifyChannelId', value: CHANNEL },
	{ key: 'driveFolderHelperWorkflowId', value: 'helper-wf' },
];

const b2bInteraction = (options = {}, attachment = {}) => ({
	userId: USER,
	options: { invoice: '900', sell_date: '2026-08-31', hours: 160, ...options },
	resolved: { attachments: { 900: { ...PDF, ...attachment } } },
});
const b2bInput = (options, attachment) => flowInput('b2b', b2bInteraction(options, attachment));

describe('inlined together with invoice.js and driveFolder.js', () => {
	const topNames = (file) => {
		const src = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
		return [...src.matchAll(/^(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
	};
	it('declares no top-level name that the other two libs already have', () => {
		const taken = new Set([...topNames('invoice.js'), ...topNames('driveFolder.js')]);
		const clash = topNames('invoiceFlow.js').filter((n) => taken.has(n));
		expect(clash).toEqual([]);
	});
});

describe('FLOW_COMMANDS', () => {
	it('names the slash command, attachment options and date option for each command', () => {
		expect(FLOW_COMMANDS.b2b).toMatchObject({
			slash: 'invoice-b2b',
			files: ['invoice'],
			date: 'sell_date',
			hours: 'hours',
			employee: true,
		});
		expect(FLOW_COMMANDS.zlecenie).toMatchObject({
			slash: 'invoice-zlecenie',
			files: ['timesheet', 'bill'],
			date: 'month_date',
			employee: true,
		});
		expect(FLOW_COMMANDS.client).toMatchObject({
			slash: 'invoice-client',
			files: ['invoice'],
			date: 'invoice_date',
			description: 'description',
			employee: false,
		});
		expect(FLOW_CONFIG_KEYS).toEqual([
			'invoiceDriveRootId',
			'invoiceNotifyChannelId',
			'driveFolderHelperWorkflowId',
		]);
	});
});

describe('flowDisplayName', () => {
	it('uses the display name the router classified', () => {
		expect(flowDisplayName({ displayName: ' Janek ', member: { nick: 'Other' } })).toBe('Janek');
		expect(flowDisplayName({ displayName: '', member: { nick: 'Other' } })).toBe('Other');
	});
	it('prefers the server nickname, then the global name, then the username', () => {
		const user = { id: USER, username: 'jank', global_name: 'Jan K' };
		expect(flowDisplayName({ member: { nick: 'Janek', user } })).toBe('Janek');
		expect(flowDisplayName({ member: { nick: null, user } })).toBe('Jan K');
		expect(flowDisplayName({ user: { username: 'jank', global_name: '' } })).toBe('jank');
		expect(flowDisplayName({ userId: USER })).toBe('');
		expect(flowDisplayName(null)).toBe('');
	});
});

describe('flowChoices', () => {
	const NOW = Date.UTC(2026, 7, 20, 10);
	it('offers today and the two month ends, filtered by the typed prefix', () => {
		expect(flowChoices('b2b', { options: { sell_date: '' } }, NOW)).toEqual({
			choices: [
				{ name: '2026-08-20', value: '2026-08-20' },
				{ name: '2026-08-31', value: '2026-08-31' },
				{ name: '2026-07-31', value: '2026-07-31' },
			],
		});
		expect(flowChoices('b2b', { options: { sell_date: '2026-08' } }, NOW).choices).toEqual([
			{ name: '2026-08-20', value: '2026-08-20' },
			{ name: '2026-08-31', value: '2026-08-31' },
		]);
		expect(flowChoices('b2b', { options: { sell_date: ' 2026-07' } }, NOW).choices).toEqual([
			{ name: '2026-07-31', value: '2026-07-31' },
		]);
		expect(flowChoices('b2b', { options: { sell_date: '1999' } }, NOW).choices).toEqual([]);
	});
	it('reads the date option of the command', () => {
		expect(flowChoices('zlecenie', { options: { month_date: '2026-07' } }, NOW).choices).toEqual([
			{ name: '2026-07-31', value: '2026-07-31' },
		]);
		expect(flowChoices('client', {}, NOW).choices).toHaveLength(3);
	});
});

describe('flowInput', () => {
	it('returns the user, date, hours and attachments of a valid b2b command', () => {
		expect(b2bInput()).toEqual({
			ok: true,
			command: 'b2b',
			userId: USER,
			displayName: '',
			date: { year: 2026, month: 8, iso: '2026-08-31' },
			hours: 160,
			description: '',
			attachments: { invoice: PDF },
		});
	});
	it('rejects a bad or impossible date with the exact copy', () => {
		for (const d of ['31.08.2026', '2026-02-30', '2026-13-01', '', undefined]) {
			expect(b2bInput({ sell_date: d }), String(d)).toEqual({
				ok: false,
				content: '`sell_date` must be a date like 2026-08-31.',
			});
		}
	});
	it('rejects a non-PDF and a file over 20 MB with the exact copy', () => {
		expect(b2bInput({}, { content_type: 'image/png', filename: 'scan.png' })).toEqual({
			ok: false,
			content: '`invoice` must be a PDF.',
		});
		expect(b2bInput({}, { size: 20 * 1024 * 1024 + 1 })).toEqual({
			ok: false,
			content: '`invoice` is larger than 20 MB.',
		});
		expect(flowInput('b2b', { userId: USER, options: { sell_date: '2026-08-31' } })).toEqual({
			ok: false,
			content: '`invoice` must be a PDF.',
		});
	});
	it('accepts a PDF by name and a file of exactly 20 MB', () => {
		expect(b2bInput({}, { content_type: 'application/octet-stream', filename: 'F.PDF' }).ok).toBe(
			true,
		);
		expect(b2bInput({}, { size: 20 * 1024 * 1024 }).ok).toBe(true);
	});
	it('checks every attachment before the date', () => {
		expect(
			b2bInput({ sell_date: 'nope' }, { content_type: 'text/plain', filename: 'a.txt' }),
		).toEqual({ ok: false, content: '`invoice` must be a PDF.' });
		const zlecenie = (bill) =>
			flowInput('zlecenie', {
				userId: USER,
				options: { timesheet: '1', bill: '2', month_date: '2026-08-31' },
				resolved: { attachments: { 1: PDF, 2: { ...PDF, ...bill } } },
			});
		expect(zlecenie({ filename: 'bill.docx', content_type: 'application/msword' })).toEqual({
			ok: false,
			content: '`bill` must be a PDF.',
		});
		expect(Object.keys(zlecenie({}).attachments)).toEqual(['timesheet', 'bill']);
	});
	it('accepts only a year within one of the current Warsaw year', () => {
		const NOW = Date.UTC(2026, 9, 20, 10);
		const at = (d, now = NOW) => flowInput('b2b', b2bInteraction({ sell_date: d }), now);
		for (const d of ['2025-01-01', '2026-10-20', '2027-12-31']) {
			expect(at(d).ok, d).toBe(true);
			expect(at(d).date.iso, d).toBe(d);
		}
		for (const d of ['2028-01-01', '2024-12-31', '0001-01-01']) {
			expect(at(d), d).toEqual({
				ok: false,
				content: '`sell_date` must be a date like 2026-08-31.',
			});
		}
		const newYearsEve = Date.UTC(2026, 11, 31, 23, 30);
		expect(at('2028-01-01', newYearsEve).ok).toBe(true);
		expect(at('2025-12-31', newYearsEve).ok).toBe(false);
		const z = flowInput(
			'zlecenie',
			{
				userId: USER,
				options: { timesheet: '1', bill: '2', month_date: '2029-08-31' },
				resolved: { attachments: { 1: PDF, 2: PDF } },
			},
			NOW,
		);
		expect(z).toEqual({ ok: false, content: '`month_date` must be a date like 2026-08-31.' });
	});
	it('keeps the client description and the display name', () => {
		const input = flowInput('client', {
			userId: USER,
			member: { nick: 'Janek' },
			options: { invoice: '5', invoice_date: '2026-08-02', description: ' Hosting ' },
			resolved: { attachments: { 5: PDF } },
		});
		expect(input).toMatchObject({
			ok: true,
			displayName: 'Janek',
			description: 'Hosting',
			hours: null,
			date: { iso: '2026-08-02' },
		});
	});
});

describe('flowPlan', () => {
	const input = b2bInput();
	it('plans the b2b upload from the Employee row and the config', () => {
		const rows = [{ ...ROW, discordID: '999999999999999999; ' + USER }, { discordID: '5' }];
		expect(flowPlan('b2b', input, rows, [...CONFIG, { key: 'ownerId', value: '1' }])).toEqual({
			action: 'upload',
			command: 'b2b',
			slash: 'invoice-b2b',
			userId: USER,
			displayName: '',
			channelId: CHANNEL,
			rootId: 'ROOT',
			helperId: 'helper-wf',
			year: 2026,
			month: 8,
			date: '2026-08-31',
			hours: 160,
			description: '',
			row: { ...ROW, discordID: '999999999999999999; ' + USER },
			personFolder: 'B2B - Jan Kowalski - Firma IT',
			files: [
				{
					option: 'invoice',
					fileName: 'B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-IT.pdf',
					quotedName: 'B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-IT.pdf',
					url: PDF.url,
				},
			],
		});
	});
	it('stops a user with no Employee row with the reply and the note', () => {
		expect(flowPlan('b2b', input, [{}], CONFIG)).toEqual({
			action: 'stop',
			content: replies.NOT_REGISTERED,
			note: notRegisteredNote('invoice-b2b', USER),
			channelId: CHANNEL,
		});
		expect(notRegisteredNote('invoice-b2b', USER)).toBe(
			'⚠️ <@' + USER + '> tried /invoice-b2b but no Employee row has their Discord ID.',
		);
	});
	it('stops a Discord ID on two rows as ambiguous', () => {
		expect(flowPlan('b2b', input, [ROW, { ...ROW, fullname: 'Other' }], CONFIG)).toEqual({
			action: 'stop',
			content: replies.AMBIGUOUS,
			note: ambiguousNote('invoice-b2b', USER, 2),
			channelId: CHANNEL,
		});
	});
	it('stops an incomplete row and names the missing fields', () => {
		const r = flowPlan('b2b', input, [{ ...ROW, b2bentity: ' ', contract: '' }], CONFIG);
		expect(r).toEqual({
			action: 'stop',
			content: replies.INCOMPLETE,
			note: incompleteNote('invoice-b2b', USER, ['b2bentity', 'contract']),
			channelId: CHANNEL,
		});
		expect(r.note).toBe(
			'⚠️ <@' +
				USER +
				'> tried /invoice-b2b but their Employee row is missing: b2bentity, contract.',
		);
	});
	it('fails on missing config, with a note only when the channel is known', () => {
		const noHelper = CONFIG.filter((c) => c.key !== 'driveFolderHelperWorkflowId');
		expect(flowPlan('b2b', input, [ROW], noHelper)).toEqual({
			action: 'stop',
			content: replies.FAILED,
			note: failureNote(
				'invoice-b2b',
				USER,
				'config',
				'missing discord_config driveFolderHelperWorkflowId',
				false,
			),
			channelId: CHANNEL,
		});
		expect(flowPlan('b2b', input, [ROW], [{}])).toEqual({
			action: 'stop',
			content: replies.FAILED,
			note: failureNote(
				'invoice-b2b',
				USER,
				'config',
				'missing discord_config invoiceDriveRootId, invoiceNotifyChannelId, driveFolderHelperWorkflowId',
				false,
			),
			channelId: '',
		});
	});
	it('fails when the Employee table cannot be read', () => {
		expect(
			flowPlan('b2b', input, [{ error: 'Could not find data table Employee' }], CONFIG),
		).toEqual({
			action: 'stop',
			content: replies.FAILED,
			note: failureNote(
				'invoice-b2b',
				USER,
				'employee',
				'Could not find data table Employee',
				false,
			),
			channelId: CHANNEL,
		});
	});
	it('fails at step config when the discord_config table cannot be read', () => {
		const r = flowPlan(
			'b2b',
			input,
			[ROW],
			[{ error: 'Could not find data table discord_config' }],
		);
		expect(r).toEqual({
			action: 'stop',
			content: replies.FAILED,
			note: failureNote(
				'invoice-b2b',
				USER,
				'config',
				'Could not find data table discord_config',
				false,
			),
			channelId: '',
		});
		expect(r.note).not.toContain('missing');
		expect(
			flowPlan('client', input, [], [{ error: { message: 'Bad request', httpCode: 400 } }]).note,
		).toBe(failureNote('invoice-client', USER, 'config', 'Bad request', false));
	});
	it('lets a client through with no Employee row and keeps a matching row', () => {
		const client = flowInput('client', {
			userId: USER,
			member: { nick: 'Janek' },
			options: { invoice: '5', invoice_date: '2026-08-02' },
			resolved: { attachments: { 5: { ...PDF, filename: "FV 1/08 O'Neil.pdf" } } },
		});
		const none = flowPlan('client', client, [], CONFIG);
		expect(none).toMatchObject({
			action: 'upload',
			row: null,
			personFolder: 'Klienci',
			files: [
				{ option: 'invoice', fileName: "FV 1/08 O'Neil.pdf", quotedName: "FV 1/08 O\\'Neil.pdf" },
			],
		});
		expect(flowPlan('client', client, [ROW, ROW], CONFIG)).toMatchObject({
			action: 'upload',
			row: null,
		});
		expect(flowPlan('client', client, [ROW], CONFIG).row).toEqual(ROW);
	});
	it('plans both zlecenie files into one person folder', () => {
		const z = flowInput('zlecenie', {
			userId: USER,
			options: { timesheet: '1', bill: '2', month_date: '2026-08-31' },
			resolved: { attachments: { 1: PDF, 2: { ...PDF, url: 'https://cdn/bill.pdf' } } },
		});
		const plan = flowPlan('zlecenie', z, [{ ...ROW, contract: 'ZLECENIE', b2bentity: '' }], CONFIG);
		expect(plan.personFolder).toBe('ZLECENIE - Jan Kowalski');
		expect(plan.files.map((f) => [f.option, f.fileName, f.url])).toEqual([
			['timesheet', 'ZLECENIE-2026-08-31-Jan-Kowalski-TIMESHEET.pdf', PDF.url],
			['bill', 'ZLECENIE-2026-08-31-Jan-Kowalski-Bill.pdf', 'https://cdn/bill.pdf'],
		]);
	});
});

describe('flowQuoted', () => {
	it('escapes backslashes and single quotes for a Drive query', () => {
		const BS = String.fromCharCode(92);
		expect(flowQuoted("O'Neil")).toBe('O' + BS + "'Neil");
		expect(flowQuoted('a' + BS + 'b')).toBe('a' + BS + BS + 'b');
		expect(flowQuoted(BS + "'")).toBe(BS + BS + BS + "'");
		expect(flowQuoted(null)).toBe('');
	});
});

describe('flowLastStep', () => {
	it('returns the last step that ran, or an empty string', () => {
		expect(
			flowLastStep([
				['duplicate check', true],
				['download', true],
				['upload', false],
			]),
		).toBe('download');
		expect(
			flowLastStep([
				['duplicate check', false],
				['download', false],
			]),
		).toBe('');
		expect(flowLastStep([])).toBe('');
	});
});

describe('flowUploaded', () => {
	const z = flowInput('zlecenie', {
		userId: USER,
		options: { timesheet: '1', bill: '2', month_date: '2026-08-31' },
		resolved: { attachments: { 1: PDF, 2: PDF } },
	});
	const plan = flowPlan('zlecenie', z, [{ ...ROW, contract: 'ZLECENIE' }], CONFIG);
	it('names the files of the steps before the failed one', () => {
		expect(flowUploaded(plan, 'bill: upload')).toEqual([
			'ZLECENIE-2026-08-31-Jan-Kowalski-TIMESHEET.pdf',
		]);
		expect(flowUploaded(plan, 'bill: duplicate check')).toEqual([
			'ZLECENIE-2026-08-31-Jan-Kowalski-TIMESHEET.pdf',
		]);
		expect(flowUploaded(plan, 'timesheet: upload')).toEqual([]);
	});
	it('is empty for a single-file step, the folder, or no step', () => {
		expect(flowUploaded(flowPlan('b2b', b2bInput(), [ROW], CONFIG), 'upload')).toEqual([]);
		expect(flowUploaded(plan, 'year: list')).toEqual([]);
		expect(flowUploaded(plan, '')).toEqual([]);
		expect(flowUploaded(undefined, 'bill: upload')).toEqual([]);
	});
});

describe('flowFailure', () => {
	const plan = flowPlan('b2b', b2bInput(), [ROW], CONFIG);
	const stop = (step, reason, auth) => ({
		action: 'stop',
		content: replies.FAILED,
		note: failureNote('invoice-b2b', USER, step, reason, auth),
		channelId: CHANNEL,
	});
	it('passes a helper error through with its step and auth flag', () => {
		const item = {
			error: { step: 'year: list', message: 'Invalid Credentials', httpCode: 401, auth: true },
		};
		const r = flowFailure(plan, '', item);
		expect(r).toEqual(stop('year: list', 'Invalid Credentials (HTTP 401)', true));
		expect(r.note).toBe(
			'⚠️ Invoice upload failed: /invoice-b2b by <@' +
				USER +
				'> at step `year: list`: Invalid Credentials (HTTP 401)\n' +
				'Google Drive login has expired or was revoked — reconnect the `Google Drive account` credential in n8n.',
		);
		expect(
			flowFailure(plan, '', {
				error: { step: 'month: rename', message: 'Boom', httpCode: 500, auth: false },
			}),
		).toEqual(stop('month: rename', 'Boom (HTTP 500)', false));
	});
	it('reports a failed helper call or a missing folder id under folder', () => {
		expect(flowFailure(plan, '', { error: 'Workflow does not exist.' })).toEqual(
			stop('folder: call', 'Workflow does not exist.', false),
		);
		expect(flowFailure(plan, '', {})).toEqual(stop('folder: call', 'no folder id returned', false));
	});
	it("treats n8n's 401 and 403 messages on a Drive step as an expired login", () => {
		expect(
			flowFailure(plan, 'upload', {
				error: 'Authorization failed - please check your credentials',
			}),
		).toEqual(
			stop('upload', 'Authorization failed - please check your credentials (HTTP 401)', true),
		);
		expect(
			flowFailure(plan, 'duplicate check', {
				error: { message: 'Forbidden - perhaps check your credentials?' },
			}),
		).toEqual(
			stop('duplicate check', 'Forbidden - perhaps check your credentials? (HTTP 403)', true),
		);
		expect(
			flowFailure(plan, 'upload', { error: { httpCode: '401', message: 'Request failed' } }),
		).toEqual(stop('upload', 'Request failed (HTTP 401)', true));
		expect(flowFailure(plan, 'upload', { error: 'invalid_grant' })).toEqual(
			stop('upload', 'invalid_grant', true),
		);
	});
	describe('a Google OAuth refresh failure is an expired login', () => {
		const GRANT =
			'The provided authorization grant (e.g., authorization code, resource owner credentials) or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.';
		const texts = [
			GRANT,
			'invalid_grant',
			'Token has been expired or revoked.',
			'invalid_token',
			'Error: Authorization grant is invalid',
		];
		for (const t of texts) {
			it('in the message: ' + t.slice(0, 40), () => {
				expect(flowFailure(plan, 'upload', { error: { message: t } }).note).toBe(
					failureNote('invoice-b2b', USER, 'upload', t, true),
				);
				expect(flowFailure(plan, 'duplicate check', { error: t }).note).toContain(
					'\n' + notices.DRIVE_AUTH_HINT,
				);
			});
			it('in the description: ' + t.slice(0, 40), () => {
				const r = flowFailure(plan, 'upload', {
					error: { message: 'Request failed', description: t },
				});
				expect(r).toEqual(stop('upload', t, true));
			});
		}
		it('in a nested cause', () => {
			const r = flowFailure(plan, 'upload', {
				error: { message: 'Request failed', cause: { error: { error: 'invalid_grant' } } },
			});
			expect(r).toEqual(stop('upload', 'Request failed', true));
		});
		it('from the folder helper even when it did not flag auth', () => {
			const r = flowFailure(plan, '', {
				error: { step: 'year: list', message: GRANT, httpCode: 400, auth: false },
			});
			expect(r).toEqual(stop('year: list', GRANT + ' (HTTP 400)', true));
		});
		it('but never on the Discord download', () => {
			expect(flowFailure(plan, 'download', { error: 'invalid_grant' })).toEqual(
				stop('download', 'invalid_grant', false),
			);
		});
	});
	it('keeps other Drive errors without the auth line', () => {
		expect(
			flowFailure(plan, 'upload', {
				error: { message: 'Request failed with status code 500', description: 'Backend Error' },
			}),
		).toEqual(stop('upload', 'Backend Error (HTTP 500)', false));
	});
	it('never calls a Discord download error a Drive login problem', () => {
		expect(
			flowFailure(plan, 'download', { error: 'Forbidden - perhaps check your credentials?' }),
		).toEqual(stop('download', 'Forbidden - perhaps check your credentials? (HTTP 403)', false));
	});
	it('never calls a per-file download error a Drive login problem', () => {
		expect(flowFailure(plan, 'bill: download', { error: 'invalid_grant' }).note).toBe(
			failureNote('invoice-b2b', USER, 'bill: download', 'invalid_grant', false),
		);
		expect(flowFailure(plan, 'bill: upload', { error: 'invalid_grant' }).note).toBe(
			failureNote('invoice-b2b', USER, 'bill: upload', 'invalid_grant', true),
		);
	});
	it('names the files already uploaded', () => {
		expect(flowFailure(plan, 'upload', { error: 'Boom' }, ['a.pdf', 'b.pdf'])).toEqual(
			stop('upload', 'Boom; already uploaded: `a.pdf`, `b.pdf`', false),
		);
	});
});

describe('flowFileLinks', () => {
	it('uses the links Drive returned', () => {
		expect(flowFileLinks({ id: 'F', webViewLink: 'view', webContentLink: 'get' })).toEqual({
			id: 'F',
			webViewLink: 'view',
			webContentLink: 'get',
		});
	});
	it('builds the standard links from the file id when Drive returned none', () => {
		expect(flowFileLinks({ id: 'F1' })).toEqual({
			id: 'F1',
			webViewLink: 'https://drive.google.com/file/d/F1/view?usp=drivesdk',
			webContentLink: 'https://drive.google.com/uc?id=F1&export=download',
		});
		expect(flowFileLinks(null)).toEqual({ id: '', webViewLink: '', webContentLink: '' });
	});
});

describe('flowSuccess', () => {
	const FOLDER = { folderId: 'F', path: '2026/08 - Sierpień/B2B - Jan Kowalski - Firma IT' };
	const UPLOAD = { id: 'X', webViewLink: 'https://view/X', webContentLink: 'https://get/X' };
	it('builds the b2b reply and notice for Jan, 160 hours, 2026-08-31', () => {
		const plan = flowPlan('b2b', b2bInput(), [ROW], CONFIG);
		const r = flowSuccess(plan, FOLDER, [UPLOAD], [{ files: [] }]);
		expect(r).toEqual({
			content:
				'Uploaded `B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-IT.pdf` to `2026/08 - Sierpień/B2B - Jan Kowalski - Firma IT`.',
			notice:
				'Cześć Dziadu, ten zjeb **Jan** wysłał fakture **(160 godzin)** za `sierpień` `2026`\n -> [Pobierz Dziadu](https://get/X)\n -> [Zobacz Dziadu](https://view/X)',
			channelId: CHANNEL,
		});
		expect(r.notice).toBe(
			b2bNotice({
				shortname: 'Jan',
				hours: 160,
				month: 8,
				year: 2026,
				webContentLink: 'https://get/X',
				webViewLink: 'https://view/X',
			}),
		);
	});
	it('adds the duplicate line when a same-named file was already there', () => {
		const plan = flowPlan('b2b', b2bInput(), [ROW], CONFIG);
		const r = flowSuccess(plan, FOLDER, [UPLOAD], [{ files: [{ id: 'OLD' }] }]);
		expect(r.content.split('\n')).toEqual([
			'Uploaded `B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-IT.pdf` to `2026/08 - Sierpień/B2B - Jan Kowalski - Firma IT`.',
			'A file named `B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-IT.pdf` was already there; both are kept.',
		]);
	});
	it('flags a same-named b2b file in the notice too', () => {
		const plan = flowPlan('b2b', b2bInput(), [ROW], CONFIG);
		const plain = flowSuccess(plan, FOLDER, [UPLOAD], [{ files: [] }]).notice;
		const r = flowSuccess(plan, FOLDER, [UPLOAD], [{ files: [{ id: 'OLD' }] }]);
		expect(r.notice).toBe(
			plain +
				'\n⚠️ A file named `B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-IT.pdf` was already in that folder; both are kept.',
		);
		expect(flowSuccess(plan, FOLDER, [UPLOAD], []).notice).toBe(plain);
	});
	it('flags only the zlecenie file that was already there in the notice', () => {
		const z = flowInput('zlecenie', {
			userId: USER,
			options: { timesheet: '1', bill: '2', month_date: '2026-08-31' },
			resolved: { attachments: { 1: PDF, 2: PDF } },
		});
		const plan = flowPlan('zlecenie', z, [{ ...ROW, contract: 'ZLECENIE' }], CONFIG);
		const uploads = [{ id: 'T' }, { id: 'B' }];
		const plain = flowSuccess(plan, FOLDER, uploads, [{ files: [] }, { files: [] }]).notice;
		const r = flowSuccess(plan, FOLDER, uploads, [{ files: [] }, { files: [{ id: 'OLD' }] }]);
		expect(r.notice.split('\n')).toEqual([
			...plain.split('\n'),
			'⚠️ A file named `ZLECENIE-2026-08-31-Jan-Kowalski-Bill.pdf` was already in that folder; both are kept.',
		]);
	});
	it('falls back to the full name when shortname is empty', () => {
		const plan = flowPlan('b2b', b2bInput(), [{ ...ROW, shortname: '' }], CONFIG);
		expect(flowSuccess(plan, FOLDER, [UPLOAD], []).notice).toContain('**Jan Kowalski**');
	});
	it('builds the zlecenie notice from both view links', () => {
		const z = flowInput('zlecenie', {
			userId: USER,
			options: { timesheet: '1', bill: '2', month_date: '2026-08-31' },
			resolved: { attachments: { 1: PDF, 2: PDF } },
		});
		const plan = flowPlan('zlecenie', z, [{ ...ROW, contract: 'ZLECENIE' }], CONFIG);
		const r = flowSuccess(
			plan,
			FOLDER,
			[{ id: 'T' }, { id: 'B', webViewLink: 'https://view/B' }],
			[],
		);
		expect(r.notice).toBe(
			zlecenieNotice({
				shortname: 'Jan',
				month: 8,
				year: 2026,
				timesheetLink: 'https://drive.google.com/file/d/T/view?usp=drivesdk',
				billLink: 'https://view/B',
			}),
		);
		expect(r.content.split('\n')).toHaveLength(2);
	});
	it('names the client uploader by shortname, else by Discord display name', () => {
		const client = flowInput('client', {
			userId: USER,
			member: { nick: 'Janek' },
			options: { invoice: '5', invoice_date: '2026-08-02', description: 'Hosting' },
			resolved: { attachments: { 5: { ...PDF, filename: 'FV-1.pdf' } } },
		});
		const notice = (rows) =>
			flowSuccess(flowPlan('client', client, rows, CONFIG), FOLDER, [UPLOAD], []).notice;
		const expected = (uploader) =>
			clientNotice({
				fileName: 'FV-1.pdf',
				month: 8,
				year: 2026,
				description: 'Hosting',
				webContentLink: 'https://get/X',
				webViewLink: 'https://view/X',
				uploader,
			});
		expect(notice([ROW])).toBe(expected('Jan'));
		expect(notice([])).toBe(expected('Janek'));
		expect(notice([{ ...ROW, shortname: '' }])).toBe(expected('Jan Kowalski'));
		const plan = flowPlan('client', { ...client, displayName: '' }, [], CONFIG);
		expect(flowSuccess(plan, FOLDER, [UPLOAD], []).notice).toBe(expected('<@' + USER + '>'));
		expect(notice([])).toContain(' (wrzucił: Janek)\n`FV-1.pdf` za `sierpień` `2026`');
	});
});

describe('flowReplyText', () => {
	const UNTOLD =
		"Something went wrong saving your file, and the board couldn't be told automatically; please let them know.";
	const POSTED = { id: '1290000000000000000', channel_id: CHANNEL };
	const failure = { action: 'stop', content: replies.FAILED, note: 'n', channelId: CHANNEL };
	it('keeps the failure reply only when the note was posted', () => {
		expect(flowReplyText(failure, POSTED)).toBe(replies.FAILED);
		expect(flowReplyText(failure, null)).toBe(UNTOLD);
		expect(flowReplyText(failure, { error: 'Missing Access' })).toBe(UNTOLD);
		expect(flowReplyText(failure, { error: { message: 'Missing Access' }, id: 'x' })).toBe(UNTOLD);
		expect(flowReplyText(failure, {})).toBe(UNTOLD);
	});
	it('keeps the gate replies whether or not their note was posted', () => {
		for (const content of [replies.NOT_REGISTERED, replies.AMBIGUOUS, replies.INCOMPLETE]) {
			const stop = { action: 'stop', content, note: 'n', channelId: CHANNEL };
			expect(flowReplyText(stop, POSTED)).toBe(content);
			expect(flowReplyText(stop, null)).toBe(content);
			expect(flowReplyText(stop, { error: 'Missing Access' })).toBe(content);
		}
	});
	it('adds a line to the success reply when the notice was not posted', () => {
		const done = {
			content: 'Uploaded `a.pdf` to `2026/08 - Sierpień/X`.',
			notice: 'n',
			channelId: CHANNEL,
		};
		expect(flowReplyText(done, POSTED)).toBe(done.content);
		expect(flowReplyText(done, { error: 'Missing Access' })).toBe(
			done.content + "\nThe board couldn't be notified automatically; please let them know.",
		);
		expect(flowReplyText(done, null)).toBe(
			done.content + "\nThe board couldn't be notified automatically; please let them know.",
		);
	});
});
