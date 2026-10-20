import { describe, it, expect } from 'vitest';
import {
	inlineCode,
	buildAll,
	buildWorkflow,
	writeAll,
	TEMPLATE_NAMES,
	parseCredentialList,
	expandClickupChain,
	DEFAULT_CLICKUP_CREDENTIALS,
} from '../build-workflows.mjs';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadModule } = require('./load.js');
const { parseDefinition } = loadModule('definition');

const BOT_DIR = path.join(__dirname, '..');
const built = buildAll(BOT_DIR);
const templateText = (name) =>
	fs.readFileSync(path.join(BOT_DIR, 'workflows', name + '.template.json'), 'utf8');

const node = (wf, name) => {
	const n = wf.nodes.find((x) => x.name === name);
	if (!n) throw new Error('no node ' + name + ' in ' + wf.name);
	return n;
};
const codeNodes = (wf) => wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code');
const targets = (wf, from, output = 0) =>
	((wf.connections[from] && wf.connections[from].main[output]) || []).map((c) => c.node);

// Runs a built Code node's jsCode with stand-ins for n8n's $, $input and $json.
function runCode(wf, name, { nodes = {}, input = [] } = {}) {
	const pick = (items, label) => {
		if (!items) throw new Error('no data for ' + label);
		return { first: () => items[0], all: () => items, item: items[0] };
	};
	const $ = (n) => pick(nodes[n], n);
	const $input = pick(input, '$input');
	const fn = new Function('$', '$input', '$json', node(wf, name).parameters.jsCode);
	return fn($, $input, input[0] && input[0].json);
}

const ROUTER_NODES = [
	'Discord Trigger',
	'Route Event',
	'Classify',
	'Lookup Command',
	'Load Config',
	'Decide',
	'Route',
	'Refuse',
	'Refuse Autocomplete',
	'Unknown Command',
	'Has Sync ID',
	'Run Sync',
	'Unknown Component',
	'Open Modal',
	'Defer Command',
	'Defer Update',
	'Workflow Input',
	'Run Command',
	'Format',
	'Edit Mode',
	'Edit Original',
	'Edit Original With File',
	'Edit Failed',
	'Send Followups',
	'Create Followup Message',
	'Command Error',
	'Update Error',
	'Autocomplete Input',
	'Run Autocomplete',
	'Autocomplete Result',
	'Load Bot Config',
	'Filter Message',
	'Lookup Listeners',
	'Listener Input',
	'Run Listener',
];

const ALLOWED_TYPES = {
	'CUSTOM.discord': 1,
	'CUSTOM.discordTrigger': 1,
	'n8n-nodes-base.code': 2,
	'n8n-nodes-base.dataTable': 1.1,
	'n8n-nodes-base.executeWorkflow': 1.4,
	'n8n-nodes-base.executeWorkflowTrigger': 1.3,
	'n8n-nodes-base.httpRequest': 4.2,
	'n8n-nodes-base.if': 2.3,
	'n8n-nodes-base.manualTrigger': 1,
	'n8n-nodes-base.n8n': 1,
	'n8n-nodes-base.scheduleTrigger': 1.2,
	'n8n-nodes-base.set': 3.5,
	'n8n-nodes-base.stopAndError': 1,
	'n8n-nodes-base.switch': 3.4,
};

const TOKEN_RE = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/;

describe('inlineCode', () => {
	const files = {
		'lib/a.js': "function a() {}\r\nif (typeof module !== 'undefined') module.exports = { a };\r\n",
		'lib/b.js': 'function b() {}',
	};
	const read = (p) => {
		if (!(p in files)) throw new Error('missing ' + p);
		return files[p];
	};
	it('replaces the first-line placeholder with the listed sources in order', () => {
		const out = inlineCode('//@inline lib/a.js lib/b.js\nreturn a();', read);
		expect(out.indexOf('function a() {}')).toBeLessThan(out.indexOf('function b() {}'));
		expect(out.endsWith('\nreturn a();')).toBe(true);
		expect(out).not.toContain('//@inline');
	});
	it('drops the module.exports guard and CR characters', () => {
		const out = inlineCode('//@inline lib/a.js\nreturn 1;', read);
		expect(out).not.toContain('module.exports');
		expect(out).not.toContain('\r');
	});
	it('leaves code without a placeholder unchanged', () => {
		expect(inlineCode('return 1;', read)).toBe('return 1;');
	});
	it('throws for a missing file', () => {
		expect(() => inlineCode('//@inline lib/nope.js\nreturn 1;', read)).toThrow('lib/nope.js');
	});
	it('throws for a placeholder that is not on the first line', () => {
		expect(() => inlineCode('const x = 1;\n//@inline lib/a.js', read)).toThrow(/first line/);
	});
	it('throws for an empty placeholder', () => {
		expect(() => inlineCode('//@inline\nreturn 1;', read)).toThrow(/no files/);
	});
});

describe('built workflows', () => {
	it('builds the core templates and the command templates', () => {
		expect(Object.keys(built).sort()).toEqual(
			[
				'command-template',
				'commands/changelog',
				'commands/cl',
				'commands/parse',
				'commands/preview',
				'commands/prompt',
				'commands/sync',
				'helpers/clickup-get-task',
				'listeners/sync-mirror',
				'reload-commands',
				'router',
				'sync',
			].sort(),
		);
		expect(TEMPLATE_NAMES.slice().sort()).toEqual(Object.keys(built).sort());
	});

	it('have the contract workflow names', () => {
		expect(built.router.name).toBe('Discord Router');
		expect(built.sync.name).toBe('Discord Sync');
		expect(built['command-template'].name).toBe('Discord Command: ping');
		expect(built['reload-commands'].name).toBe('Discord Command: reload-commands');
		expect(built['commands/parse'].name).toBe('Discord Command: parse');
		expect(built['commands/preview'].name).toBe('Discord Command: preview');
		expect(built['commands/cl'].name).toBe('Discord Command: cl');
		expect(built['commands/changelog'].name).toBe('Discord Command: changelog');
		expect(built['commands/prompt'].name).toBe('Discord Command: prompt');
		expect(built['helpers/clickup-get-task'].name).toBe('Discord Helper: ClickUp Get Task');
		expect(built['commands/sync'].name).toBe('Discord Command: sync');
		expect(built['listeners/sync-mirror'].name).toBe('Discord Listener: Sync Mirror');
	});

	it('built workflows contain no //@inline lines', () => {
		for (const wf of Object.values(built)) {
			expect(JSON.stringify(wf)).not.toContain('//@inline');
		}
	});

	it("every Code node's jsCode compiles", () => {
		for (const wf of Object.values(built)) {
			for (const n of codeNodes(wf)) {
				expect(() => new Function(n.parameters.jsCode), wf.name + ' / ' + n.name).not.toThrow();
			}
		}
	});

	it('every Code node is JavaScript with a mode set', () => {
		for (const wf of Object.values(built)) {
			for (const n of codeNodes(wf)) {
				expect(n.parameters.language).toBe('javaScript');
				expect(['runOnceForAllItems', 'runOnceForEachItem']).toContain(n.parameters.mode);
			}
		}
	});

	it('router node names match the contract list', () => {
		expect(built.router.nodes.map((n) => n.name)).toEqual(ROUTER_NODES);
	});

	it('node names are unique and connections point at existing nodes', () => {
		for (const wf of Object.values(built)) {
			const names = wf.nodes.map((n) => n.name);
			expect(new Set(names).size, wf.name).toBe(names.length);
			for (const [from, conn] of Object.entries(wf.connections)) {
				expect(names, wf.name + ' source ' + from).toContain(from);
				for (const output of conn.main) {
					for (const c of output || []) {
						expect(names, wf.name + ' target ' + c.node).toContain(c.node);
						expect(c.type).toBe('main');
					}
				}
			}
		}
	});

	it('every node but the triggers has an incoming connection', () => {
		for (const wf of Object.values(built)) {
			const incoming = new Set();
			for (const conn of Object.values(wf.connections)) {
				for (const output of conn.main) for (const c of output || []) incoming.add(c.node);
			}
			for (const n of wf.nodes) {
				if (/[Tt]rigger$/.test(n.type)) continue;
				expect(incoming.has(n.name), wf.name + ' / ' + n.name).toBe(true);
			}
		}
	});

	it('uses only known node types at the pinned versions, with ids and positions', () => {
		for (const wf of Object.values(built)) {
			for (const n of wf.nodes) {
				expect(Object.keys(ALLOWED_TYPES), n.name).toContain(n.type);
				expect(n.typeVersion, n.name).toBe(ALLOWED_TYPES[n.type]);
				expect(n.id).toMatch(/^[0-9a-f-]{36}$/);
				expect(n.position).toHaveLength(2);
			}
			expect(wf.settings.executionOrder).toBe('v1');
		}
	});

	it('templates contain no credential IDs or tokens', () => {
		for (const name of TEMPLATE_NAMES) {
			expect(templateText(name)).not.toMatch(TOKEN_RE);
		}
		for (const wf of Object.values(built)) {
			expect(JSON.stringify(wf)).not.toMatch(TOKEN_RE);
			for (const n of wf.nodes) {
				for (const cred of Object.values(n.credentials || {})) {
					expect(cred, n.name).not.toHaveProperty('id');
					expect(
						[
							'Discord Bot (live)',
							'n8n API',
							...parseCredentialList(process.env.CLICKUP_CREDENTIALS),
						],
						n.name,
					).toContain(cred.name);
				}
			}
		}
	});

	it('every Discord node uses the Discord Bot (live) credential', () => {
		for (const wf of Object.values(built)) {
			for (const n of wf.nodes.filter((x) => x.type.startsWith('CUSTOM.'))) {
				expect(n.credentials, n.name).toEqual({
					discordGatewayBotApi: { name: 'Discord Bot (live)' },
				});
			}
		}
	});
});

