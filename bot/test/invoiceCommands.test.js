import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildAll } from '../build-workflows.mjs';
const path = require('path');
const { loadModule } = require('./load.js');
const { simulate } = require('./simulate.js');
const { parseDefinition } = loadModule('definition');
const { replies, notices, failureNote, notRegisteredNote, ambiguousNote, incompleteNote } =
	loadModule('invoice');

const built = buildAll(path.join(__dirname, '..'));

const node = (wf, name) => {
	const n = wf.nodes.find((x) => x.name === name);
	if (!n) throw new Error('no node ' + name + ' in ' + wf.name);
	return n;
};
const targets = (wf, from, output = 0) =>
	((wf.connections[from] && wf.connections[from].main[output]) || []).map((c) => c.node);
const reachable = (wf, from) => {
	const seen = new Set();
	const walk = (name) => {
		for (const out of (wf.connections[name] && wf.connections[name].main) || []) {
			for (const c of out || []) {
				if (!seen.has(c.node)) {
					seen.add(c.node);
					walk(c.node);
				}
			}
		}
	};
	walk(from);
	return seen;
};

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
	{ key: 'ownerId', value: '1' },
	{ key: 'invoiceDriveRootId', value: 'ROOT' },
	{ key: 'invoiceNotifyChannelId', value: CHANNEL },
	{ key: 'driveFolderHelperWorkflowId', value: 'helper-wf' },
];
const FILE = 'B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-IT.pdf';
const PERSON = 'B2B - Jan Kowalski - Firma IT';
const FOLDER = {
	folderId: 'FOLDER1',
	path: '2026/08 - Sierpień/' + PERSON,
	created: [],
	renamed: [],
};
const UPLOADED = {
	id: 'FILE1',
	name: FILE,
	webViewLink: 'https://drive.google.com/file/d/FILE1/view?usp=drivesdk',
	webContentLink: 'https://drive.google.com/uc?id=FILE1&export=download',
};
const PDF_BYTES = { data: 'JVBERi0=', mimeType: 'application/pdf', fileName: 'faktura.pdf' };
const AUTH_LINE = notices.DRIVE_AUTH_HINT;
const UNTOLD =
	"Something went wrong saving your file, and the board couldn't be told automatically; please let them know.";
const UNSENT = "\nThe board couldn't be notified automatically; please let them know.";
const DUP_LINE = (name) =>
	'⚠️ A file named `' + name + '` was already in that folder; both are kept.';

const interaction = (options = {}, attachment = {}) => ({
	kind: 'command',
	commandName: 'invoice-b2b',
	userId: USER,
	guildId: '1280482154249457685',
	options: { invoice: '900', sell_date: '2026-08-31', hours: 160, ...options },
	resolved: { attachments: { 900: { ...PDF, ...attachment } } },
});

const helperStub = (output) => {
	const trigger = node(built['helpers/drive-folder'], 'When called by another workflow');
	return {
		id: 'helper-wf',
		name: 'Discord Helper: Drive Folder (stub)',
		nodes: [
			trigger,
			{
				name: 'Out',
				type: 'n8n-nodes-base.code',
				parameters: {
					jsCode:
						output === null ? 'return [];' : 'return [{ json: ' + JSON.stringify(output) + ' }];',
				},
			},
		],
		connections: { [trigger.name]: { main: [[{ node: 'Out', type: 'main', index: 0 }]] } },
	};
};

const okHttp = (req) => {
	if (req.node === 'Check Duplicate') return { json: { files: [] } };
	if (req.node === 'Download') return { binary: PDF_BYTES };
	throw new Error('unexpected http ' + req.node);
};

function run(wf, opts = {}) {
	const {
		input = interaction(),
		employees = [ROW],
		config = CONFIG,
		folder = FOLDER,
		http = okHttp,
		drive = () => ({ json: UPLOADED }),
		discordError,
		tableErrors,
		workflows,
	} = opts;
	const calls = { http: [], drive: [] };
	const r = simulate(
		wf,
		{ mode: opts.mode || 'command', interaction: input },
		{
			tables: {
				Employee: employees.map((x) => ({ ...x })),
				discord_config: config.map((x) => ({ ...x })),
			},
			workflows: workflows || { 'helper-wf': helperStub(folder) },
			http: (req) => {
				calls.http.push(req);
				return http(req);
			},
			drive: (req) => {
				calls.drive.push(req);
				return drive(req);
			},
			discordError,
			tableErrors,
		},
	);
	return {
		order: r.order,
		reply: r.items[0] && r.items[0].json,
		messages: r.env.messages.map((m) => ({ channelId: m.channelId, content: m.content })),
		subCalls: r.env.subCalls,
		stop: r.data.has('Stop') ? r.data.get('Stop')[0][0].json : undefined,
		tables: r.env.tables,
		calls,
	};
}

