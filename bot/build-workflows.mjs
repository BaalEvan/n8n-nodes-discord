import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CORE_NAMES = ['router', 'sync', 'command-template', 'reload-commands'];

export function commandTemplateNames(botDir) {
	const dir = path.join(botDir, 'workflows', 'commands');
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.template.json'))
		.map((f) => `commands/${f.slice(0, -'.template.json'.length)}`)
		.sort();
}

export function helperTemplateNames(botDir) {
	const dir = path.join(botDir, 'workflows', 'helpers');
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.template.json'))
		.map((f) => `helpers/${f.slice(0, -'.template.json'.length)}`)
		.sort();
}

const BOT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const TEMPLATE_NAMES = [
	...CORE_NAMES,
	...commandTemplateNames(BOT_DIR),
	...helperTemplateNames(BOT_DIR),
];

export const DEFAULT_CLICKUP_CREDENTIALS = ['ClickUp (Client)'];
const TRY_PROTOTYPE = 'Try ClickUp';
const TRIGGER_TASK_ID = "$('When called by another workflow').first().json.taskId";

export function parseCredentialList(raw) {
	const names = String(raw ?? '')
		.split(';')
		.map((n) => n.trim())
		.filter(Boolean);
	if (names.length === 0) return [...DEFAULT_CLICKUP_CREDENTIALS];
	const dup = names.find((n, i) => names.indexOf(n) !== i);
	if (dup) throw new Error(`CLICKUP_CREDENTIALS lists "${dup}" twice (duplicate)`);
	return names;
}

function stableId(seed) {
	const h = crypto.createHash('sha1').update(seed).digest('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function expandClickupChain(template, names) {
	if (!Array.isArray(names) || names.length === 0) {
		throw new Error('expandClickupChain needs at least one credential name');
	}
	const wf = structuredClone(template);
	const proto = wf.nodes.find((n) => n.name === TRY_PROTOTYPE);
	if (!proto) throw new Error(`${wf.name}: no "${TRY_PROTOTYPE}" prototype node`);
	const onSuccess = (wf.connections[TRY_PROTOTYPE]?.main?.[0] ?? []).map((c) => ({ ...c }));
	const onFailure = (wf.connections[TRY_PROTOTYPE]?.main?.[1] ?? []).map((c) => ({ ...c }));
	const tryNames = names.map((n) => `Try ${n}`);
	const clones = names.map((credName, i) => {
		const node = structuredClone(proto);
		node.id = stableId(`${proto.id}:${credName}`);
		node.name = tryNames[i];
		node.position = [proto.position[0], proto.position[1] + i * 180];
		node.credentials = { clickUpApi: { name: credName } };
		if (i > 0) {
			node.parameters.url = node.parameters.url.split('$json.taskId').join(TRIGGER_TASK_ID);
		}
		return node;
	});
	wf.nodes.splice(wf.nodes.indexOf(proto), 1, ...clones);
	delete wf.connections[TRY_PROTOTYPE];
	for (const outputs of Object.values(wf.connections)) {
		for (const branch of outputs.main ?? []) {
			for (const c of branch ?? []) if (c.node === TRY_PROTOTYPE) c.node = tryNames[0];
		}
	}
	names.forEach((_, i) => {
		const failure =
			i + 1 < names.length ? [{ node: tryNames[i + 1], type: 'main', index: 0 }] : onFailure;
		wf.connections[tryNames[i]] = {
			main: [onSuccess.map((c) => ({ ...c })), failure.map((c) => ({ ...c }))],
		};
	});
	return wf;
}

const MARKER = '//@inline';
const EXPORT_GUARD = /^if \(typeof module !== 'undefined'\) module\.exports = .*;[ \t]*$/gm;

export function inlineCode(jsCode, readLib) {
	const lines = jsCode.split('\n');
	lines.forEach((line, i) => {
		if (i > 0 && line.trim().startsWith(MARKER)) {
			throw new Error(`${MARKER} must be on the first line of jsCode (found on line ${i + 1})`);
		}
	});
	if (!lines[0].trim().startsWith(MARKER)) return jsCode;
	const files = lines[0].trim().slice(MARKER.length).trim().split(/\s+/).filter(Boolean);
	if (files.length === 0) throw new Error(`${MARKER} lists no files`);
	const sources = files.map((file) =>
		readLib(file).replace(/\r\n?/g, '\n').replace(EXPORT_GUARD, '').trimEnd(),
	);
	return [...sources, ...lines.slice(1)].join('\n');
}

export function buildWorkflow(template, readLib, options = {}) {
	let wf = structuredClone(template);
	if (wf.nodes.some((n) => n.name === TRY_PROTOTYPE)) {
		wf = expandClickupChain(
			wf,
			options.clickupCredentials ?? parseCredentialList(process.env.CLICKUP_CREDENTIALS),
		);
	}
	for (const node of wf.nodes) {
		if (node.type === 'n8n-nodes-base.code' && typeof node.parameters?.jsCode === 'string') {
			try {
				node.parameters.jsCode = inlineCode(node.parameters.jsCode, readLib);
			} catch (error) {
				throw new Error(`${wf.name} / ${node.name}: ${error.message}`);
			}
		}
	}
	return wf;
}

function libReader(botDir) {
	return (file) => {
		const full = path.resolve(botDir, file);
		if (!full.startsWith(path.resolve(botDir, 'lib') + path.sep)) {
			throw new Error(`${file} is outside bot/lib`);
		}
		if (!fs.existsSync(full)) throw new Error(`${file} not found`);
		return fs.readFileSync(full, 'utf8');
	};
}

export function buildAll(botDir, options = {}) {
	const readLib = libReader(botDir);
	const out = {};
	for (const name of [
		...CORE_NAMES,
		...commandTemplateNames(botDir),
		...helperTemplateNames(botDir),
	]) {
		const file = path.join(botDir, 'workflows', `${name}.template.json`);
		out[name] = buildWorkflow(JSON.parse(fs.readFileSync(file, 'utf8')), readLib, options);
	}
	return out;
}

export function writeAll(botDir, outDir, options = {}) {
	const built = buildAll(botDir, options);
	fs.mkdirSync(outDir, { recursive: true });
	return Object.entries(built).map(([name, wf]) => {
		const file = path.join(outDir, `${name}.json`);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(wf, null, '\t') + '\n');
		return file;
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
	const botDir = path.dirname(fileURLToPath(import.meta.url));
	for (const file of writeAll(botDir, path.join(botDir, 'dist'))) {
		console.log(`wrote ${path.relative(process.cwd(), file)}`);
	}
}