describe('command workflows', () => {
	it('command-template carries the discord-command tag and a Command Definition node', () => {
		const wf = built['command-template'];
		expect(wf.tags.map((t) => t.name)).toContain('discord-command');
		const def = node(wf, 'Command Definition');
		expect(def.type).toBe('n8n-nodes-base.set');
		expect(def.parameters.mode).toBe('raw');
		const parsed = parseDefinition(def.parameters.jsonOutput);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual({ name: 'ping', description: 'Check that the bot answers' });
		expect(wf.nodes.map((n) => n.name)).toEqual([
			'When called by another workflow',
			'Command Definition',
			'Switch on mode',
			'Reply',
		]);
		expect(JSON.parse(node(wf, 'Reply').parameters.jsonOutput)).toEqual({ content: 'pong' });
	});

	it('command-template switches on all four modes', () => {
		const wf = built['command-template'];
		const rules = node(wf, 'Switch on mode').parameters.rules.values;
		expect(rules.map((r) => r.outputKey)).toEqual([
			'command',
			'autocomplete',
			'component',
			'modal',
		]);
		expect(targets(wf, 'Switch on mode', 0)).toEqual(['Reply']);
	});

	it('reload-commands is an ephemeral owner-only command that runs the sync', () => {
		const wf = built['reload-commands'];
		expect(wf.tags.map((t) => t.name)).toContain('discord-command');
		const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
		expect(parsed.definition).toEqual({
			name: 'reload-commands',
			description: 'Re-register all bot commands',
			scope: 'global',
			contexts: [0, 1, 2],
			integration_types: [0, 1],
			ephemeral: true,
		});
		const run = node(wf, 'Run Sync');
		expect(run.parameters.options.waitForSubWorkflow).toBe(true);
		expect(run.parameters.workflowId.value).toBe('={{ $json.value }}');
	});

	it('sub-workflow triggers accept all data', () => {
		for (const name of ['command-template', 'reload-commands', 'sync']) {
			expect(node(built[name], 'When called by another workflow').parameters.inputSource).toBe(
				'passthrough',
			);
		}
	});

	it('reload-commands Reply builds the message from the sync report', () => {
		const out = runCode(built['reload-commands'], 'Reply', {
			input: [{ json: { registered: 3, global: 2, globalSkipped: false, skipped: [], guilds: ['g'] } }],
		});
		expect(out).toEqual([{ json: { content: 'Registered 3 server commands and 2 global commands.' } }]);
		const one = runCode(built['reload-commands'], 'Reply', {
			input: [{ json: { registered: 1, global: 1, globalSkipped: false, skipped: [], guilds: ['g'] } }],
		});
		expect(one[0].json.content).toBe('Registered 1 server command and 1 global command.');
		const off = runCode(built['reload-commands'], 'Reply', {
			input: [{ json: { registered: 3, global: 2, globalSkipped: true, skipped: [], guilds: ['g'] } }],
		});
		expect(off[0].json.content).toBe(
			'Registered 3 server commands; 2 global commands skipped (registerGlobal is off).',
		);
	});
});

describe('parse command', () => {
	const wf = built['commands/parse'];
	const FENCE = '`'.repeat(3);
	const NL = String.fromCharCode(10);
	const attachmentInput = {
		interaction: {
			options: { logfile: '7' },
			resolved: {
				attachments: {
					7: { url: 'https://cdn.example/Player.log', filename: 'Player.log', size: 42 },
				},
			},
		},
	};
	const triggerNodes = { 'When called by another workflow': [{ json: attachmentInput }] };

	it('is a tagged discord-command with the recipe definition', () => {
		expect(wf.tags.map((t) => t.name)).toEqual(['discord-command']);
		const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual({
			name: 'parse',
			description: 'Parse Log',
			options: [{ type: 11, name: 'logfile', description: 'Unity Player.Log', required: true }],
			ephemeral: false,
			scope: 'global',
			contexts: [0, 1, 2],
			integration_types: [0, 1],
			whitelist: { everyone: true, users: [], roles: [] },
		});
	});

	it('wires command mode through attachment, download, parse and the mode switch', () => {
		expect(targets(wf, 'Switch on mode', 0)).toEqual(['Attachment']);
		expect(targets(wf, 'Attachment')).toEqual(['Has File']);
		expect(targets(wf, 'Has File', 0)).toEqual(['Download']);
		expect(targets(wf, 'Has File', 1)).toEqual(['Reply Error']);
		expect(targets(wf, 'Download', 0)).toEqual(['Parse']);
		expect(targets(wf, 'Download', 1)).toEqual(['Reply Download Error']);
		expect(targets(wf, 'Parse')).toEqual(['Mode']);
		expect(targets(wf, 'Mode', 0)).toEqual(['Reply']);
		expect(targets(wf, 'Mode', 1)).toEqual(['Reply File']);
	});

	it('downloads the attachment as text without authentication and continues on error', () => {
		const d = node(wf, 'Download');
		expect(d.parameters).toMatchObject({
			method: 'GET',
			url: '={{ $json.url }}',
			authentication: 'none',
		});
		expect(d.parameters.options.response.response).toEqual({
			responseFormat: 'text',
			outputPropertyName: 'log',
		});
		expect(d.onError).toBe('continueErrorOutput');
		expect(JSON.parse(node(wf, 'Reply Download Error').parameters.jsonOutput)).toEqual({
			content: 'Could not load the log file attachment.',
		});
	});

	it('has no Discord nodes', () => {
		expect(wf.nodes.filter((n) => n.type.startsWith('CUSTOM.'))).toEqual([]);
	});

	it('Attachment reads the url from interaction.resolved', () => {
		expect(runCode(wf, 'Attachment', { nodes: triggerNodes })).toEqual([
			{ json: { url: 'https://cdn.example/Player.log', filename: 'Player.log', size: 42 } },
		]);
	});

	it('Attachment passes the size error on to Reply Error', () => {
		const big = {
			interaction: {
				options: { logfile: '7' },
				resolved: { attachments: { 7: { url: 'u', filename: 'a.log', size: 30 * 1024 * 1024 } } },
			},
		};
		const out = runCode(wf, 'Attachment', {
			nodes: { 'When called by another workflow': [{ json: big }] },
		});
		expect(out).toEqual([
			{
				json: {
					error:
						'That log file is too large to parse (30.0 MB, limit 20 MB). Upload a smaller or trimmed log.',
				},
			},
		]);
	});

	it('Attachment reports a missing attachment', () => {
		const out = runCode(wf, 'Attachment', {
			nodes: {
				'When called by another workflow': [
					{ json: { interaction: { options: { logfile: '7' }, resolved: {} } } },
				],
			},
		});
		expect(out).toEqual([{ json: { error: 'Could not load the log file attachment.' } }]);
	});

	it('Parse builds embeds for a small log', () => {
		const log = ['XException: bad', '  at A.B () in x:0', 'next'].join(NL);
		const [item] = runCode(wf, 'Parse', {
			nodes: { Attachment: [{ json: { url: 'u', filename: 'Player.log', size: 42 } }] },
			input: [{ json: { log } }],
		});
		expect(item.json).toEqual({
			mode: 'embeds',
			content: "Loaded log file 'Player.log' (42 bytes). Exceptions Count:1",
			embeds: [
				{
					title: 'XException: bad',
					color: 10038562,
					description: FENCE + '  at A.B () in x:0' + FENCE,
				},
			],
		});
		expect(item.binary).toBeUndefined();
	});

	it('Parse attaches exceptions.log as base64 text for a big log', () => {
		const log = Array.from(
			{ length: 25 },
			(_, i) => 'XException: e' + i + NL + '  at A.B () in x:' + i,
		).join(NL);
		const [item] = runCode(wf, 'Parse', {
			nodes: { Attachment: [{ json: { url: 'u', filename: 'Player.log', size: log.length } }] },
			input: [{ json: { log } }],
		});
		expect(item.json).toEqual({ mode: 'file', content: 'There are 25 exceptions in the log.' });
		expect(item.binary.file).toMatchObject({ mimeType: 'text/plain', fileName: 'exceptions.log' });
		const text = Buffer.from(item.binary.file.data, 'base64').toString('utf8');
		expect(
			text.startsWith(['XException: e0', '  at A.B () in x:0', '', '', 'XException: e1'].join(NL)),
		).toBe(true);
		expect(text.split('XException').length - 1).toBe(25);
	});

	it('Parse does not crash when the download produced no text', () => {
		const [item] = runCode(wf, 'Parse', {
			nodes: { Attachment: [{ json: { url: 'u', filename: 'a.png', size: 1 } }] },
			input: [{ json: {} }],
		});
		expect(item.json.embeds).toEqual([]);
	});

	it('Reply File keeps the binary file and passes only the content', () => {
		const binary = { file: { data: 'QQ==', mimeType: 'text/plain', fileName: 'exceptions.log' } };
		const [item] = runCode(wf, 'Reply File', {
			input: [{ json: { mode: 'file', content: 'c' }, binary }],
		});
		expect(item.json).toEqual({ content: 'c' });
		expect(item.binary).toEqual(binary);
	});
});