describe('/invoice-b2b', () => {
	const wf = built['commands/invoice-b2b'];

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('definition and structure', () => {
		it('is a tagged discord-command with the exact definition', () => {
			expect(wf.name).toBe('Discord Command: invoice-b2b');
			expect(wf.tags.map((t) => t.name)).toEqual(['discord-command']);
			const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
			expect(parsed.ok).toBe(true);
			expect(parsed.definition).toEqual({
				name: 'invoice-b2b',
				description: 'Upload your B2B invoice',
				guilds: ['1280482154249457685'],
				ephemeral: true,
				whitelist: { users: [], roles: ['1561960951756886056'] },
				options: [
					{ type: 11, name: 'invoice', description: 'Your invoice (PDF)', required: true },
					{
						type: 3,
						name: 'sell_date',
						description: 'Sell date on the invoice (YYYY-MM-DD)',
						required: true,
						autocomplete: true,
					},
					{
						type: 10,
						name: 'hours',
						description: 'Hours on the invoice',
						required: true,
						min_value: 0.25,
					},
				],
			});
		});

		it('wires command mode through validation, the gate, the folder, the duplicate check, download and upload', () => {
			expect(targets(wf, 'When called by another workflow')).toEqual(['Command Definition']);
			expect(targets(wf, 'Command Definition')).toEqual(['Switch on mode']);
			expect(targets(wf, 'Switch on mode', 0)).toEqual(['Validate']);
			expect(targets(wf, 'Switch on mode', 1)).toEqual(['Suggest Dates']);
			expect(targets(wf, 'Validate')).toEqual(['Valid?']);
			expect(targets(wf, 'Valid?', 0)).toEqual(['Load Employees']);
			expect(targets(wf, 'Valid?', 1)).toEqual(['Reply Invalid']);
			expect(targets(wf, 'Load Employees')).toEqual(['Load Config']);
			expect(targets(wf, 'Load Config')).toEqual(['Plan']);
			expect(targets(wf, 'Plan')).toEqual(['Go?']);
			expect(targets(wf, 'Go?', 0)).toEqual(['Find Folder']);
			expect(targets(wf, 'Go?', 1)).toEqual(['Stop']);
			expect(targets(wf, 'Find Folder')).toEqual(['Folder OK?']);
			expect(targets(wf, 'Folder OK?', 0)).toEqual(['Check Duplicate']);
			expect(targets(wf, 'Folder OK?', 1)).toEqual(['Failure']);
			expect(targets(wf, 'Check Duplicate', 0)).toEqual(['Download']);
			expect(targets(wf, 'Download', 0)).toEqual(['Upload']);
			expect(targets(wf, 'Upload', 0)).toEqual(['Done']);
			expect(targets(wf, 'Done')).toEqual(['Post Notice']);
			expect(targets(wf, 'Post Notice')).toEqual(['Reply Success']);
			expect(targets(wf, 'Failure')).toEqual(['Stop']);
			expect(targets(wf, 'Stop')).toEqual(['Notify?']);
			expect(targets(wf, 'Notify?', 0)).toEqual(['Post Note']);
			expect(targets(wf, 'Notify?', 1)).toEqual(['Reply']);
			expect(targets(wf, 'Post Note')).toEqual(['Reply']);
		});

		it('validation errors reply without reaching the lookups, Drive or Discord', () => {
			expect([...reachable(wf, 'Reply Invalid')]).toEqual([]);
			const afterValidate = reachable(wf, 'Validate');
			expect(afterValidate.has('Download')).toBe(true);
			const invalidOnly = new Set(targets(wf, 'Valid?', 1));
			for (const n of invalidOnly) expect(reachable(wf, n).has('Download')).toBe(false);
		});

		it('sends every Drive and HTTP error output to the one failure branch', () => {
			const io = wf.nodes.filter(
				(n) => n.type === 'n8n-nodes-base.httpRequest' || n.type === 'n8n-nodes-base.googleDrive',
			);
			expect(io.map((n) => n.name).sort()).toEqual(['Check Duplicate', 'Download', 'Upload']);
			for (const n of io) {
				expect(n.onError, n.name).toBe('continueErrorOutput');
				expect(targets(wf, n.name, 1), n.name).toEqual(['Failure']);
			}
			const posts = wf.nodes.filter((n) => n.type === 'CUSTOM.discord');
			expect(posts.map((n) => n.name).sort()).toEqual(['Post Note', 'Post Notice']);
			for (const n of posts) {
				expect(n.onError, n.name).toBe('continueRegularOutput');
				expect(n.parameters).toMatchObject({
					authentication: 'bot',
					resource: 'message',
					operation: 'send',
				});
				expect(n.parameters.allowedMentions.values.parse).toEqual([]);
			}
			expect(node(wf, 'Post Note').parameters.channelId).toBe('={{ $json.channelId }}');
			expect(node(wf, 'Post Note').parameters.content).toBe('={{ $json.note }}');
			expect(node(wf, 'Post Notice').parameters.channelId).toBe('={{ $json.channelId }}');
			expect(node(wf, 'Post Notice').parameters.content).toBe('={{ $json.notice }}');
			expect(node(wf, 'Find Folder').onError).toBe('continueRegularOutput');
			expect(node(wf, 'Find Folder').alwaysOutputData).toBe(true);
			expect(node(wf, 'Load Employees').onError).toBe('continueRegularOutput');
			expect(node(wf, 'Load Config').onError).toBe('continueRegularOutput');
		});

		it('reads all Employee rows and the three config rows once each', () => {
			const emp = node(wf, 'Load Employees');
			expect(emp.parameters).toMatchObject({
				resource: 'row',
				operation: 'get',
				dataTableId: { __rl: true, mode: 'name', value: 'Employee' },
				returnAll: true,
			});
			expect(emp.parameters.filters).toBeUndefined();
			expect(emp.alwaysOutputData).toBe(true);
			expect(emp.executeOnce).toBe(true);
			const cfg = node(wf, 'Load Config');
			expect(cfg.parameters).toMatchObject({
				resource: 'row',
				operation: 'get',
				dataTableId: { __rl: true, mode: 'name', value: 'discord_config' },
				matchType: 'anyCondition',
				returnAll: true,
			});
			expect(
				cfg.parameters.filters.conditions.map((c) => [c.keyName, c.condition, c.keyValue]),
			).toEqual([
				['key', 'eq', 'invoiceDriveRootId'],
				['key', 'eq', 'invoiceNotifyChannelId'],
				['key', 'eq', 'driveFolderHelperWorkflowId'],
			]);
			expect(cfg.alwaysOutputData).toBe(true);
			expect(cfg.executeOnce).toBe(true);
		});

		it('calls the folder helper by its config id with only the four top-level inputs', () => {
			const f = node(wf, 'Find Folder');
			expect(f.type).toBe('n8n-nodes-base.executeWorkflow');
			expect(f.parameters.workflowId).toEqual({
				__rl: true,
				mode: 'id',
				value: "={{ $('Plan').first().json.helperId }}",
			});
			expect(f.parameters.options.waitForSubWorkflow).toBe(true);
			expect(Object.keys(f.parameters.workflowInputs.value)).toEqual([
				'rootId',
				'year',
				'month',
				'personFolderName',
			]);
			expect(f.parameters.workflowInputs.schema.map((s) => s.id)).toEqual([
				'rootId',
				'year',
				'month',
				'personFolderName',
			]);
		});

		it('checks for a same-named file with an escaped Drive query and the Drive credential', () => {
			const c = node(wf, 'Check Duplicate');
			expect(c.parameters).toMatchObject({
				method: 'GET',
				url: 'https://www.googleapis.com/drive/v3/files',
				authentication: 'predefinedCredentialType',
				nodeCredentialType: 'googleDriveOAuth2Api',
				sendQuery: true,
				specifyQuery: 'keypair',
			});
			expect(c.parameters.queryParameters.parameters).toEqual([
				{
					name: 'q',
					value:
						"='{{ $('Find Folder').first().json.folderId }}' in parents and name='{{ $('Plan').first().json.files[0].quotedName }}' and trashed=false",
				},
				{ name: 'supportsAllDrives', value: 'true' },
				{ name: 'includeItemsFromAllDrives', value: 'true' },
				{ name: 'fields', value: 'files(id)' },
			]);
			expect(c.credentials).toEqual({ googleDriveOAuth2Api: { name: 'Google Drive account' } });
		});

		it('downloads the attachment as a file with no credential', () => {
			const d = node(wf, 'Download');
			expect(d.parameters).toMatchObject({
				method: 'GET',
				url: "={{ $('Plan').first().json.files[0].url }}",
				authentication: 'none',
			});
			expect(d.parameters.options.response.response).toEqual({
				responseFormat: 'file',
				outputPropertyName: 'invoice',
			});
			expect(d.credentials).toBeUndefined();
		});

		it('uploads with the Google Drive v3 node into the resolved folder', () => {
			const u = node(wf, 'Upload');
			expect(u.type).toBe('n8n-nodes-base.googleDrive');
			expect(u.typeVersion).toBe(3);
			expect(u.parameters).toEqual({
				inputDataFieldName: 'invoice',
				name: "={{ $('Plan').first().json.files[0].fileName }}",
				driveId: { __rl: true, mode: 'list', value: 'My Drive' },
				folderId: {
					__rl: true,
					value: "={{ $('Find Folder').first().json.folderId }}",
					mode: 'id',
				},
				options: {},
			});
			expect(u.credentials).toEqual({ googleDriveOAuth2Api: { name: 'Google Drive account' } });
		});

		it('keeps the Code nodes thin and inlines the three libs', () => {
			const code = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
			expect(code.map((n) => n.name).sort()).toEqual(
				[
					'Done',
					'Failure',
					'Plan',
					'Reply',
					'Reply Success',
					'Stop',
					'Suggest Dates',
					'Validate',
				].sort(),
			);
			const template = require('../workflows/commands/invoice-b2b.template.json');
			for (const n of template.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
				if (n.name === 'Stop') continue;
				expect(n.parameters.jsCode.split('\n')[0], n.name).toBe(
					'//@inline lib/invoice.js lib/driveFolder.js lib/invoiceFlow.js',
				);
				expect(n.parameters.jsCode.split('\n').length, n.name).toBeLessThanOrEqual(8);
			}
			for (const n of code) expect(n.parameters.jsCode, n.name).not.toMatch(/\bthrow\b/);
		});

		it('replies through the lib, checking whether the board post went out', () => {
			for (const [reply, from, post] of [
				['Reply', 'Stop', 'Post Note'],
				['Reply Success', 'Done', 'Post Notice'],
			]) {
				const code = node(wf, reply).parameters.jsCode;
				expect(code, reply).toContain("const post = $('" + post + "');");
				expect(code, reply).toContain(
					"flowReplyText($('" +
						from +
						"').first().json, post.isExecuted ? post.first().json : null)",
				);
			}
		});
	});

	describe('autocomplete', () => {
		it('returns the date suggestions that match what was typed', () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date(Date.UTC(2026, 7, 20, 10)));
			const r = run(wf, {
				mode: 'autocomplete',
				input: {
					...interaction({ sell_date: '2026-08' }),
					kind: 'autocomplete',
					focused: 'sell_date',
				},
			});
			expect(r.reply).toEqual({
				choices: [
					{ name: '2026-08-20', value: '2026-08-20' },
					{ name: '2026-08-31', value: '2026-08-31' },
				],
			});
			const all = run(wf, {
				mode: 'autocomplete',
				input: { ...interaction({ sell_date: '' }), kind: 'autocomplete' },
			});
			expect(all.reply.choices.map((c) => c.value)).toEqual([
				'2026-08-20',
				'2026-08-31',
				'2026-07-31',
			]);
			expect(all.order).not.toContain('Load Employees');
		});
	});

	describe('validation', () => {
		const cases = [
			[
				'a bad date',
				interaction({ sell_date: '31.08.2026' }),
				'`sell_date` must be a date like 2026-08-31.',
			],
			[
				'an impossible date',
				interaction({ sell_date: '2026-02-30' }),
				'`sell_date` must be a date like 2026-08-31.',
			],
			[
				'a non-PDF',
				interaction({}, { content_type: 'image/png', filename: 'scan.png' }),
				'`invoice` must be a PDF.',
			],
			[
				'an oversize file',
				interaction({}, { size: 20 * 1024 * 1024 + 1 }),
				'`invoice` is larger than 20 MB.',
			],
		];
		for (const [label, input, copy] of cases) {
			it(label + ' replies with the exact copy and nothing else runs', () => {
				const r = run(wf, { input });
				expect(r.reply).toEqual({ content: copy });
				expect(r.order).not.toContain('Load Employees');
				expect(r.order).not.toContain('Download');
				expect(r.calls.http).toEqual([]);
				expect(r.calls.drive).toEqual([]);
				expect(r.messages).toEqual([]);
				expect(r.subCalls).toEqual([]);
			});
		}
	});

	describe('employee gate', () => {
		it('not registered: the reply and the boss-office note', () => {
			const r = run(wf, { employees: [{ ...ROW, discordID: '222222222222222222' }] });
			expect(r.reply).toEqual({ content: replies.NOT_REGISTERED });
			expect(r.reply.content).toBe("You're not registered for invoice uploads yet; ask the board.");
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: notRegisteredNote('invoice-b2b', USER) },
			]);
			expect(r.subCalls).toEqual([]);
			expect(r.calls.http).toEqual([]);
		});

		it('not registered on an empty Employee table', () => {
			const r = run(wf, { employees: [] });
			expect(r.reply).toEqual({ content: replies.NOT_REGISTERED });
			expect(r.messages).toHaveLength(1);
		});

		it('ambiguous: the reply and the note with the row count', () => {
			const r = run(wf, {
				employees: [ROW, { ...ROW, fullname: 'Jan Nowak', discordID: 'x, ' + USER }],
			});
			expect(r.reply).toEqual({ content: replies.AMBIGUOUS });
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: ambiguousNote('invoice-b2b', USER, 2) },
			]);
			expect(r.messages[0].content).toBe(
				'⚠️ <@' + USER + '> tried /invoice-b2b but their Discord ID is on 2 Employee rows.',
			);
			expect(r.subCalls).toEqual([]);
		});

		it('a row with two Discord IDs still matches', () => {
			const r = run(wf, { employees: [{ ...ROW, discordID: '333333333333333333;' + USER }] });
			expect(r.reply.content).toBe('Uploaded `' + FILE + '` to `' + FOLDER.path + '`.');
		});

		it('incomplete: the reply and the note naming the missing fields', () => {
			const r = run(wf, { employees: [{ ...ROW, b2bentity: '' }] });
			expect(r.reply).toEqual({ content: replies.INCOMPLETE });
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: incompleteNote('invoice-b2b', USER, ['b2bentity']) },
			]);
			expect(r.subCalls).toEqual([]);
		});

		it('an unreadable Employee table fails with a note', () => {
			const r = run(wf, { tableErrors: { Employee: 'Could not find data table' } });
			expect(r.reply).toEqual({ content: replies.FAILED });
			expect(r.messages).toEqual([
				{
					channelId: CHANNEL,
					content: failureNote('invoice-b2b', USER, 'employee', 'Could not find data table', false),
				},
			]);
		});
	});

	describe('config', () => {
		it('a missing config row fails with a config note', () => {
			const r = run(wf, { config: CONFIG.filter((c) => c.key !== 'invoiceDriveRootId') });
			expect(r.reply).toEqual({ content: replies.FAILED });
			expect(r.messages).toEqual([
				{
					channelId: CHANNEL,
					content: failureNote(
						'invoice-b2b',
						USER,
						'config',
						'missing discord_config invoiceDriveRootId',
						false,
					),
				},
			]);
			expect(r.subCalls).toEqual([]);
		});

		it('an unreadable discord_config table fails at step config, not as missing keys', () => {
			const r = run(wf, { tableErrors: { discord_config: 'Could not find data table' } });
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.stop.note).toBe(
				failureNote('invoice-b2b', USER, 'config', 'Could not find data table', false),
			);
			expect(r.messages).toEqual([]);
			expect(r.subCalls).toEqual([]);
			expect(r.calls.http).toEqual([]);
		});

		it('with no channel configured the user is told the board was not told', () => {
			const r = run(wf, { config: CONFIG.filter((c) => c.key !== 'invoiceNotifyChannelId') });
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.messages).toEqual([]);
		});
	});

	describe('upload', () => {
		it('saves the file and posts the notice for Jan, 160 hours, 2026-08-31', () => {
			const r = run(wf);
			expect(r.reply).toEqual({
				content:
					'Uploaded `B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-IT.pdf` to `2026/08 - Sierpień/B2B - Jan Kowalski - Firma IT`.',
			});
			expect(r.messages).toEqual([
				{
					channelId: CHANNEL,
					content:
						'Cześć Dziadu, ten zjeb **Jan** wysłał fakture **(160 godzin)** za `sierpień` `2026`\n -> [Pobierz Dziadu](https://drive.google.com/uc?id=FILE1&export=download)\n -> [Zobacz Dziadu](https://drive.google.com/file/d/FILE1/view?usp=drivesdk)',
				},
			]);
			expect(r.subCalls).toEqual([
				{
					node: 'Find Folder',
					workflowId: 'helper-wf',
					input: { rootId: 'ROOT', year: 2026, month: 8, personFolderName: PERSON },
				},
			]);
			expect(r.calls.http.map((h) => h.node)).toEqual(['Check Duplicate', 'Download']);
			expect(r.calls.http[0].query).toEqual({
				q: "'FOLDER1' in parents and name='" + FILE + "' and trashed=false",
				supportsAllDrives: 'true',
				includeItemsFromAllDrives: 'true',
				fields: 'files(id)',
			});
			expect(r.calls.http[1]).toMatchObject({ method: 'GET', url: PDF.url });
			expect(r.calls.drive).toEqual([
				{
					node: 'Upload',
					resource: 'file',
					operation: 'upload',
					name: FILE,
					folderId: 'FOLDER1',
					driveId: 'My Drive',
					binary: PDF_BYTES,
				},
			]);
			expect(r.order.slice(-3)).toEqual(['Done', 'Post Notice', 'Reply Success']);
		});

		it('builds the links from the file id when the upload returns only the id', () => {
			const r = run(wf, { drive: () => ({ json: { id: 'ONLYID' } }) });
			expect(r.messages[0].content).toContain(
				'[Pobierz Dziadu](https://drive.google.com/uc?id=ONLYID&export=download)',
			);
			expect(r.messages[0].content).toContain(
				'[Zobacz Dziadu](https://drive.google.com/file/d/ONLYID/view?usp=drivesdk)',
			);
		});

		it('uploads anyway when a same-named file exists and says both are kept', () => {
			const r = run(wf, {
				http: (req) =>
					req.node === 'Check Duplicate' ? { json: { files: [{ id: 'OLD' }] } } : okHttp(req),
			});
			expect(r.calls.drive).toHaveLength(1);
			expect(r.reply.content).toBe(
				'Uploaded `' +
					FILE +
					'` to `' +
					FOLDER.path +
					'`.\nA file named `' +
					FILE +
					'` was already there; both are kept.',
			);
			const lines = r.messages[0].content.split('\n');
			expect(lines).toHaveLength(4);
			expect(lines.slice(0, 3).join('\n')).toBe(
				'Cześć Dziadu, ten zjeb **Jan** wysłał fakture **(160 godzin)** za `sierpień` `2026`\n -> [Pobierz Dziadu](https://drive.google.com/uc?id=FILE1&export=download)\n -> [Zobacz Dziadu](https://drive.google.com/file/d/FILE1/view?usp=drivesdk)',
			);
			expect(lines[3]).toBe(DUP_LINE(FILE));
		});

		it('escapes a quote in the file name inside the Drive query', () => {
			const r = run(wf, { employees: [{ ...ROW, fullname: "Jan O'Neil" }] });
			const BS = String.fromCharCode(92);
			expect(r.calls.http[0].query.q).toBe(
				"'FOLDER1' in parents and name='B2B-INVOICE-2026-08-31-Jan-O" +
					BS +
					"'Neil-Firma-IT.pdf' and trashed=false",
			);
			expect(r.calls.drive[0].name).toBe("B2B-INVOICE-2026-08-31-Jan-O'Neil-Firma-IT.pdf");
		});

		it('uses the full name in the notice when shortname is empty', () => {
			const r = run(wf, { employees: [{ ...ROW, shortname: '' }] });
			expect(r.messages[0].content).toContain('ten zjeb **Jan Kowalski** wysłał');
		});

		it('says the board was not notified when the notice cannot be posted', () => {
			const r = run(wf, { discordError: () => 'Missing Access' });
			expect(r.order).toContain('Post Notice');
			expect(r.messages).toHaveLength(1);
			expect(r.messages[0].content).toContain('Cześć Dziadu');
			expect(r.reply.content).toBe('Uploaded `' + FILE + '` to `' + FOLDER.path + '`.' + UNSENT);
		});
	});

	describe('failures', () => {
		const failed = (r, step, reason, auth) => {
			expect(r.reply).toEqual({ content: replies.FAILED });
			expect(r.reply.content).toBe(
				'Something went wrong saving your file. The board has been told.',
			);
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: failureNote('invoice-b2b', USER, step, reason, auth) },
			]);
		};

		it('a helper error with auth gives the failure reply and the note with the auth line', () => {
			const r = run(wf, {
				folder: {
					error: { step: 'year: list', message: 'Invalid Credentials', httpCode: 401, auth: true },
				},
			});
			failed(r, 'year: list', 'Invalid Credentials (HTTP 401)', true);
			expect(r.messages[0].content.split('\n')).toEqual([
				'⚠️ Invoice upload failed: /invoice-b2b by <@' +
					USER +
					'> at step `year: list`: Invalid Credentials (HTTP 401)',
				AUTH_LINE,
			]);
			expect(r.calls.http).toEqual([]);
			expect(r.calls.drive).toEqual([]);
		});

		it('folders resolved, then an upload 401: failure reply, auth note, no success notice', () => {
			const r = run(wf, {
				drive: () => ({ error: 'Authorization failed - please check your credentials' }),
			});
			failed(r, 'upload', 'Authorization failed - please check your credentials (HTTP 401)', true);
			expect(r.messages).toHaveLength(1);
			expect(r.messages[0].content).toContain('at step `upload`');
			expect(r.messages[0].content.endsWith('\n' + AUTH_LINE)).toBe(true);
			expect(r.messages[0].content).not.toContain('Cześć Dziadu');
			expect(r.subCalls).toHaveLength(1);
			expect(r.order).toContain('Upload');
			expect(r.order).not.toContain('Done');
			expect(r.order).not.toContain('Post Notice');
		});

		it('a helper that returns no items fails at folder: call instead of ending silently', () => {
			const r = run(wf, { folder: null });
			failed(r, 'folder: call', 'no folder id returned', false);
			expect(r.calls.http).toEqual([]);
			expect(r.calls.drive).toEqual([]);
			expect(r.order[r.order.length - 1]).toBe('Reply');
		});

		it('an upload whose Google token refresh failed carries the auth line', () => {
			const GRANT =
				'The provided authorization grant (e.g., authorization code, resource owner credentials) or refresh token is invalid, expired, revoked, does not match the redirection URI used in the authorization request, or was issued to another client.';
			const r = run(wf, { drive: () => ({ error: { message: GRANT } }) });
			failed(r, 'upload', GRANT, true);
			expect(r.messages[0].content.endsWith('\n' + AUTH_LINE)).toBe(true);
		});

		it('an upload 401 as an error object is an auth error too', () => {
			const r = run(wf, {
				drive: () => ({ error: { httpCode: '401', message: 'Invalid Credentials' } }),
			});
			failed(r, 'upload', 'Invalid Credentials (HTTP 401)', true);
		});

		it('an upload 500 fails without the auth line', () => {
			const r = run(wf, {
				drive: () => ({
					error: { message: 'The service was not able to process your request', httpCode: '500' },
				}),
			});
			failed(r, 'upload', 'The service was not able to process your request (HTTP 500)', false);
			expect(r.messages[0].content).not.toContain(AUTH_LINE);
		});

		it('a failed duplicate check fails before the download', () => {
			const r = run(wf, {
				http: (req) =>
					req.node === 'Check Duplicate'
						? { error: { message: 'Request failed with status code 403' } }
						: okHttp(req),
			});
			failed(r, 'duplicate check', 'Request failed with status code 403 (HTTP 403)', true);
			expect(r.calls.http.map((h) => h.node)).toEqual(['Check Duplicate']);
			expect(r.calls.drive).toEqual([]);
		});

		it('a failed download is never reported as a Drive login problem', () => {
			const r = run(wf, {
				http: (req) =>
					req.node === 'Download'
						? { error: 'Forbidden - perhaps check your credentials?' }
						: okHttp(req),
			});
			failed(r, 'download', 'Forbidden - perhaps check your credentials? (HTTP 403)', false);
			expect(r.calls.drive).toEqual([]);
		});

		it('a missing helper workflow fails at folder: call', () => {
			const r = simulate(
				wf,
				{ mode: 'command', interaction: interaction() },
				{
					tables: { Employee: [ROW], discord_config: CONFIG.map((x) => ({ ...x })) },
					workflows: {},
				},
			);
			expect(r.items[0].json).toEqual({ content: replies.FAILED });
			expect(r.env.messages.map((m) => m.content)).toEqual([
				failureNote('invoice-b2b', USER, 'folder: call', 'Workflow does not exist.', false),
			]);
		});

		it('the failure reply says the board was not told when the note cannot be posted', () => {
			const r = run(wf, {
				drive: () => ({ error: 'Authorization failed - please check your credentials' }),
				discordError: () => 'Missing Access',
			});
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.messages).toHaveLength(1);
			expect(r.order).toContain('Post Note');
		});

		it('a gate reply stays as it is when its note cannot be posted', () => {
			for (const [employees, content] of [
				[[], replies.NOT_REGISTERED],
				[[ROW, { ...ROW, fullname: 'Jan Nowak' }], replies.AMBIGUOUS],
				[[{ ...ROW, b2bentity: '' }], replies.INCOMPLETE],
			]) {
				const r = run(wf, { employees, discordError: () => 'Missing Access' });
				expect(r.reply).toEqual({ content });
				expect(r.messages).toHaveLength(1);
			}
		});
	});

	describe('date range', () => {
		it('refuses a date more than a year away from the current Warsaw year', () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 10)));
			for (const d of ['2028-08-31', '2024-08-31', '0001-08-31']) {
				const r = run(wf, { input: interaction({ sell_date: d }) });
				expect(r.reply, d).toEqual({ content: '`sell_date` must be a date like 2026-08-31.' });
				expect(r.order, d).not.toContain('Load Employees');
			}
			for (const d of ['2025-08-31', '2027-08-31']) {
				expect(run(wf, { input: interaction({ sell_date: d }) }).reply.content, d).toContain(
					'Uploaded `B2B-INVOICE-' + d + '-',
				);
			}
		});
	});

	describe('with the real Drive folder helper', () => {
		it('resolves the folders on an empty root and uploads into the person folder', () => {
			const helper = { ...built['helpers/drive-folder'], id: 'helper-wf' };
			const folders = new Map();
			let next = 1;
			const http = (req) => {
				if (req.node === 'List Children') {
					const parent = req.url.split("q='")[1].split("'")[0];
					const kids = [...folders.values()].filter((f) => f.parents.includes(parent));
					return { json: { files: kids } };
				}
				if (req.node === 'Create Folder') {
					const id = 'F' + next++;
					folders.set(id, {
						id,
						name: req.body.name,
						parents: req.body.parents,
						createdTime: '2026-10-20T00:00:00.000Z',
					});
					return { json: { id, name: req.body.name } };
				}
				return okHttp(req);
			};
			const r = run(wf, { http, workflows: { 'helper-wf': helper } });
			expect(r.subCalls.map((c) => [c.node, c.workflowId])).toEqual([
				['Find Folder', 'helper-wf'],
				['Year', 'helper-wf'],
				['Month', 'helper-wf'],
				['Person', 'helper-wf'],
			]);
			expect(r.subCalls[0].input).toEqual({
				rootId: 'ROOT',
				year: 2026,
				month: 8,
				personFolderName: PERSON,
			});
			expect([...folders.values()].map((f) => [f.id, f.name, f.parents])).toEqual([
				['F1', '2026', ['ROOT']],
				['F2', '08 - Sierpień', ['F1']],
				['F3', PERSON, ['F2']],
			]);
			expect(r.tables.drive_folders).toEqual([
				{ path: 'ROOT/2026', folderId: 'F1' },
				{ path: 'ROOT/2026/08', folderId: 'F2' },
				{ path: 'ROOT/2026/08/' + PERSON.toLowerCase(), folderId: 'F3' },
			]);
			const check = r.calls.http.find((h) => h.node === 'Check Duplicate');
			expect(check.query.q).toBe("'F3' in parents and name='" + FILE + "' and trashed=false");
			expect(r.calls.drive.map((d) => [d.node, d.name, d.folderId])).toEqual([
				['Upload', FILE, 'F3'],
			]);
			expect(r.reply).toEqual({
				content: 'Uploaded `' + FILE + '` to `2026/08 - Sierpień/' + PERSON + '`.',
			});
			expect(r.messages).toEqual([
				{
					channelId: CHANNEL,
					content:
						'Cześć Dziadu, ten zjeb **Jan** wysłał fakture **(160 godzin)** za `sierpień` `2026`\n -> [Pobierz Dziadu](https://drive.google.com/uc?id=FILE1&export=download)\n -> [Zobacz Dziadu](https://drive.google.com/file/d/FILE1/view?usp=drivesdk)',
				},
			]);
			expect(r.order.slice(-3)).toEqual(['Done', 'Post Notice', 'Reply Success']);
		});
	});
});

