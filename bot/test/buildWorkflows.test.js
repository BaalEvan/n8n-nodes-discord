import { describe, it, expect } from 'vitest';
import { inlineCode, buildAll, writeAll, TEMPLATE_NAMES } from '../build-workflows.mjs';
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
	'n8n-nodes-base.set': 3.5,
	'n8n-nodes-base.stopAndError': 1,
	'n8n-nodes-base.switch': 3.4,
};

const TOKEN_RE = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/;

describe('inlineCode', () => {
	const files = { 'lib/a.js': 'function a() {}\r\nif (typeof module !== \'undefined\') module.exports = { a };\r\n', 'lib/b.js': 'function b() {}' };
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
			['command-template', 'commands/parse', 'commands/preview', 'reload-commands', 'router', 'sync'].sort(),
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
					expect(['Discord Bot (live)', 'n8n API'], n.name).toContain(cred.name);
				}
			}
		}
	});

	it('every Discord node uses the Discord Bot (live) credential', () => {
		for (const wf of Object.values(built)) {
			for (const n of wf.nodes.filter((x) => x.type.startsWith('CUSTOM.'))) {
				expect(n.credentials, n.name).toEqual({ discordGatewayBotApi: { name: 'Discord Bot (live)' } });
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
		expect(rules.map((r) => r.outputKey)).toEqual(['command', 'autocomplete', 'component', 'modal']);
		expect(targets(wf, 'Switch on mode', 0)).toEqual(['Reply']);
	});

	it('reload-commands is an ephemeral owner-only command that runs the sync', () => {
		const wf = built['reload-commands'];
		expect(wf.tags.map((t) => t.name)).toContain('discord-command');
		const parsed = parseDefinition(node(wf, 'Command Definition').parameters.jsonOutput);
		expect(parsed.definition).toEqual({
			name: 'reload-commands',
			description: 'Re-register all bot commands',
			ephemeral: true,
		});
		const run = node(wf, 'Run Sync');
		expect(run.parameters.options.waitForSubWorkflow).toBe(true);
		expect(run.parameters.workflowId.value).toBe('={{ $json.value }}');
	});

	it('sub-workflow triggers accept all data', () => {
		for (const name of ['command-template', 'reload-commands', 'sync']) {
			expect(node(built[name], 'When called by another workflow').parameters.inputSource).toBe('passthrough');
		}
	});

	it('reload-commands Reply builds the message from the sync report', () => {
		const out = runCode(built['reload-commands'], 'Reply', {
			input: [{ json: { registered: 3, skipped: [], guilds: ['g'] } }],
		});
		expect(out).toEqual([{ json: { content: 'Registered 3 commands.' } }]);
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
				attachments: { 7: { url: 'https://cdn.example/Player.log', filename: 'Player.log', size: 42 } },
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
			whitelist: { users: [], roles: [] },
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
				{ title: 'XException: bad', color: 10038562, description: FENCE + '  at A.B () in x:0' + FENCE },
			],
		});
		expect(item.binary).toBeUndefined();
	});

	it('Parse attaches exceptions.log as base64 text for a big log', () => {
		const log = Array.from({ length: 25 }, (_, i) => 'XException: e' + i + NL + '  at A.B () in x:' + i).join(NL);
		const [item] = runCode(wf, 'Parse', {
			nodes: { Attachment: [{ json: { url: 'u', filename: 'Player.log', size: log.length } }] },
			input: [{ json: { log } }],
		});
		expect(item.json).toEqual({ mode: 'file', content: 'There are 25 exceptions in the log.' });
		expect(item.binary.file).toMatchObject({ mimeType: 'text/plain', fileName: 'exceptions.log' });
		const text = Buffer.from(item.binary.file.data, 'base64').toString('utf8');
		expect(text.startsWith(['XException: e0', '  at A.B () in x:0', '', '', 'XException: e1'].join(NL))).toBe(true);
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
		expect(rules[0].conditions.conditions[0].leftValue).toBe("={{ $('Decide').first().json.route }}");
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
			expect(p).toMatchObject({ operation: 'createInitialCallback', responseType: 4, content: text, flags: 64 });
		}
		expect(node(wf, 'Refuse Autocomplete').parameters).toMatchObject({ responseType: 8, choices: '[]' });
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
		const classified = runCode(wf, 'Classify', { input: [{ json: { event: 'INTERACTION_CREATE', data: raw } }] });
		expect(classified.json).toMatchObject({ kind: 'command', commandName: 'ping', userId: 'owner' });
		const out = runCode(wf, 'Decide', {
			nodes: {
				Classify: [classified],
				'Lookup Command': [
					{ json: { name: 'ping', workflowId: 'wfPing', definition: '{"name":"ping","description":"P"}' } },
				],
			},
			input: [{ json: { key: 'ownerId', value: 'owner' } }, { json: { key: 'syncWorkflowId', value: 'wfSync' } }],
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
				'Lookup Command': [{ json: { name: 'other', workflowId: 'wfX', definition: '{"name":"other","description":"O"}' } }],
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
		expect(n.parameters.dataTableId).toEqual({ __rl: true, mode: 'name', value: 'discord_commands' });
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
		const out = runCode(wf, 'Workflow Input', { nodes: { Decide: [{ json: { classified } }] }, input: [{ json: {} }] });
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
		const followups = runCode(wf, 'Send Followups', { nodes: { Format: out }, input: [{ json: {} }] });
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
		expect(node(wf, 'Run Listener').parameters.workflowId.value).toBe('={{ $json.listener.workflowId }}');
	});

	it('Filter Message drops the bot own message', () => {
		const out = runCode(wf, 'Filter Message', {
			nodes: { 'Route Event': [{ json: { event: 'MESSAGE_CREATE', data: { id: 'm', author: { id: 'bot' } } } }] },
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
	});

	it('reads tagged workflows through the n8n API credential', () => {
		const n = node(wf, 'Get Workflows');
		expect(n.parameters).toMatchObject({ resource: 'workflow', operation: 'getAll', returnAll: true });
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

	it('Build, Guilds and Report work on API-shaped data', () => {
		const def = { name: 'Command Definition', parameters: { jsonOutput: '{"name":"ping","description":"P"}' } };
		const builtOut = runCode(wf, 'Build', {
			input: [
				{ json: { id: 'w1', name: 'Discord Command: ping', active: true, activeVersion: { nodes: [def] } } },
				{ json: { id: 'w2', name: 'Discord Command: draft', active: true, nodes: [def] } },
			],
		});
		expect(builtOut[0].json).toMatchObject({
			commands: [{ name: 'ping', description: 'P' }],
			errors: [],
			skipped: ['Discord Command: draft: no published version'],
		});
		expect(builtOut[0].json.table).toEqual([
			{ name: 'ping', workflowId: 'w1', definition: '{"name":"ping","description":"P"}' },
		]);
		const guilds = runCode(wf, 'Guilds', {
			nodes: {
				Build: builtOut,
				'Load Config': [{ json: { key: 'guildIds', value: '["g1","g2"]' } }],
				'Get Application': [{ json: { id: 'app1' } }],
			},
			input: [{ json: { id: 'app1' } }],
		});
		expect(guilds.map((g) => g.json)).toEqual([
			{ guildId: 'g1', applicationId: 'app1', commands: [{ name: 'ping', description: 'P' }] },
			{ guildId: 'g2', applicationId: 'app1', commands: [{ name: 'ping', description: 'P' }] },
		]);
		const rows = runCode(wf, 'Table Rows', { nodes: { Build: builtOut }, input: [{ json: {} }] });
		expect(rows).toEqual([{ json: builtOut[0].json.table[0] }]);
		const report = runCode(wf, 'Report', { nodes: { Build: builtOut, Guilds: guilds }, input: [{ json: {} }] });
		expect(report).toEqual([
			{ json: { registered: 1, skipped: ['Discord Command: draft: no published version'], guilds: ['g1', 'g2'] } },
		]);
	});

	it('Build reports invalid definitions in the abort message', () => {
		const bad = { name: 'Command Definition', parameters: { jsonOutput: '{"name":"Bad","description":"P"}' } };
		const out = runCode(wf, 'Build', {
			input: [{ json: { id: 'w1', name: 'Discord Command: bad', active: true, activeVersion: { nodes: [bad] } } }],
		});
		expect(out[0].json.errors.length).toBeGreaterThan(0);
		expect(out[0].json.abortMessage.startsWith('Sync aborted:\nDiscord Command: bad: name')).toBe(true);
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
				nodes: { Build: [{ json: { commands: [] } }], 'Load Config': [{ json: {} }], 'Get Application': [{ json: { id: 'a' } }] },
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
			whitelist: { users: [], roles: [] },
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

describe('writeAll', () => {
	it('writes one importable JSON file per template', () => {
		const out = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-dist-'));
		const files = writeAll(BOT_DIR, out);
		expect(files.map((f) => path.relative(out, f).split(path.sep).join('/')).sort()).toEqual([
			'command-template.json',
			'commands/parse.json',
			'commands/preview.json',
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