describe('router', () => {
	const wf = built.router;

	it('trigger listens to every event with manual intents and the owner placeholder', () => {
		const t = node(wf, 'Discord Trigger');
		expect(t.parameters).toMatchObject({
			event: '*',
			autoCalculateIntents: false,
			intents: ['GUILDS', 'GUILD_MESSAGES', 'MESSAGE_CONTENT'],
			includeBotMessages: true,
			emitRawPayload: false,
			alertUserId: '__OWNER_ID__',
			alertAfterMinutes: 10,
		});
		expect(t.notes).toContain('__OWNER_ID__');
		expect(t.notes).toContain('discord_config');
		expect(t.notes).toContain('ownerId');
	});

	it('Route Event sends interactions to Classify and messages to Load Bot Config, with no fallback', () => {
		const p = node(wf, 'Route Event').parameters;
		expect(p.rules.values.map((r) => r.outputKey)).toEqual(['interaction', 'message']);
		expect(p.options.fallbackOutput).toBeUndefined();
		expect(targets(wf, 'Route Event', 0)).toEqual(['Classify']);
		expect(targets(wf, 'Route Event', 1)).toEqual(['Load Bot Config']);
		expect(wf.connections['Route Event'].main).toHaveLength(2);
	});

	it('Route has one output per decideRoute route, wired to its lane', () => {
		const lanes = {
			refuse: 'Refuse',
			refuseAutocomplete: 'Refuse Autocomplete',
			unknownCommand: 'Unknown Command',
			unknownComponent: 'Unknown Component',
			openModal: 'Open Modal',
			deferCommand: 'Defer Command',
			autocomplete: 'Autocomplete Input',
			deferUpdate: 'Defer Update',
		};
		const rules = node(wf, 'Route').parameters.rules.values;
		expect(rules.map((r) => r.outputKey).sort()).toEqual(Object.keys(lanes).sort());
		rules.forEach((r, i) => {
			expect(r.conditions.conditions[0].rightValue).toBe(r.outputKey);
			expect(targets(wf, 'Route', i)).toEqual([lanes[r.outputKey]]);
		});
	});

	it('Edit Mode has one output per formatResult action', () => {
		const lanes = {
			edit: 'Edit Original',
			editWithFile: 'Edit Original With File',
			skip: 'Send Followups',
			commandError: 'Command Error',
			updateError: 'Update Error',
		};
		const rules = node(wf, 'Edit Mode').parameters.rules.values;
		expect(rules.map((r) => r.outputKey)).toEqual(Object.keys(lanes));
		rules.forEach((r, i) => expect(targets(wf, 'Edit Mode', i)).toEqual([lanes[r.outputKey]]));
		expect(targets(wf, 'Edit Original')).toEqual(['Send Followups']);
		expect(targets(wf, 'Edit Original With File')).toEqual(['Send Followups']);
		expect(targets(wf, 'Send Followups')).toEqual(['Create Followup Message']);
	});

	it('defers before running the command workflow', () => {
		expect(targets(wf, 'Defer Command')).toEqual(['Workflow Input']);
		expect(targets(wf, 'Defer Update')).toEqual(['Workflow Input']);
		expect(targets(wf, 'Workflow Input')).toEqual(['Run Command']);
		expect(targets(wf, 'Run Command')).toEqual(['Format']);
		expect(targets(wf, 'Format')).toEqual(['Edit Mode']);
		expect(node(wf, 'Defer Command').parameters.responseType).toBe(5);
		expect(node(wf, 'Defer Update').parameters.responseType).toBe(6);
	});

	it('Run Command waits, always outputs data and keeps errors on the regular output', () => {
		const run = node(wf, 'Run Command');
		expect(run.parameters.options.waitForSubWorkflow).toBe(true);
		expect(run.alwaysOutputData).toBe(true);
		expect(run.onError).toBe('continueRegularOutput');
		expect(run.parameters.workflowId).toMatchObject({ __rl: true, mode: 'id' });
	});

	it('listeners and the sync run without waiting', () => {
		expect(node(wf, 'Run Listener').parameters.options.waitForSubWorkflow).toBe(false);
		expect(node(wf, 'Run Listener').parameters.mode).toBe('each');
		expect(node(wf, 'Run Listener').onError).toBe('continueRegularOutput');
		expect(node(wf, 'Run Sync').parameters.options.waitForSubWorkflow).toBe(false);
		expect(node(wf, 'Run Sync').parameters.workflowId.value).toContain('syncWorkflowId');
		expect(targets(wf, 'Unknown Command')).toEqual(['Has Sync ID']);
		expect(targets(wf, 'Has Sync ID', 0)).toEqual(['Run Sync']);
		expect(targets(wf, 'Has Sync ID', 1)).toEqual([]);
		const cond = node(wf, 'Has Sync ID').parameters.conditions.conditions[0];
		expect(cond.leftValue).toBe("={{ $('Decide').first().json.syncWorkflowId }}");
		expect(cond.operator).toMatchObject({ type: 'string', operation: 'notEmpty' });
	});

	it('a failed edit goes to the error reply of its lane', () => {
		for (const name of ['Edit Original', 'Edit Original With File']) {
			expect(node(wf, name).onError, name).toBe('continueErrorOutput');
			expect(targets(wf, name, 0), name).toEqual(['Send Followups']);
			expect(targets(wf, name, 1), name).toEqual(['Edit Failed']);
		}
		const rules = node(wf, 'Edit Failed').parameters.rules.values;
		expect(rules.map((r) => r.outputKey)).toEqual(['deferCommand', 'deferUpdate']);
		expect(rules[0].conditions.conditions[0].leftValue).toBe(
			"={{ $('Decide').first().json.route }}",
		);
		expect(targets(wf, 'Edit Failed', 0)).toEqual(['Command Error']);
		expect(targets(wf, 'Edit Failed', 1)).toEqual(['Update Error']);
		for (const name of ['Command Error', 'Update Error']) {
			expect(node(wf, name).parameters.content).toBe("={{ $('Format').first().json.errorText }}");
		}
	});

	it('refusal copy matches the global constraints and is ephemeral', () => {
		const copy = {
			Refuse: "You're not allowed to use this.",
			'Unknown Command': 'This command is not available right now.',
			'Unknown Component': 'This action is no longer available.',
		};
		for (const [name, text] of Object.entries(copy)) {
			const p = node(wf, name).parameters;
			expect(p).toMatchObject({
				operation: 'createInitialCallback',
				responseType: 4,
				content: text,
				flags: 64,
			});
		}
		expect(node(wf, 'Refuse Autocomplete').parameters).toMatchObject({
			responseType: 8,
			choices: '[]',
		});
	});

	it('every interaction response node takes its id and token from Classify', () => {
		for (const n of wf.nodes.filter((x) => x.parameters.resource === 'interactionResponse')) {
			expect(n.parameters.interactionToken, n.name).toContain("$('Classify')");
			if (n.parameters.operation === 'createInitialCallback') {
				expect(n.parameters.interactionId, n.name).toContain("$('Classify')");
			} else {
				expect(n.parameters.applicationId, n.name).toContain("$('Classify')");
			}
		}
	});

	it('Edit Original With File attaches binary file', () => {
		expect(node(wf, 'Edit Original With File').parameters.attachments).toEqual({
			attachment: [{ binaryPropertyName: 'file' }],
		});
	});

	const raw = {
		id: '1',
		type: 2,
		token: 'tok',
		application_id: 'app',
		guild_id: 'g1',
		channel_id: 'c1',
		member: { user: { id: 'owner' }, roles: [] },
		data: { name: 'ping' },
	};

	it('Classify and Decide route an owner /ping to deferCommand', () => {
		const classified = runCode(wf, 'Classify', {
			input: [{ json: { event: 'INTERACTION_CREATE', data: raw } }],
		});
		expect(classified.json).toMatchObject({
			kind: 'command',
			commandName: 'ping',
			userId: 'owner',
		});
		const out = runCode(wf, 'Decide', {
			nodes: {
				Classify: [classified],
				'Lookup Command': [
					{
						json: {
							name: 'ping',
							workflowId: 'wfPing',
							definition: '{"name":"ping","description":"P"}',
						},
					},
				],
			},
			input: [
				{ json: { key: 'ownerId', value: 'owner' } },
				{ json: { key: 'syncWorkflowId', value: 'wfSync' } },
			],
		});
		expect(out).toHaveLength(1);
		expect(out[0].json).toMatchObject({
			route: 'deferCommand',
			workflowId: 'wfPing',
			ephemeral: false,
			syncWorkflowId: 'wfSync',
			classified: { commandName: 'ping' },
		});
	});

	it('Decide treats the empty lookup item as an unknown command', () => {
		const classified = runCode(wf, 'Classify', { input: [{ json: { data: raw } }] });
		const out = runCode(wf, 'Decide', {
			nodes: { Classify: [classified], 'Lookup Command': [{ json: {} }] },
			input: [{ json: {} }],
		});
		expect(out[0].json.route).toBe('unknownCommand');
		expect(out[0].json.syncWorkflowId).toBe('');
	});

	it('Decide ignores a lookup row for a different command', () => {
		const classified = runCode(wf, 'Classify', { input: [{ json: { data: raw } }] });
		const out = runCode(wf, 'Decide', {
			nodes: {
				Classify: [classified],
				'Lookup Command': [
					{
						json: {
							name: 'other',
							workflowId: 'wfX',
							definition: '{"name":"other","description":"O"}',
						},
					},
				],
			},
			input: [{ json: { key: 'ownerId', value: 'owner' } }],
		});
		expect(out[0].json.route).toBe('unknownCommand');
	});

	it('Lookup Command filters on the command name and always outputs data', () => {
		const n = node(wf, 'Lookup Command');
		expect(n.parameters.filters.conditions).toEqual([
			{ keyName: 'name', condition: 'eq', keyValue: "={{ $json.commandName || '' }}" },
		]);
		expect(n.parameters.dataTableId).toEqual({
			__rl: true,
			mode: 'name',
			value: 'discord_commands',
		});
		expect(n.parameters.limit).toBe(1);
		expect(n.alwaysOutputData).toBe(true);
	});

	it('input nodes inline only the workflowInput module', () => {
		for (const name of ['Workflow Input', 'Autocomplete Input']) {
			const js = node(wf, name).parameters.jsCode;
			expect(js, name).toContain('function workflowInput');
			expect(js, name).not.toContain('toDiscordMessage');
			expect(js, name).not.toContain('formatResult');
		}
	});

	it('Filter Message reads the message branch of Route Event explicitly', () => {
		expect(node(wf, 'Filter Message').parameters.jsCode).toContain("$('Route Event').first(1)");
	});

	it('Workflow Input passes mode and interaction', () => {
		const classified = { kind: 'component', commandName: 'x' };
		const out = runCode(wf, 'Workflow Input', {
			nodes: { Decide: [{ json: { classified } }] },
			input: [{ json: {} }],
		});
		expect(out).toEqual([{ json: { mode: 'component', interaction: classified } }]);
	});

	it('Format keeps the binary file and the raw result for Send Followups', () => {
		const decision = { route: 'deferCommand', ephemeral: false, classified: { commandName: 'x' } };
		const file = { data: 'AAAA', fileName: 'a.txt' };
		const out = runCode(wf, 'Format', {
			nodes: { Decide: [{ json: decision }] },
			input: [{ json: { content: 'got it', followups: [{ content: 'one' }] }, binary: { file } }],
		});
		expect(out).toHaveLength(1);
		expect(out[0].json.action).toBe('editWithFile');
		expect(out[0].json.errorText).toBe(
			'Something went wrong running /x. The details are in the n8n execution log.',
		);
		expect(out[0].json.message.content).toBe('got it');
		expect(out[0].binary).toEqual({ file });
		const followups = runCode(wf, 'Send Followups', {
			nodes: { Format: out },
			input: [{ json: {} }],
		});
		expect(followups).toEqual([{ json: { content: 'one', embeds: [], components: [], flags: 0 } }]);
	});

	it('Autocomplete Result sends at most 25 choices', () => {
		const choices = node(wf, 'Autocomplete Result').parameters.choices;
		expect(choices).toContain('slice(0, 25)');
		expect(node(wf, 'Autocomplete Result').executeOnce).toBe(true);
		expect(node(wf, 'Run Autocomplete').alwaysOutputData).toBe(true);
	});

	it('Filter Message and Listener Input hand each listener the event and message', () => {
		const message = { id: 'm1', author: { id: 'u1' } };
		const filtered = runCode(wf, 'Filter Message', {
			nodes: { 'Route Event': [{ json: { event: 'MESSAGE_CREATE', data: message } }] },
			input: [{ json: { key: 'botUserId', value: 'bot' } }],
		});
		expect(filtered).toEqual([{ json: { event: 'create', message } }]);
		const inputs = runCode(wf, 'Listener Input', {
			nodes: { 'Filter Message': filtered },
			input: [{ json: { event: 'create', workflowId: 'wfL', name: 'Echo' } }],
		});
		expect(inputs).toEqual([
			{ json: { event: 'create', message, listener: { name: 'Echo', workflowId: 'wfL' } } },
		]);
		expect(node(wf, 'Run Listener').parameters.workflowId.value).toBe(
			'={{ $json.listener.workflowId }}',
		);
	});

	it('Filter Message drops the bot own message', () => {
		const out = runCode(wf, 'Filter Message', {
			nodes: {
				'Route Event': [
					{ json: { event: 'MESSAGE_CREATE', data: { id: 'm', author: { id: 'bot' } } } },
				],
			},
			input: [{ json: { key: 'botUserId', value: 'bot' } }],
		});
		expect(out).toEqual([]);
	});
});

