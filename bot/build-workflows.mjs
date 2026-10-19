import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TEMPLATE_NAMES = ['router', 'sync', 'command-template', 'reload-commands'];

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

export function buildWorkflow(template, readLib) {
	const wf = structuredClone(template);
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

export function buildAll(botDir) {
	const readLib = libReader(botDir);
	const out = {};
	for (const name of TEMPLATE_NAMES) {
		const file = path.join(botDir, 'workflows', `${name}.template.json`);
		out[name] = buildWorkflow(JSON.parse(fs.readFileSync(file, 'utf8')), readLib);
	}
	return out;
}

export function writeAll(botDir, outDir) {
	const built = buildAll(botDir);
	fs.mkdirSync(outDir, { recursive: true });
	return Object.entries(built).map(([name, wf]) => {
		const file = path.join(outDir, `${name}.json`);
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