describe('/invoice-zlecenie', () => {
	const wf = built['commands/invoice-zlecenie'];
	const ZROW = {
		discordID: USER,
		fullname: 'Anna Nowak',
		shortname: 'Ania',
		b2bentity: '',
		contract: 'ZLECENIE',
		email: 'anna@example.com',
	};
	const TS_FILE = 'ZLECENIE-2026-08-31-Anna-Nowak-TIMESHEET.pdf';
	const BILL_FILE = 'ZLECENIE-2026-08-31-Anna-Nowak-Bill.pdf';
	const ZPERSON = 'ZLECENIE - Anna Nowak';
	const ZFOLDER = {
		folderId: 'FOLDER2',
		path: '2026/08 - Sierpień/' + ZPERSON,
		created: [],
		renamed: [],
	};
	const TS_URL = 'https://cdn.discordapp.com/attachments/1/3/godziny.pdf?ex=1';
	const BILL_URL = 'https://cdn.discordapp.com/attachments/1/4/rachunek.pdf?ex=1';
	const TS_BYTES = { data: 'VFM=', mimeType: 'application/pdf', fileName: 'godziny.pdf' };
	const BILL_BYTES = { data: 'QklMTA==', mimeType: 'application/pdf', fileName: 'rachunek.pdf' };
	const zInteraction = (options = {}, timesheet = {}, bill = {}) => ({
		kind: 'command',
		commandName: 'invoice-zlecenie',
		userId: USER,
		guildId: '1280482154249457685',
		options: { timesheet: '901', bill: '902', month_date: '2026-08-31', ...options },
		resolved: {
			attachments: {
				901: { ...PDF, url: TS_URL, filename: 'godziny.pdf', ...timesheet },
				902: { ...PDF, url: BILL_URL, filename: 'rachunek.pdf', ...bill },
			},
		},
	});
	const zHttp = (req) => {
		if (req.node === 'Check Timesheet' || req.node === 'Check Bill') return { json: { files: [] } };
		if (req.node === 'Download Timesheet') return { binary: TS_BYTES };
		if (req.node === 'Download Bill') return { binary: BILL_BYTES };
		throw new Error('unexpected http ' + req.node);
	};
	const zDrive = (req) => {
		const id = req.node === 'Upload Timesheet' ? 'TS1' : 'BILL1';
		return {
			json: {
				id,
				name: req.name,
				webViewLink: 'https://view/' + id,
				webContentLink: 'https://get/' + id,
			},
		};
	};
	const runZ = (opts = {}) =>
		run(wf, {
			input: zInteraction(),
			employees: [ZROW],
			folder: ZFOLDER,
			http: zHttp,
			drive: zDrive,
			...opts,
		});
	const NOTICE =
		'Cześć Dziadu, ten kurwipołeć **Ania** Podpisał rachunek i godzinki za `sierpień` `2026`\n -> [Zobacz Godziny](https://view/TS1)\n -> [Zobacz Rachunek](https://view/BILL1)';
	const failed = (r, step, reason, auth) => {
		expect(r.reply).toEqual({ content: replies.FAILED });
		expect(r.messages).toEqual([
			{ channelId: CHANNEL, content: failureNote('invoice-zlecenie', USER, step, reason, auth) },
		]);
	};

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('definition and structure', () => {
		it('is a tagged discord-command with the exact definition', () => {
			expect(wf.name).toBe('Discord Command: invoice-zlecenie');
			expect(wf.tags.map((t) => t.name)).toEqual(['discord-command']);
			const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
			expect(parsed.ok).toBe(true);
			expect(parsed.definition).toEqual({
				name: 'invoice-zlecenie',
				description: 'Upload your signed timesheet and bill',
				guilds: ['1280482154249457685'],
				ephemeral: true,
				whitelist: { users: [], roles: ['1471572659438358713'] },
				options: [
					{ type: 11, name: 'timesheet', description: 'Signed timesheet (PDF)', required: true },
					{ type: 11, name: 'bill', description: 'Signed bill (PDF)', required: true },
					{
						type: 3,
						name: 'month_date',
						description: 'Date on the bill (YYYY-MM-DD)',
						required: true,
						autocomplete: true,
					},
				],
			});
		});

		it('runs the timesheet chain, then the bill chain, into one folder', () => {
			expect(targets(wf, 'Switch on mode', 0)).toEqual(['Validate']);
			expect(targets(wf, 'Switch on mode', 1)).toEqual(['Suggest Dates']);
			expect(targets(wf, 'Valid?', 0)).toEqual(['Load Employees']);
			expect(targets(wf, 'Valid?', 1)).toEqual(['Reply Invalid']);
			expect(targets(wf, 'Go?', 0)).toEqual(['Find Folder']);
			expect(targets(wf, 'Go?', 1)).toEqual(['Stop']);
			expect(targets(wf, 'Find Folder')).toEqual(['Folder OK?']);
			expect(targets(wf, 'Folder OK?', 0)).toEqual(['Check Timesheet']);
			expect(targets(wf, 'Folder OK?', 1)).toEqual(['Failure']);
			expect(targets(wf, 'Check Timesheet', 0)).toEqual(['Download Timesheet']);
			expect(targets(wf, 'Download Timesheet', 0)).toEqual(['Upload Timesheet']);
			expect(targets(wf, 'Upload Timesheet', 0)).toEqual(['Check Bill']);
			expect(targets(wf, 'Check Bill', 0)).toEqual(['Download Bill']);
			expect(targets(wf, 'Download Bill', 0)).toEqual(['Upload Bill']);
			expect(targets(wf, 'Upload Bill', 0)).toEqual(['Done']);
			expect(targets(wf, 'Done')).toEqual(['Post Notice']);
			expect(targets(wf, 'Post Notice')).toEqual(['Reply Success']);
			expect(targets(wf, 'Failure')).toEqual(['Stop']);
			expect(targets(wf, 'Stop')).toEqual(['Notify?']);
			expect(targets(wf, 'Notify?', 0)).toEqual(['Post Note']);
			expect(targets(wf, 'Notify?', 1)).toEqual(['Reply']);
			expect(targets(wf, 'Post Note')).toEqual(['Reply']);
			expect([...reachable(wf, 'Reply Invalid')]).toEqual([]);
		});

		it('sends every Drive and HTTP error output to the one failure branch', () => {
			const io = wf.nodes.filter(
				(n) => n.type === 'n8n-nodes-base.httpRequest' || n.type === 'n8n-nodes-base.googleDrive',
			);
			expect(io.map((n) => n.name).sort()).toEqual(
				[
					'Check Timesheet',
					'Download Timesheet',
					'Upload Timesheet',
					'Check Bill',
					'Download Bill',
					'Upload Bill',
				].sort(),
			);
			for (const n of io) {
				expect(n.onError, n.name).toBe('continueErrorOutput');
				expect(targets(wf, n.name, 1), n.name).toEqual(['Failure']);
			}
			const posts = wf.nodes.filter((n) => n.type === 'CUSTOM.discord');
			expect(posts.map((n) => n.name).sort()).toEqual(['Post Note', 'Post Notice']);
			for (const n of posts) {
				expect(n.onError, n.name).toBe('continueRegularOutput');
				expect(n.credentials).toEqual({ discordGatewayBotApi: { name: 'Discord Bot (live)' } });
				expect(n.parameters.allowedMentions.values.parse).toEqual([]);
			}
			expect(node(wf, 'Find Folder').onError).toBe('continueRegularOutput');
			expect(node(wf, 'Find Folder').alwaysOutputData).toBe(true);
		});

		it('shares the b2b lookups and folder call', () => {
			const b2b = built['commands/invoice-b2b'];
			for (const name of ['Load Employees', 'Load Config', 'Find Folder']) {
				expect(node(wf, name).parameters, name).toEqual(node(b2b, name).parameters);
				expect(node(wf, name).executeOnce, name).toBe(node(b2b, name).executeOnce);
			}
		});

		it('checks, downloads and uploads each file by its own index and binary', () => {
			const files = [
				['Timesheet', 0, 'timesheet'],
				['Bill', 1, 'bill'],
			];
			for (const [label, i, option] of files) {
				const check = node(wf, 'Check ' + label);
				expect(check.parameters.url).toBe('https://www.googleapis.com/drive/v3/files');
				expect(check.parameters.queryParameters.parameters[0].value).toBe(
					"='{{ $('Find Folder').first().json.folderId }}' in parents and name='{{ $('Plan').first().json.files[" +
						i +
						"].quotedName }}' and trashed=false",
				);
				expect(check.credentials).toEqual({
					googleDriveOAuth2Api: { name: 'Google Drive account' },
				});
				const download = node(wf, 'Download ' + label);
				expect(download.parameters.url).toBe("={{ $('Plan').first().json.files[" + i + '].url }}');
				expect(download.parameters.authentication).toBe('none');
				expect(download.parameters.options.response.response).toEqual({
					responseFormat: 'file',
					outputPropertyName: option,
				});
				expect(download.credentials).toBeUndefined();
				const upload = node(wf, 'Upload ' + label);
				expect(upload.typeVersion).toBe(3);
				expect(upload.parameters).toEqual({
					inputDataFieldName: option,
					name: "={{ $('Plan').first().json.files[" + i + '].fileName }}',
					driveId: { __rl: true, mode: 'list', value: 'My Drive' },
					folderId: {
						__rl: true,
						value: "={{ $('Find Folder').first().json.folderId }}",
						mode: 'id',
					},
					options: {},
				});
				expect(upload.credentials).toEqual({
					googleDriveOAuth2Api: { name: 'Google Drive account' },
				});
			}
		});

		it('keeps the Code nodes thin and inlines the three libs', () => {
			const code = wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
			expect(code.map((n) => n.name).sort()).toEqual(
				[
					'Done',
					'Failure',
					'Plan',
					'Reply',
					'Reply Success',
					'Stop',
					'Suggest Dates',
					'Validate',
				].sort(),
			);
			const template = require('../workflows/commands/invoice-zlecenie.template.json');
			for (const n of template.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
				if (n.name === 'Stop') continue;
				expect(n.parameters.jsCode.split('\n')[0], n.name).toBe(
					'//@inline lib/invoice.js lib/driveFolder.js lib/invoiceFlow.js',
				);
				expect(n.parameters.jsCode.split('\n').length, n.name).toBeLessThanOrEqual(12);
				if (!['Done', 'Failure', 'Reply', 'Reply Success'].includes(n.name)) {
					expect(n.parameters.jsCode, n.name).toContain("('zlecenie'");
				}
			}
			for (const n of code) expect(n.parameters.jsCode, n.name).not.toMatch(/\bthrow\b/);
		});
	});

	describe('autocomplete', () => {
		it('suggests dates for month_date', () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date(Date.UTC(2026, 7, 20, 10)));
			const r = runZ({
				mode: 'autocomplete',
				input: { ...zInteraction({ month_date: '2026-07' }), kind: 'autocomplete' },
			});
			expect(r.reply).toEqual({ choices: [{ name: '2026-07-31', value: '2026-07-31' }] });
		});
	});

	describe('validation', () => {
		const cases = [
			[
				'a non-PDF bill',
				zInteraction({}, {}, { content_type: 'image/png', filename: 'b.png' }),
				'`bill` must be a PDF.',
			],
			[
				'an oversize bill',
				zInteraction({}, {}, { size: 20 * 1024 * 1024 + 1 }),
				'`bill` is larger than 20 MB.',
			],
			['a missing bill', zInteraction({ bill: undefined }), '`bill` must be a PDF.'],
			[
				'a non-PDF timesheet',
				zInteraction({}, { content_type: 'text/plain', filename: 't.txt' }),
				'`timesheet` must be a PDF.',
			],
			[
				'a bad date',
				zInteraction({ month_date: '2026-13-01' }),
				'`month_date` must be a date like 2026-08-31.',
			],
		];
		for (const [label, input, copy] of cases) {
			it(label + ' blocks both files before any download', () => {
				const r = runZ({ input });
				expect(r.reply).toEqual({ content: copy });
				expect(r.order).not.toContain('Load Employees');
				expect(r.calls.http).toEqual([]);
				expect(r.calls.drive).toEqual([]);
				expect(r.messages).toEqual([]);
				expect(r.subCalls).toEqual([]);
			});
		}
	});

	describe('employee gate', () => {
		it('not registered: the reply and the note', () => {
			const r = runZ({ employees: [] });
			expect(r.reply).toEqual({ content: replies.NOT_REGISTERED });
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: notRegisteredNote('invoice-zlecenie', USER) },
			]);
		});

		it('ambiguous: the reply and the note', () => {
			const r = runZ({ employees: [ZROW, { ...ZROW, fullname: 'Anna Kowal' }] });
			expect(r.reply).toEqual({ content: replies.AMBIGUOUS });
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: ambiguousNote('invoice-zlecenie', USER, 2) },
			]);
		});

		it('incomplete: contract is required, b2bentity is not', () => {
			const r = runZ({ employees: [{ ...ZROW, contract: ' ' }] });
			expect(r.reply).toEqual({ content: replies.INCOMPLETE });
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: incompleteNote('invoice-zlecenie', USER, ['contract']) },
			]);
			expect(r.subCalls).toEqual([]);
		});

		it('an unreadable discord_config table fails at step config', () => {
			const r = runZ({ tableErrors: { discord_config: 'Could not find data table' } });
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.stop.note).toBe(
				failureNote('invoice-zlecenie', USER, 'config', 'Could not find data table', false),
			);
			expect(r.messages).toEqual([]);
		});
	});

	describe('upload', () => {
		it('saves both files into one folder and posts the Zlecenie notice', () => {
			const r = runZ();
			expect(r.reply).toEqual({
				content:
					'Uploaded `' +
					TS_FILE +
					'` to `2026/08 - Sierpień/ZLECENIE - Anna Nowak`.\nUploaded `' +
					BILL_FILE +
					'` to `2026/08 - Sierpień/ZLECENIE - Anna Nowak`.',
			});
			expect(r.messages).toEqual([{ channelId: CHANNEL, content: NOTICE }]);
			expect(r.subCalls).toEqual([
				{
					node: 'Find Folder',
					workflowId: 'helper-wf',
					input: { rootId: 'ROOT', year: 2026, month: 8, personFolderName: ZPERSON },
				},
			]);
			expect(r.calls.http.map((h) => [h.node, h.url])).toEqual([
				['Check Timesheet', 'https://www.googleapis.com/drive/v3/files'],
				['Download Timesheet', TS_URL],
				['Check Bill', 'https://www.googleapis.com/drive/v3/files'],
				['Download Bill', BILL_URL],
			]);
			expect(r.calls.http[0].query.q).toBe(
				"'FOLDER2' in parents and name='" + TS_FILE + "' and trashed=false",
			);
			expect(r.calls.http[2].query.q).toBe(
				"'FOLDER2' in parents and name='" + BILL_FILE + "' and trashed=false",
			);
			expect(r.calls.drive.map((d) => [d.node, d.name, d.folderId, d.binary])).toEqual([
				['Upload Timesheet', TS_FILE, 'FOLDER2', TS_BYTES],
				['Upload Bill', BILL_FILE, 'FOLDER2', BILL_BYTES],
			]);
			expect(r.order.slice(-3)).toEqual(['Done', 'Post Notice', 'Reply Success']);
		});

		it('builds both view links from the file ids when Drive returns only ids', () => {
			const r = runZ({
				drive: (req) => ({ json: { id: req.node === 'Upload Timesheet' ? 'T9' : 'B9' } }),
			});
			expect(r.messages[0].content).toContain(
				'[Zobacz Godziny](https://drive.google.com/file/d/T9/view?usp=drivesdk)',
			);
			expect(r.messages[0].content).toContain(
				'[Zobacz Rachunek](https://drive.google.com/file/d/B9/view?usp=drivesdk)',
			);
		});

		it('says which file was already there', () => {
			const r = runZ({
				http: (req) =>
					req.node === 'Check Bill' ? { json: { files: [{ id: 'OLD' }] } } : zHttp(req),
			});
			expect(r.reply.content.split('\n')).toEqual([
				'Uploaded `' + TS_FILE + '` to `' + ZFOLDER.path + '`.',
				'Uploaded `' + BILL_FILE + '` to `' + ZFOLDER.path + '`.',
				'A file named `' + BILL_FILE + '` was already there; both are kept.',
			]);
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: NOTICE + '\n' + DUP_LINE(BILL_FILE) },
			]);
		});

		it('uses the full name when shortname is empty', () => {
			const r = runZ({ employees: [{ ...ZROW, shortname: '' }] });
			expect(r.messages[0].content).toContain('ten kurwipołeć **Anna Nowak** Podpisał');
		});
	});

	describe('failures', () => {
		it('the bill upload fails after the timesheet was saved: the note names the timesheet', () => {
			const r = runZ({
				drive: (req) =>
					req.node === 'Upload Bill'
						? { error: { message: 'Backend Error', httpCode: '500' } }
						: zDrive(req),
			});
			failed(
				r,
				'bill: upload',
				'Backend Error (HTTP 500); already uploaded: `' + TS_FILE + '`',
				false,
			);
			expect(r.calls.drive.map((d) => d.node)).toEqual(['Upload Timesheet', 'Upload Bill']);
			expect(r.order).not.toContain('Done');
			expect(r.order).not.toContain('Post Notice');
		});

		it('an expired login on the bill upload keeps the auth line and the uploaded timesheet', () => {
			const r = runZ({
				drive: (req) =>
					req.node === 'Upload Bill'
						? { error: 'Authorization failed - please check your credentials' }
						: zDrive(req),
			});
			failed(
				r,
				'bill: upload',
				'Authorization failed - please check your credentials (HTTP 401); already uploaded: `' +
					TS_FILE +
					'`',
				true,
			);
			expect(r.messages[0].content.endsWith('\n' + AUTH_LINE)).toBe(true);
		});

		it('a failed bill download names the timesheet and is not a login problem', () => {
			const r = runZ({
				http: (req) =>
					req.node === 'Download Bill'
						? { error: 'Forbidden - perhaps check your credentials?' }
						: zHttp(req),
			});
			failed(
				r,
				'bill: download',
				'Forbidden - perhaps check your credentials? (HTTP 403); already uploaded: `' +
					TS_FILE +
					'`',
				false,
			);
			expect(r.calls.drive.map((d) => d.node)).toEqual(['Upload Timesheet']);
		});

		it('a failed bill duplicate check names the timesheet', () => {
			const r = runZ({
				http: (req) =>
					req.node === 'Check Bill' ? { error: { message: 'invalid_grant' } } : zHttp(req),
			});
			failed(
				r,
				'bill: duplicate check',
				'invalid_grant; already uploaded: `' + TS_FILE + '`',
				true,
			);
		});

		it('a failed timesheet upload stops before the bill and names nothing as uploaded', () => {
			const r = runZ({
				drive: (req) =>
					req.node === 'Upload Timesheet'
						? { error: { message: 'Backend Error', httpCode: '500' } }
						: zDrive(req),
			});
			failed(r, 'timesheet: upload', 'Backend Error (HTTP 500)', false);
			expect(r.order).not.toContain('Check Bill');
			expect(r.calls.http.map((h) => h.node)).toEqual(['Check Timesheet', 'Download Timesheet']);
		});

		it('a failed timesheet download is not a login problem', () => {
			const r = runZ({
				http: (req) =>
					req.node === 'Download Timesheet'
						? { error: 'Request failed with status code 404' }
						: zHttp(req),
			});
			failed(r, 'timesheet: download', 'Request failed with status code 404 (HTTP 404)', false);
			expect(r.calls.drive).toEqual([]);
		});

		it('a helper error goes to the failure branch with nothing uploaded', () => {
			const r = runZ({
				folder: {
					error: { step: 'person: create', message: 'invalid_grant', httpCode: 400, auth: true },
				},
			});
			failed(r, 'person: create', 'invalid_grant (HTTP 400)', true);
			expect(r.calls.http).toEqual([]);
		});

		it('a helper that returns no items fails at folder: call', () => {
			const r = runZ({ folder: null });
			failed(r, 'folder: call', 'no folder id returned', false);
			expect(r.order[r.order.length - 1]).toBe('Reply');
		});

		it('the failure reply says the board was not told when the note cannot be posted', () => {
			const r = runZ({
				drive: (req) => (req.node === 'Upload Bill' ? { error: 'Backend Error' } : zDrive(req)),
				discordError: () => 'Missing Access',
			});
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.messages).toHaveLength(1);
			expect(r.messages[0].content).toContain('at step `bill: upload`');
		});

		it('with no channel configured the user is told the board was not told', () => {
			const r = runZ({ config: CONFIG.filter((c) => c.key !== 'invoiceNotifyChannelId') });
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.messages).toEqual([]);
		});

		it('a gate reply stays as it is when its note cannot be posted', () => {
			const r = runZ({ employees: [], discordError: () => 'Missing Access' });
			expect(r.reply).toEqual({ content: replies.NOT_REGISTERED });
			expect(r.messages).toHaveLength(1);
		});
	});

	describe('board notice', () => {
		it('says the board was not notified when the notice cannot be posted', () => {
			const r = runZ({ discordError: () => 'Missing Access' });
			expect(r.order).toContain('Post Notice');
			expect(r.messages).toEqual([{ channelId: CHANNEL, content: NOTICE }]);
			expect(r.reply.content).toBe(
				'Uploaded `' +
					TS_FILE +
					'` to `' +
					ZFOLDER.path +
					'`.\nUploaded `' +
					BILL_FILE +
					'` to `' +
					ZFOLDER.path +
					'`.' +
					UNSENT,
			);
		});
	});

	describe('date range', () => {
		it('refuses a month_date more than a year away from the current Warsaw year', () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 10)));
			for (const d of ['2028-08-31', '2024-08-31', '0001-08-31']) {
				const r = runZ({ input: zInteraction({ month_date: d }) });
				expect(r.reply, d).toEqual({ content: '`month_date` must be a date like 2026-08-31.' });
				expect(r.order, d).not.toContain('Load Employees');
			}
			expect(runZ({ input: zInteraction({ month_date: '2027-01-31' }) }).reply.content).toContain(
				'ZLECENIE-2027-01-31-Anna-Nowak-TIMESHEET.pdf',
			);
		});
	});
});