describe('sync', () => {
	const wf = built.sync;

	it('has the node chain from the brief', () => {
		expect(wf.nodes.map((n) => n.name)).toEqual([
			'When called by another workflow',
			'Manual Trigger',
			'Get Workflows',
			'Build',
			'Has Errors',
			'Stop and Error',
			'Load Config',
			'Get Application',
			'Global',
			'Global Enabled',
			'Register Global',
			'Guilds',
			'Register',
			'Replace Table',
			'Has Rows',
			'Table Rows',
			'Insert Rows',
			'Report',
		]);
		expect(targets(wf, 'When called by another workflow')).toEqual(['Get Workflows']);
		expect(targets(wf, 'Manual Trigger')).toEqual(['Get Workflows']);
		expect(targets(wf, 'Has Errors', 0)).toEqual(['Stop and Error']);
		expect(targets(wf, 'Has Errors', 1)).toEqual(['Load Config']);
		expect(targets(wf, 'Has Rows', 0)).toEqual(['Table Rows']);
		expect(targets(wf, 'Has Rows', 1)).toEqual(['Report']);
		expect(targets(wf, 'Insert Rows')).toEqual(['Report']);
		expect(targets(wf, 'Load Config')).toEqual(['Get Application']);
		expect(targets(wf, 'Get Application')).toEqual(['Global']);
		expect(targets(wf, 'Global')).toEqual(['Global Enabled']);
		expect(targets(wf, 'Global Enabled', 0)).toEqual(['Register Global']);
		expect(targets(wf, 'Global Enabled', 1)).toEqual(['Guilds']);
		expect(targets(wf, 'Register Global')).toEqual(['Guilds']);
		expect(targets(wf, 'Guilds')).toEqual(['Register']);
		expect(targets(wf, 'Register')).toEqual(['Replace Table']);
	});

	it('Load Config reads guildIds and registerGlobal, and the application is read once', () => {
		const p = node(wf, 'Load Config').parameters;
		expect(p.matchType).toBe('anyCondition');
		expect(p.returnAll).toBe(true);
		expect(p.limit).toBeUndefined();
		expect(p.filters.conditions.map((c) => [c.keyName, c.condition, c.keyValue])).toEqual([
			['key', 'eq', 'guildIds'],
			['key', 'eq', 'registerGlobal'],
		]);
		expect(node(wf, 'Get Application').executeOnce).toBe(true);
	});

	it('overwrites the global list only behind Global Enabled', () => {
		const n = node(wf, 'Register Global');
		expect(n.parameters).toEqual({
			authentication: 'bot',
			resource: 'applicationCommand',
			operation: 'bulkOverwriteGlobal',
			applicationId: '={{ $json.applicationId }}',
			payload: '={{ JSON.stringify($json.commands) }}',
		});
		expect(n.credentials).toEqual({ discordGatewayBotApi: { name: 'Discord Bot (live)' } });
		expect(n.alwaysOutputData).toBe(true);
		const cond = node(wf, 'Global Enabled').parameters.conditions;
		expect(cond.conditions).toHaveLength(1);
		expect(cond.conditions[0].leftValue).toBe('={{ $json.registerGlobal }}');
		expect(cond.conditions[0].operator).toMatchObject({ type: 'boolean', operation: 'true' });
		const globalOps = wf.nodes.filter(
			(x) => x.parameters.resource === 'applicationCommand' && /Global/.test(x.parameters.operation),
		);
		expect(globalOps.map((x) => x.name)).toEqual(['Register Global']);
		expect(node(wf, 'Global').parameters.mode).toBe('runOnceForAllItems');
	});

	it('reads tagged workflows through the n8n API credential', () => {
		const n = node(wf, 'Get Workflows');
		expect(n.parameters).toMatchObject({
			resource: 'workflow',
			operation: 'getAll',
			returnAll: true,
		});
		expect(n.parameters.filters.tags).toBe('discord-command');
		expect(n.credentials).toEqual({ n8nApi: { name: 'n8n API' } });
		expect(n.alwaysOutputData).toBe(true);
	});

	it('registers per guild with a JSON string payload', () => {
		const p = node(wf, 'Register').parameters;
		expect(p).toMatchObject({ resource: 'applicationCommand', operation: 'bulkOverwriteGuild' });
		expect(p.payload).toBe('={{ JSON.stringify($json.commands) }}');
		expect(node(wf, 'Replace Table').executeOnce).toBe(true);
		expect(node(wf, 'Replace Table').alwaysOutputData).toBe(true);
	});

	it('Build, Guilds, Global and Report work on API-shaped data', () => {
		const def = {
			name: 'Command Definition',
			parameters: { jsonOutput: '{"name":"ping","description":"P"}' },
		};
		const globalText = JSON.stringify({
			name: 'preview',
			description: 'V',
			scope: 'global',
			whitelist: { everyone: true, users: [], roles: [] },
		});
		const globalDef = { name: 'Command Definition', parameters: { jsonOutput: globalText } };
		const builtOut = runCode(wf, 'Build', {
			input: [
				{
					json: {
						id: 'w1',
						name: 'Discord Command: ping',
						active: true,
						activeVersion: { nodes: [def] },
					},
				},
				{ json: { id: 'w2', name: 'Discord Command: draft', active: true, nodes: [def] } },
				{
					json: {
						id: 'w3',
						name: 'Discord Command: preview',
						active: true,
						activeVersion: { nodes: [globalDef] },
					},
				},
			],
		});
		const previewCommand = {
			name: 'preview',
			description: 'V',
			contexts: [0, 1, 2],
			integration_types: [0, 1],
		};
		expect(builtOut[0].json).toMatchObject({
			guildCommands: [{ name: 'ping', description: 'P' }],
			globalCommands: [previewCommand],
			errors: [],
			skipped: ['Discord Command: draft: no published version'],
		});
		expect(builtOut[0].json.table).toEqual([
			{ name: 'ping', workflowId: 'w1', definition: '{"name":"ping","description":"P"}' },
			{ name: 'preview', workflowId: 'w3', definition: globalText },
		]);
		const config = (registerGlobal) => [
			{ json: { key: 'guildIds', value: '["g1","g2"]' } },
			...(registerGlobal === undefined
				? []
				: [{ json: { key: 'registerGlobal', value: registerGlobal } }]),
		];
		const guilds = runCode(wf, 'Guilds', {
			nodes: {
				Build: builtOut,
				'Load Config': config('true'),
				'Get Application': [{ json: { id: 'app1' } }],
			},
			input: [{ json: { id: 'app1' } }],
		});
		expect(guilds.map((g) => g.json)).toEqual([
			{ guildId: 'g1', applicationId: 'app1', commands: [{ name: 'ping', description: 'P' }] },
			{ guildId: 'g2', applicationId: 'app1', commands: [{ name: 'ping', description: 'P' }] },
		]);
		const globalOut = (registerGlobal) =>
			runCode(wf, 'Global', {
				nodes: {
					Build: builtOut,
					'Load Config': config(registerGlobal),
					'Get Application': [{ json: { id: 'app1' } }],
				},
				input: [{ json: {} }, { json: {} }],
			});
		expect(globalOut('true')).toEqual([
			{ json: { registerGlobal: true, applicationId: 'app1', commands: [previewCommand] } },
		]);
		expect(globalOut('false')[0].json.registerGlobal).toBe(false);
		expect(globalOut(undefined)[0].json.registerGlobal).toBe(false);
		const rows = runCode(wf, 'Table Rows', { nodes: { Build: builtOut }, input: [{ json: {} }] });
		expect(rows.map((r) => r.json)).toEqual(builtOut[0].json.table);
		const report = (registerGlobal) =>
			runCode(wf, 'Report', {
				nodes: { Build: builtOut, Guilds: guilds, Global: globalOut(registerGlobal) },
				input: [{ json: {} }],
			});
		expect(report('true')).toEqual([
			{
				json: {
					registered: 1,
					global: 1,
					globalSkipped: false,
					skipped: ['Discord Command: draft: no published version'],
					guilds: ['g1', 'g2'],
				},
			},
		]);
		expect(report(undefined)[0].json).toMatchObject({ registered: 1, global: 1, globalSkipped: true });
	});

	it('Build reports invalid definitions in the abort message', () => {
		const bad = {
			name: 'Command Definition',
			parameters: { jsonOutput: '{"name":"Bad","description":"P"}' },
		};
		const out = runCode(wf, 'Build', {
			input: [
				{
					json: {
						id: 'w1',
						name: 'Discord Command: bad',
						active: true,
						activeVersion: { nodes: [bad] },
					},
				},
			],
		});
		expect(out[0].json.errors.length).toBeGreaterThan(0);
		expect(out[0].json.abortMessage.startsWith('Sync aborted:\nDiscord Command: bad: name')).toBe(
			true,
		);
		expect(node(wf, 'Stop and Error').parameters.errorMessage).toBe('={{ $json.abortMessage }}');
	});

	it('Build aborts when no discord-command workflow was found', () => {
		const out = runCode(wf, 'Build', { input: [{ json: {} }] });
		expect(out[0].json.errors).toEqual(['no discord-command workflows found']);
		expect(out[0].json.abortMessage).toBe('Sync aborted:\nno discord-command workflows found');
	});

	it('Guilds fails loudly without a guildIds row', () => {
		expect(() =>
			runCode(wf, 'Guilds', {
				nodes: {
					Build: [{ json: { guildCommands: [], globalCommands: [] } }],
					'Load Config': [{ json: {} }],
					'Get Application': [{ json: { id: 'a' } }],
				},
				input: [{ json: {} }],
			}),
		).toThrow('guildIds');
	});
});