describe('/invoice-client', () => {
	const wf = built['commands/invoice-client'];
	const { classifyInteraction } = loadModule('classify', ['customId']);
	const { workflowInput } = loadModule('workflowInput');
	const CFILE = "FV 12-2026 Acme O'Neil.pdf";
	const KFOLDER = {
		folderId: 'KLIENCI',
		path: '2026/08 - Sierpień/Klienci',
		created: [],
		renamed: [],
	};
	const CURL = 'https://cdn.discordapp.com/attachments/1/5/fv.pdf?ex=1';
	const cInteraction = (options = {}, attachment = {}, who = {}) => ({
		kind: 'command',
		commandName: 'invoice-client',
		userId: USER,
		guildId: '1280482154249457685',
		displayName: 'Janek',
		...who,
		options: { invoice: '903', invoice_date: '2026-08-14', description: 'Hosting', ...options },
		resolved: { attachments: { 903: { ...PDF, url: CURL, filename: CFILE, ...attachment } } },
	});
	const cDrive = () => ({
		json: { id: 'K1', webViewLink: 'https://view/K1', webContentLink: 'https://get/K1' },
	});
	const runC = (opts = {}) =>
		run(wf, {
			input: cInteraction(),
			employees: [],
			folder: KFOLDER,
			drive: cDrive,
			...opts,
		});
	const notice = (uploader, description = 'Hosting') =>
		'Któryś z was dzbany jebane wrzucił nową fakture dla klienta, pamiętajcie zeby ją dać na ksef i wysłać ją klientowi... bo jeszcze nie zapłaci i będzie na was pacany (wrzucił: ' +
		uploader +
		')\n`' +
		CFILE +
		'` za `sierpień` `2026`\n\n OPIS Faktury: ' +
		description +
		'\n -> [Pobierz Fakture](https://get/K1)\n -> [Zobacz Fakture](https://view/K1)';
	const failed = (r, step, reason, auth) => {
		expect(r.reply).toEqual({ content: replies.FAILED });
		expect(r.messages).toEqual([
			{ channelId: CHANNEL, content: failureNote('invoice-client', USER, step, reason, auth) },
		]);
	};

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('definition and structure', () => {
		it('is a tagged discord-command with the exact definition', () => {
			expect(wf.name).toBe('Discord Command: invoice-client');
			expect(wf.tags.map((t) => t.name)).toEqual(['discord-command']);
			const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
			expect(parsed.ok).toBe(true);
			expect(parsed.definition).toEqual({
				name: 'invoice-client',
				description: 'Upload a company invoice for a client',
				guilds: ['1280482154249457685'],
				ephemeral: true,
				whitelist: { users: [], roles: ['1280482268015493131'] },
				options: [
					{ type: 11, name: 'invoice', description: 'Invoice (PDF)', required: true },
					{
						type: 3,
						name: 'invoice_date',
						description: 'Invoice date (YYYY-MM-DD)',
						required: true,
						autocomplete: true,
					},
					{
						type: 3,
						name: 'description',
						description: "What it's for",
						required: false,
						max_length: 1000,
					},
				],
			});
		});

		it('has the b2b shape: same nodes, same wiring, same I/O parameters', () => {
			const b2b = built['commands/invoice-b2b'];
			expect(wf.nodes.map((n) => n.name)).toEqual(b2b.nodes.map((n) => n.name));
			expect(wf.connections).toEqual(b2b.connections);
			for (const name of [
				'Load Employees',
				'Load Config',
				'Find Folder',
				'Check Duplicate',
				'Download',
				'Upload',
				'Post Note',
				'Post Notice',
			]) {
				const mine = node(wf, name);
				const theirs = node(b2b, name);
				expect(mine.parameters, name).toEqual(theirs.parameters);
				expect(mine.credentials, name).toEqual(theirs.credentials);
				expect(mine.onError, name).toBe(theirs.onError);
				expect(mine.alwaysOutputData, name).toBe(theirs.alwaysOutputData);
			}
			expect(node(wf, 'Find Folder').alwaysOutputData).toBe(true);
			for (const n of ['Check Duplicate', 'Download', 'Upload']) {
				expect(targets(wf, n, 1), n).toEqual(['Failure']);
			}
		});

		it('keeps the Code nodes thin and runs them for client', () => {
			const template = require('../workflows/commands/invoice-client.template.json');
			for (const n of template.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
				if (n.name === 'Stop') continue;
				expect(n.parameters.jsCode.split('\n')[0], n.name).toBe(
					'//@inline lib/invoice.js lib/driveFolder.js lib/invoiceFlow.js',
				);
				expect(n.parameters.jsCode.split('\n').length, n.name).toBeLessThanOrEqual(8);
				expect(n.parameters.jsCode, n.name).not.toContain("'b2b'");
				if (!['Done', 'Failure', 'Reply', 'Reply Success'].includes(n.name)) {
					expect(n.parameters.jsCode, n.name).toContain("('client'");
				}
			}
			for (const n of wf.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
				expect(n.parameters.jsCode, n.name).not.toMatch(/\bthrow\b/);
			}
		});
	});

	describe('autocomplete', () => {
		it('suggests dates for invoice_date', () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date(Date.UTC(2026, 7, 20, 10)));
			const r = runC({
				mode: 'autocomplete',
				input: { ...cInteraction({ invoice_date: '2026-08-2' }), kind: 'autocomplete' },
			});
			expect(r.reply).toEqual({ choices: [{ name: '2026-08-20', value: '2026-08-20' }] });
		});
	});

	describe('validation', () => {
		const cases = [
			[
				'a non-PDF invoice',
				cInteraction({}, { content_type: 'image/jpeg', filename: 'scan.jpg' }),
				'`invoice` must be a PDF.',
			],
			[
				'an oversize invoice',
				cInteraction({}, { size: 20 * 1024 * 1024 + 1 }),
				'`invoice` is larger than 20 MB.',
			],
			[
				'a bad date',
				cInteraction({ invoice_date: '2026-08' }),
				'`invoice_date` must be a date like 2026-08-31.',
			],
		];
		for (const [label, input, copy] of cases) {
			it(label + ' replies with the exact copy and nothing else runs', () => {
				const r = runC({ input });
				expect(r.reply).toEqual({ content: copy });
				expect(r.order).not.toContain('Load Employees');
				expect(r.calls.http).toEqual([]);
				expect(r.calls.drive).toEqual([]);
				expect(r.messages).toEqual([]);
			});
		}
	});

	describe('upload', () => {
		it('keeps the attachment name, uploads into Klienci and posts the client notice', () => {
			const r = runC();
			expect(r.reply).toEqual({
				content: 'Uploaded `' + CFILE + '` to `2026/08 - Sierpień/Klienci`.',
			});
			expect(r.messages).toEqual([{ channelId: CHANNEL, content: notice('Janek') }]);
			expect(r.subCalls).toEqual([
				{
					node: 'Find Folder',
					workflowId: 'helper-wf',
					input: { rootId: 'ROOT', year: 2026, month: 8, personFolderName: 'Klienci' },
				},
			]);
			const BS = String.fromCharCode(92);
			expect(r.calls.http[0].query.q).toBe(
				"'KLIENCI' in parents and name='FV 12-2026 Acme O" + BS + "'Neil.pdf' and trashed=false",
			);
			expect(r.calls.http[1]).toMatchObject({ node: 'Download', url: CURL });
			expect(r.calls.drive).toEqual([
				{
					node: 'Upload',
					resource: 'file',
					operation: 'upload',
					name: CFILE,
					folderId: 'KLIENCI',
					driveId: 'My Drive',
					binary: PDF_BYTES,
				},
			]);
			expect(r.order.slice(-3)).toEqual(['Done', 'Post Notice', 'Reply Success']);
		});

		it('writes - when there is no description', () => {
			const r = runC({ input: cInteraction({ description: undefined }) });
			expect(r.messages[0].content).toBe(notice('Janek', '-'));
			const blank = runC({ input: cInteraction({ description: '   ' }) });
			expect(blank.messages[0].content).toContain('\n\n OPIS Faktury: -\n');
		});

		it('names the uploader by the Employee row when one matches', () => {
			expect(runC({ employees: [ROW] }).messages[0].content).toBe(notice('Jan'));
			expect(runC({ employees: [{ ...ROW, shortname: '' }] }).messages[0].content).toBe(
				notice('Jan Kowalski'),
			);
		});

		it('needs no Employee row: unmatched, ambiguous or incomplete rows still upload', () => {
			for (const employees of [
				[],
				[{ ...ROW, discordID: '222222222222222222' }],
				[ROW, { ...ROW, fullname: 'Jan Nowak' }],
			]) {
				const r = runC({ employees });
				expect(r.reply.content).toBe('Uploaded `' + CFILE + '` to `2026/08 - Sierpień/Klienci`.');
				expect(r.messages).toEqual([{ channelId: CHANNEL, content: notice('Janek') }]);
			}
			const partial = runC({ employees: [{ discordID: USER, fullname: '', shortname: '' }] });
			expect(partial.messages[0].content).toBe(notice('Janek'));
		});

		it('falls back to a mention when no name is known', () => {
			const r = runC({ input: cInteraction({}, {}, { displayName: '' }) });
			expect(r.messages[0].content).toBe(notice('<@' + USER + '>'));
		});

		it('reads the Discord display name from a router-classified interaction', () => {
			const raw = (member, user) => ({
				id: 'i1',
				token: 'tok',
				application_id: 'app',
				type: 2,
				guild_id: '1280482154249457685',
				channel_id: 'c1',
				...(member ? { member: { ...member, user, roles: ['1280482268015493131'] } } : { user }),
				data: {
					name: 'invoice-client',
					options: [
						{ name: 'invoice', type: 11, value: '903' },
						{ name: 'invoice_date', type: 3, value: '2026-08-14' },
						{ name: 'description', type: 3, value: 'Hosting' },
					],
					resolved: { attachments: { 903: { ...PDF, url: CURL, filename: CFILE } } },
				},
			});
			const uploader = (member, user) => {
				const input = workflowInput(classifyInteraction(raw(member, user)));
				expect(input.mode).toBe('command');
				return runC({ input: input.interaction }).messages[0].content;
			};
			const user = { id: USER, global_name: 'Jan K', username: 'jank' };
			expect(uploader({ nick: 'Janek' }, user)).toBe(notice('Janek'));
			expect(uploader({ nick: null }, user)).toBe(notice('Jan K'));
			expect(uploader({}, { id: USER, global_name: null, username: 'jank' })).toBe(notice('jank'));
		});
	});

	describe('failures', () => {
		it('an expired login on the upload: failure reply, auth note, no notice', () => {
			const r = runC({
				drive: () => ({ error: 'Authorization failed - please check your credentials' }),
			});
			failed(r, 'upload', 'Authorization failed - please check your credentials (HTTP 401)', true);
			expect(r.order).not.toContain('Post Notice');
		});

		it('a helper that returns no items fails at folder: call', () => {
			const r = runC({ folder: null });
			failed(r, 'folder: call', 'no folder id returned', false);
		});

		it('an unreadable discord_config table fails at step config', () => {
			const r = runC({ tableErrors: { discord_config: 'Could not find data table' } });
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.stop.note).toBe(
				failureNote('invoice-client', USER, 'config', 'Could not find data table', false),
			);
			expect(r.messages).toEqual([]);
		});

		it('an unreadable Employee table still fails, even though no row is required', () => {
			const r = runC({ tableErrors: { Employee: 'Could not find data table' } });
			failed(r, 'employee', 'Could not find data table', false);
			expect(r.subCalls).toEqual([]);
		});

		it('the failure reply says the board was not told when the note cannot be posted', () => {
			const r = runC({
				drive: () => ({ error: 'Backend Error' }),
				discordError: () => 'Missing Access',
			});
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.messages).toHaveLength(1);
		});

		it('with no channel configured the user is told the board was not told', () => {
			const r = runC({ config: CONFIG.filter((c) => c.key !== 'invoiceNotifyChannelId') });
			expect(r.reply).toEqual({ content: UNTOLD });
			expect(r.messages).toEqual([]);
		});
	});

	describe('board notice', () => {
		it('says the board was not notified when the notice cannot be posted', () => {
			const r = runC({ discordError: () => 'Missing Access' });
			expect(r.order).toContain('Post Notice');
			expect(r.messages).toEqual([{ channelId: CHANNEL, content: notice('Janek') }]);
			expect(r.reply.content).toBe(
				'Uploaded `' + CFILE + '` to `2026/08 - Sierpień/Klienci`.' + UNSENT,
			);
		});

		it('flags a same-named client file in the notice', () => {
			const r = runC({
				http: (req) =>
					req.node === 'Check Duplicate' ? { json: { files: [{ id: 'OLD' }] } } : okHttp(req),
			});
			expect(r.messages).toEqual([
				{ channelId: CHANNEL, content: notice('Janek') + '\n' + DUP_LINE(CFILE) },
			]);
		});
	});

	describe('date range', () => {
		it('refuses an invoice_date more than a year away from the current Warsaw year', () => {
			vi.useFakeTimers({ toFake: ['Date'] });
			vi.setSystemTime(new Date(Date.UTC(2026, 9, 20, 10)));
			for (const d of ['2028-08-14', '2024-08-14', '0001-08-14']) {
				const r = runC({ input: cInteraction({ invoice_date: d }) });
				expect(r.reply, d).toEqual({ content: '`invoice_date` must be a date like 2026-08-31.' });
			}
			expect(runC({ input: cInteraction({ invoice_date: '2025-12-01' }) }).reply.content).toBe(
				'Uploaded `' + CFILE + '` to `2026/08 - Sierpień/Klienci`.',
			);
		});
	});
});