describe('preview command', () => {
	const wf = built['commands/preview'];
	const run = (url) =>
		runCode(wf, 'Rewrite', {
			nodes: {
				'When called by another workflow': [
					{ json: { mode: 'command', interaction: { options: { url } } } },
				],
			},
		});

	it('is a tagged discord-command with the recipe definition', () => {
		expect(wf.tags.map((t) => t.name)).toEqual(['discord-command']);
		const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual({
			name: 'preview',
			description: 'Replaces url with variant supporting discord embeds',
			options: [
				{
					type: 3,
					name: 'url',
					description: 'The URL to convert for Discord embed support',
					required: true,
				},
			],
			ephemeral: false,
			scope: 'global',
			contexts: [0, 1, 2],
			integration_types: [0, 1],
			whitelist: { everyone: true, users: [], roles: [] },
		});
	});

	it('wires command mode to Rewrite, which is the end of the branch', () => {
		expect(targets(wf, 'Switch on mode', 0)).toEqual(['Rewrite']);
		expect(targets(wf, 'Rewrite')).toEqual([]);
	});

	it('has no Discord nodes and no unresolved inline marker', () => {
		expect(wf.nodes.filter((n) => n.type.startsWith('CUSTOM.'))).toEqual([]);
		expect(node(wf, 'Rewrite').parameters.jsCode).not.toContain('//@inline');
	});

	it('Rewrite returns the result shape for each recipe case', () => {
		expect(run('https://x.com/user/status/1')).toEqual([
			{ json: { content: 'https://fxtwitter.com/user/status/1' } },
		]);
		expect(run('https://www.instagram.com/p/abc/')).toEqual([
			{ json: { content: 'https://vxinstagram.com/p/abc/' } },
		]);
		expect(run('look at this https://twitter.com/a/status/2 lol')).toEqual([
			{ json: { content: 'https://fxtwitter.com/a/status/2' } },
		]);
		expect(run('https://netflix.com/x')).toEqual([
			{ json: { content: 'No supported domain found in the URL.' } },
		]);
		expect(run('not a url')).toEqual([
			{ json: { content: 'No supported domain found in the URL.' } },
		]);
		expect(run('')).toEqual([{ json: { content: 'Please provide a URL.' } }]);
	});
});

describe('ClickUp credential list', () => {
	it('defaults to ClickUp (Client)', () => {
		expect(DEFAULT_CLICKUP_CREDENTIALS).toEqual(['ClickUp (Client)']);
		expect(parseCredentialList(undefined)).toEqual(['ClickUp (Client)']);
		expect(parseCredentialList('')).toEqual(['ClickUp (Client)']);
		expect(parseCredentialList(' ; ')).toEqual(['ClickUp (Client)']);
	});
	it('splits on ; and trims', () => {
		expect(parseCredentialList('ClickUp (A); ClickUp (B) ;ClickUp (C);')).toEqual([
			'ClickUp (A)',
			'ClickUp (B)',
			'ClickUp (C)',
		]);
	});
	it('rejects duplicates', () => {
		expect(() => parseCredentialList('A;B;A')).toThrow(/duplicate/i);
	});
});

describe('ClickUp helper', () => {
	const tpl = JSON.parse(templateText('helpers/clickup-get-task'));
	const chainOf = (names) => buildWorkflow(tpl, () => '', { clickupCredentials: names });
	const wf = built['helpers/clickup-get-task'];
	const TRIGGER = 'When called by another workflow';

	it('is not a discord-command and takes taskId', () => {
		expect(wf.tags || []).toEqual([]);
		const trigger = node(wf, TRIGGER);
		expect(trigger.parameters.inputSource).toBe('workflowInputs');
		expect(trigger.parameters.workflowInputs.values.map((v) => v.name)).toEqual(['taskId']);
	});

	it('the template holds one prototype Try node', () => {
		expect(tpl.nodes.map((n) => n.name).filter((n) => n.startsWith('Try '))).toEqual([
			'Try ClickUp',
		]);
		expect(node(tpl, 'Try ClickUp').notes).toContain('CLICKUP_CREDENTIALS');
	});

	it('expands to one Try node by default', () => {
		const tries = wf.nodes.filter((n) => n.name.startsWith('Try '));
		expect(tries.map((n) => n.name)).toEqual(['Try ClickUp (Client)']);
		expect(wf.nodes.find((n) => n.name === 'Try ClickUp')).toBeUndefined();
		expect(tries[0].credentials).toEqual({ clickUpApi: { name: 'ClickUp (Client)' } });
		expect(targets(wf, TRIGGER)).toEqual(['Try ClickUp (Client)']);
		expect(targets(wf, 'Try ClickUp (Client)', 0)).toEqual(['Build Embed']);
		expect(targets(wf, 'Try ClickUp (Client)', 1)).toEqual(['Not Found']);
	});

	it('Try is a plain GET with the predefined ClickUp credential and an error output', () => {
		const t = node(wf, 'Try ClickUp (Client)');
		expect(t.type).toBe('n8n-nodes-base.httpRequest');
		expect(t.onError).toBe('continueErrorOutput');
		expect(t.parameters.method).toBe('GET');
		expect(t.parameters.url).toBe(
			'=https://api.clickup.com/api/v2/task/{{ encodeURIComponent($json.taskId) }}',
		);
		expect(t.parameters.authentication).toBe('predefinedCredentialType');
		expect(t.parameters.nodeCredentialType).toBe('clickUpApi');
		expect(JSON.stringify(t.parameters)).not.toMatch(/authorization/i);
	});

	it('chains three credentials in order, later ones reading the trigger', () => {
		const c = chainOf(['ClickUp (A)', 'ClickUp (B)', 'ClickUp (C)']);
		const names = c.nodes.map((n) => n.name).filter((n) => n.startsWith('Try '));
		expect(names).toEqual(['Try ClickUp (A)', 'Try ClickUp (B)', 'Try ClickUp (C)']);
		expect(new Set(c.nodes.map((n) => n.id)).size).toBe(c.nodes.length);
		expect(targets(c, TRIGGER)).toEqual(['Try ClickUp (A)']);
		expect(targets(c, 'Try ClickUp (A)', 0)).toEqual(['Build Embed']);
		expect(targets(c, 'Try ClickUp (A)', 1)).toEqual(['Try ClickUp (B)']);
		expect(targets(c, 'Try ClickUp (B)', 0)).toEqual(['Build Embed']);
		expect(targets(c, 'Try ClickUp (B)', 1)).toEqual(['Try ClickUp (C)']);
		expect(targets(c, 'Try ClickUp (C)', 0)).toEqual(['Build Embed']);
		expect(targets(c, 'Try ClickUp (C)', 1)).toEqual(['Not Found']);
		const url = (n) => node(c, n).parameters.url;
		expect(url('Try ClickUp (A)')).toContain('$json.taskId');
		for (const n of ['Try ClickUp (B)', 'Try ClickUp (C)']) {
			expect(url(n)).toBe(
				"=https://api.clickup.com/api/v2/task/{{ encodeURIComponent($('When called by another workflow').first().json.taskId) }}",
			);
		}
		for (const [n, cred] of [
			['Try ClickUp (A)', 'ClickUp (A)'],
			['Try ClickUp (B)', 'ClickUp (B)'],
			['Try ClickUp (C)', 'ClickUp (C)'],
		]) {
			expect(node(c, n).credentials).toEqual({ clickUpApi: { name: cred } });
			expect(node(c, n).onError).toBe('continueErrorOutput');
		}
	});

	it('expansion is pure and rejects bad input', () => {
		const before = JSON.stringify(tpl);
		expandClickupChain(tpl, ['X']);
		expect(JSON.stringify(tpl)).toBe(before);
		expect(() => expandClickupChain(tpl, [])).toThrow(/at least one/);
		expect(() => expandClickupChain({ name: 'n', nodes: [], connections: {} }, ['X'])).toThrow(
			/Try ClickUp/,
		);
	});

	it('Build Embed returns found and the embed', () => {
		const out = runCode(wf, 'Build Embed', {
			input: [
				{ json: { name: 'T', description: 'D', status: { status: 'open' }, url: 'https://u' } },
			],
		});
		expect(out.json.found).toBe(true);
		expect(out.json.embed.title).toBe('T');
		expect(out.json.embed.fields[0]).toEqual({ name: 'Status', value: 'open' });
	});

	it('Not Found returns { found: false } and ends the chain', () => {
		const nf = node(wf, 'Not Found');
		expect(nf.type).toBe('n8n-nodes-base.set');
		expect(JSON.parse(nf.parameters.jsonOutput)).toEqual({ found: false });
		expect(targets(wf, 'Not Found')).toEqual([]);
		expect(targets(wf, 'Build Embed')).toEqual([]);
	});

	it('keeps tokens and Authorization out of the helper', () => {
		const text = JSON.stringify(wf);
		expect(text).not.toMatch(/authorization/i);
		expect(text).not.toMatch(/pk_\d/);
	});
});

describe('cl command', () => {
	const wf = built['commands/cl'];
	const TRIGGER = 'When called by another workflow';
	const extract = (link) =>
		runCode(wf, 'Extract ID', {
			nodes: { [TRIGGER]: [{ json: { mode: 'command', interaction: { options: { link } } } }] },
		});

	it('is a tagged discord-command with the recipe definition', () => {
		expect(wf.tags.map((t) => t.name)).toEqual(['discord-command']);
		const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual({
			name: 'cl',
			description: 'Generates Clickup Embed',
			options: [{ type: 3, name: 'link', description: 'link for Clickup', required: true }],
			ephemeral: false,
			whitelist: { users: [], roles: [] },
		});
	});

	it('wires command -> Extract ID -> Has ID -> Load Helper Id -> Is Configured -> Get Task -> Reply', () => {
		expect(targets(wf, 'Switch on mode', 0)).toEqual(['Extract ID']);
		expect(targets(wf, 'Extract ID')).toEqual(['Has ID']);
		expect(targets(wf, 'Has ID', 0)).toEqual(['Load Helper Id']);
		expect(targets(wf, 'Has ID', 1)).toEqual(['Reply Error']);
		expect(targets(wf, 'Load Helper Id')).toEqual(['Is Configured']);
		expect(targets(wf, 'Is Configured', 0)).toEqual(['Get Task']);
		expect(targets(wf, 'Is Configured', 1)).toEqual(['Reply Not Configured']);
		expect(targets(wf, 'Reply Not Configured')).toEqual([]);
		expect(targets(wf, 'Get Task')).toEqual(['Reply']);
		expect(targets(wf, 'Reply')).toEqual([]);
		expect(targets(wf, 'Reply Error')).toEqual([]);
	});

	it('Load Helper Id reads clickupHelperWorkflowId from discord_config', () => {
		const n = node(wf, 'Load Helper Id');
		expect(n.type).toBe('n8n-nodes-base.dataTable');
		expect(n.parameters.dataTableId.value).toBe('discord_config');
		expect(n.parameters.filters.conditions).toEqual([
			{ keyName: 'key', condition: 'eq', keyValue: 'clickupHelperWorkflowId' },
		]);
	});

	it('replies clearly when the helper id row is missing or empty', () => {
		const cond = node(wf, 'Is Configured').parameters.conditions.conditions[0];
		expect(cond.leftValue).toBe("={{ $json.value || '' }}");
		expect(cond.operator).toMatchObject({ type: 'string', operation: 'notEmpty' });
		const expr = node(wf, 'Reply Not Configured').parameters.jsonOutput;
		expect(expr).toContain(
			"ClickUp lookup isn't configured (discord_config row clickupHelperWorkflowId is missing).",
		);
	});

	it('Get Task calls the helper by the configured id, waits, and passes taskId', () => {
		const n = node(wf, 'Get Task');
		expect(n.type).toBe('n8n-nodes-base.executeWorkflow');
		expect(n.parameters.source).toBe('database');
		expect(n.parameters.workflowId.mode).toBe('id');
		expect(n.parameters.workflowId.value).toBe("={{ $('Load Helper Id').first().json.value }}");
		expect(n.parameters.options.waitForSubWorkflow).toBe(true);
		expect(n.parameters.workflowInputs.value).toEqual({
			taskId: "={{ $('Extract ID').first().json.taskId }}",
		});
		expect(n.onError).toBe('continueRegularOutput');
	});

	it('Extract ID handles the recipe cases', () => {
		expect(extract('https://app.clickup.com/t/86abc123')).toEqual([
			{ json: { taskId: '86abc123' } },
		]);
		expect(extract('https://app.clickup.com/t/86abc123).')).toEqual([
			{ json: { taskId: '86abc123' } },
		]);
		expect(extract('https://app.clickup.com/t/123/DEV-42?x=1')).toEqual([
			{ json: { taskId: 'DEV-42' } },
		]);
		expect(extract('https://example.com/abc123')).toEqual([{ json: { taskId: 'abc123' } }]);
		expect(extract('hello')).toEqual([
			{ json: { reply: { content: 'Could not fetch ClickUp task.' } } },
		]);
		expect(extract('')).toEqual([{ json: { reply: { content: 'No link provided.' } } }]);
		expect(extract(undefined)).toEqual([{ json: { reply: { content: 'No link provided.' } } }]);
	});

	it('Has ID tests taskId for non-empty and Reply Error emits the reply', () => {
		const cond = node(wf, 'Has ID').parameters.conditions.conditions[0];
		expect(cond.leftValue).toBe("={{ $json.taskId || '' }}");
		expect(cond.operator).toMatchObject({ type: 'string', operation: 'notEmpty' });
		expect(node(wf, 'Reply Error').parameters.jsonOutput).toBe(
			'={{ JSON.stringify($json.reply) }}',
		);
	});

	it('Reply returns the embed, or the error text', () => {
		const embed = { title: 'T' };
		expect(runCode(wf, 'Reply', { input: [{ json: { found: true, embed } }] })).toEqual([
			{ json: { embeds: [embed] } },
		]);
		expect(runCode(wf, 'Reply', { input: [{ json: { found: false } }] })).toEqual([
			{ json: { content: 'Could not fetch ClickUp task.' } },
		]);
		expect(runCode(wf, 'Reply', { input: [] })).toEqual([
			{ json: { content: 'Could not fetch ClickUp task.' } },
		]);
		expect(runCode(wf, 'Reply', { input: [{ json: { key: 'x', value: '' } }] })).toEqual([
			{ json: { content: 'Could not fetch ClickUp task.' } },
		]);
	});

	it('has no Discord nodes and no unresolved inline marker', () => {
		expect(wf.nodes.filter((n) => n.type.startsWith('CUSTOM.'))).toEqual([]);
		for (const n of codeNodes(wf)) expect(n.parameters.jsCode).not.toContain('//@inline');
	});
});

describe('changelog command', () => {
	const wf = built['commands/changelog'];
	const TRIGGER = 'When called by another workflow';
	const build = (options, value = 'https://hook.example/') =>
		runCode(wf, 'Build URL', {
			nodes: { [TRIGGER]: [{ json: { mode: 'command', interaction: { options } } }] },
			input: [{ json: { key: 'webhookBase', value } }],
		});

	it('is a tagged discord-command with the recipe definition', () => {
		expect(wf.tags.map((t) => t.name)).toEqual(['discord-command']);
		const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual({
			name: 'changelog',
			description: 'Fetch changelog for a specific build',
			options: [
				{
					type: 3,
					name: 'buildid',
					description: 'The Build ID to fetch changelog for',
					required: true,
				},
				{
					type: 5,
					name: 'skipai',
					description: 'Do you want to skip AI translation',
					required: false,
				},
			],
			ephemeral: true,
			whitelist: { users: [], roles: [] },
		});
	});

	it('wires command -> Load Config -> Build URL -> Has Hook -> Call Hook -> Reply OK / Reply Failed', () => {
		expect(targets(wf, 'Switch on mode', 0)).toEqual(['Load Config']);
		expect(targets(wf, 'Load Config')).toEqual(['Build URL']);
		expect(targets(wf, 'Build URL')).toEqual(['Has Hook']);
		expect(targets(wf, 'Call Hook', 0)).toEqual(['Reply OK']);
		expect(targets(wf, 'Call Hook', 1)).toEqual(['Reply Failed']);
		expect(targets(wf, 'Reply OK')).toEqual([]);
		expect(targets(wf, 'Reply Failed')).toEqual([]);
	});

	it('Load Config reads webhookBase from discord_config', () => {
		const n = node(wf, 'Load Config');
		expect(n.type).toBe('n8n-nodes-base.dataTable');
		expect(n.parameters.dataTableId.value).toBe('discord_config');
		expect(n.parameters.filters.conditions).toEqual([
			{ keyName: 'key', condition: 'eq', keyValue: 'webhookBase' },
		]);
		expect(n.notes).toContain('http://localhost:5678');
	});

	it('Call Hook is an unauthenticated GET returning text, 60s timeout, error output', () => {
		const n = node(wf, 'Call Hook');
		expect(n.type).toBe('n8n-nodes-base.httpRequest');
		expect(n.parameters.method).toBe('GET');
		expect(n.parameters.url).toBe('={{ $json.url }}');
		expect(n.parameters.authentication ?? 'none').toBe('none');
		expect(n.credentials).toBeUndefined();
		expect(n.parameters.options.response.response.responseFormat).toBe('text');
		expect(n.parameters.options.timeout).toBe(60000);
		expect(n.onError).toBe('continueErrorOutput');
	});

	it('Build URL maps the three skipai cases and encodes the build id', () => {
		const url = (b) => build(b)[0].json.url;
		const head = 'https://hook.example/webhook/hg-build-hook?BuildID=';
		expect(url({ buildid: '905' })).toBe(`${head}905`);
		expect(url({ buildid: '905', skipai: true })).toBe(`${head}905&SkipAI=True`);
		expect(url({ buildid: '905', skipai: false })).toBe(`${head}905&SkipAI=`);
		expect(url({ buildid: 'a b&c' })).toBe(`${head}a%20b%26c`);
		expect(url({ buildid: '900-905' })).toBe(`${head}900-905`);
	});

	it('Build URL gives an empty url when webhookBase is missing, so Call Hook fails to the error reply', () => {
		const r = runCode(wf, 'Build URL', {
			nodes: { [TRIGGER]: [{ json: { interaction: { options: { buildid: '1' } } } }] },
			input: [{ json: {} }],
		});
		expect(r).toEqual([{ json: { url: '' } }]);
	});

	it('routes an empty url to a clear reply without calling the hook', () => {
		const cond = node(wf, 'Has Hook').parameters.conditions.conditions[0];
		expect(cond.leftValue).toBe("={{ $json.url || '' }}");
		expect(cond.operator).toMatchObject({ type: 'string', operation: 'notEmpty' });
		expect(targets(wf, 'Build URL')).toEqual(['Has Hook']);
		expect(targets(wf, 'Has Hook', 0)).toEqual(['Call Hook']);
		expect(targets(wf, 'Has Hook', 1)).toEqual(['Reply Not Configured']);
		expect(targets(wf, 'Reply Not Configured')).toEqual([]);
		expect(node(wf, 'Reply Not Configured').parameters.jsonOutput).toContain(
			"Changelog hook isn't configured (discord_config row webhookBase is missing).",
		);
	});

	it('Reply OK says the request was sent', () => {
		expect(node(wf, 'Reply OK').parameters.jsonOutput).toContain('Asked backend for changelog');
	});

	it('Reply Failed reads status or message from the error output', () => {
		const reply = (error) => runCode(wf, 'Reply Failed', { input: [{ json: { error } }] });
		expect(reply({ httpCode: '404', message: 'x' })).toEqual([
			{ json: { content: 'Failed to fetch changelog. Status: 404' } },
		]);
		expect(reply({ message: 'ENOTFOUND' })).toEqual([
			{ json: { content: 'Error fetching changelog: ENOTFOUND' } },
		]);
	});

	it('has no Discord nodes, no credentials and no unresolved inline marker', () => {
		expect(wf.nodes.filter((n) => n.type.startsWith('CUSTOM.'))).toEqual([]);
		expect(wf.nodes.filter((n) => n.credentials)).toEqual([]);
		for (const n of codeNodes(wf)) expect(n.parameters.jsCode).not.toContain('//@inline');
	});
});

describe('prompt command', () => {
	const wf = built['commands/prompt'];
	const TRIGGER = 'When called by another workflow';
	const build = (options, value = 'https://hook.example/') =>
		runCode(wf, 'Build URL', {
			nodes: { [TRIGGER]: [{ json: { mode: 'command', interaction: { options } } }] },
			input: [{ json: { key: 'webhookBase', value } }],
		});

	it('is a tagged discord-command, global, open to everyone, public', () => {
		expect(wf.tags.map((t) => t.name)).toEqual(['discord-command']);
		const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
		expect(parsed.ok).toBe(true);
		expect(parsed.definition).toEqual({
			name: 'prompt',
			description: 'Send a prompt to the AI',
			options: [
				{ type: 3, name: 'prompt', description: 'What to ask', required: true },
				{
					type: 3,
					name: 'preset',
					description: 'How to answer (leave empty for the default)',
					required: false,
					choices: [
						{ name: 'Copy back (no AI)', value: 'copy' },
						{ name: 'Final Fantasy XIV helper', value: 'ffxiv' },
						{ name: 'Hotel Galactic assistant', value: 'hg' },
						{ name: 'Smart (Gemini Pro)', value: 'smart' },
						{ name: 'Steam discussions', value: 'steam' },
						{ name: 'Bug report → JIRA ticket', value: 'aom' },
						{ name: 'Board task summary', value: 'tasks' },
						{ name: 'What game to play', value: 'game' },
						{ name: 'Archi (creative writing, PL)', value: 'archi' },
					],
				},
			],
			ephemeral: false,
			scope: 'global',
			contexts: [0, 1, 2],
			integration_types: [0, 1],
			whitelist: { everyone: true, users: [], roles: [] },
		});
	});

	it('wires command -> Load Config -> Build URL -> Has Hook -> Ask AI -> Reply / Reply Failed', () => {
		expect(targets(wf, 'Switch on mode', 0)).toEqual(['Load Config']);
		expect(targets(wf, 'Load Config')).toEqual(['Build URL']);
		expect(targets(wf, 'Build URL')).toEqual(['Has Hook']);
		expect(targets(wf, 'Has Hook', 0)).toEqual(['Ask AI']);
		expect(targets(wf, 'Has Hook', 1)).toEqual(['Reply Not Configured']);
		expect(targets(wf, 'Ask AI', 0)).toEqual(['Reply']);
		expect(targets(wf, 'Ask AI', 1)).toEqual(['Reply Failed']);
		for (const n of ['Reply', 'Reply Failed', 'Reply Not Configured'])
			expect(targets(wf, n)).toEqual([]);
	});

	it('Load Config reads webhookBase from discord_config', () => {
		const n = node(wf, 'Load Config');
		expect(n.type).toBe('n8n-nodes-base.dataTable');
		expect(n.parameters.dataTableId.value).toBe('discord_config');
		expect(n.parameters.filters.conditions).toEqual([
			{ keyName: 'key', condition: 'eq', keyValue: 'webhookBase' },
		]);
	});

	it('Ask AI is an unauthenticated GET returning text, 600s timeout, error output', () => {
		const n = node(wf, 'Ask AI');
		expect(n.type).toBe('n8n-nodes-base.httpRequest');
		expect(n.parameters.method).toBe('GET');
		expect(n.parameters.url).toBe('={{ $json.url }}');
		expect(n.parameters.authentication ?? 'none').toBe('none');
		expect(n.credentials).toBeUndefined();
		expect(n.parameters.options.response.response.responseFormat).toBe('text');
		expect(n.parameters.options.timeout).toBe(600000);
		expect(n.onError).toBe('continueErrorOutput');
	});

	it('Build URL encodes the prompt and adds the preset only when given', () => {
		const head = 'https://hook.example/webhook/gemini-hook?prompt=';
		expect(build({ prompt: 'hi' })[0].json.url).toBe(`${head}hi`);
		expect(build({ prompt: 'a&b #c? 😀 zażółć', preset: 'hg' })[0].json.url).toBe(
			`${head}${encodeURIComponent('a&b #c? 😀 zażółć')}&preset=hg`,
		);
	});

	it('Build URL gives an empty url when webhookBase is missing', () => {
		const r = runCode(wf, 'Build URL', {
			nodes: { [TRIGGER]: [{ json: { interaction: { options: { prompt: 'x' } } } }] },
			input: [{ json: {} }],
		});
		expect(r).toEqual([{ json: { url: '' } }]);
	});

	it('routes an empty url to a clear reply without calling the hook', () => {
		const cond = node(wf, 'Has Hook').parameters.conditions.conditions[0];
		expect(cond.leftValue).toBe("={{ $json.url || '' }}");
		expect(cond.operator).toMatchObject({ type: 'string', operation: 'notEmpty' });
		expect(node(wf, 'Reply Not Configured').parameters.jsonOutput).toContain(
			"Prompt hook isn't configured (discord_config row webhookBase is missing).",
		);
	});

	it('Reply builds content, embeds and followups from the body', () => {
		const reply = (body) => runCode(wf, 'Reply', { input: [{ json: { body } }] })[0].json;
		expect(reply('hello')).toEqual({ content: 'hello', embeds: [], followups: [] });
		expect(reply('')).toMatchObject({ content: '(empty response)' });
		expect(reply('w '.repeat(2500)).followups.length).toBeGreaterThanOrEqual(2);
		const json = reply(JSON.stringify({ Text: 'hi', Embeds: ['a', 'b'] }));
		expect(json.embeds).toEqual([{ description: 'a' }, { description: 'b' }]);
	});

	it('Reply Failed reads status or message from the error output', () => {
		const reply = (error) => runCode(wf, 'Reply Failed', { input: [{ json: { error } }] });
		expect(reply({ httpCode: '500' })).toEqual([
			{ json: { content: 'Failed to get an AI response. Status: 500' } },
		]);
		expect(reply({ message: 'ENOTFOUND' })).toEqual([
			{ json: { content: 'Error contacting the AI service: ENOTFOUND' } },
		]);
	});

	it('has no Discord nodes, no credentials and no unresolved inline marker', () => {
		expect(wf.nodes.filter((n) => n.type.startsWith('CUSTOM.'))).toEqual([]);
		expect(wf.nodes.filter((n) => n.credentials)).toEqual([]);
		for (const n of codeNodes(wf)) {
			expect(n.parameters.jsCode).not.toContain('//@inline');
			expect(n.parameters.jsCode).not.toContain('new URL');
		}
	});
});

describe('writeAll', () => {
	it('writes one importable JSON file per template', () => {
		const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-dist-'));
		const files = writeAll(BOT_DIR, out);
		expect(files.map((f) => path.relative(out, f).split(path.sep).join('/')).sort()).toEqual([
			'command-template.json',
			'commands/changelog.json',
			'commands/cl.json',
			'commands/parse.json',
			'commands/preview.json',
			'commands/prompt.json',
			'commands/sync.json',
			'helpers/clickup-get-task.json',
			'listeners/sync-mirror.json',
			'reload-commands.json',
			'router.json',
			'sync.json',
		]);
		for (const f of files) {
			const wf = JSON.parse(fs.readFileSync(f, 'utf8'));
			expect(wf).toHaveProperty('nodes');
			expect(wf).toHaveProperty('connections');
		}
		fs.rmSync(out, { recursive: true, force: true });
	});
});
