import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { parseLog, findAttachment, fileMessage } = loadModule('parseLog');

const meta = { filename: 'Player.log', size: 1234 };
const NL = String.fromCharCode(10);
const FENCE = '`'.repeat(3);
const frame = (i) => `  at Game.Method${i}.Run () [0x00001] in <abc>:${i}`;
const ex = (i, stackLines = 2) =>
	[
		`NullReferenceException: Object reference not set (${i})`,
		...Array.from({ length: stackLines }, (_, k) => frame(k)),
		'some unrelated line',
	].join('\n');

describe('parseLog', () => {
	it('reports 0 exceptions without embeds', () => {
		const r = parseLog('Hello\nWorld\n', meta);
		expect(r).toEqual({
			mode: 'embeds',
			content: "Loaded log file 'Player.log' (1234 bytes). Exceptions Count:0",
			embeds: [],
		});
	});

	it('builds one DarkRed embed per exception with the stack in a code block', () => {
		const text = [ex(1), ex(2), ex(3)].join('\r\n');
		const r = parseLog(text, meta);
		expect(r.mode).toBe('embeds');
		expect(r.content).toBe("Loaded log file 'Player.log' (1234 bytes). Exceptions Count:3");
		expect(r.embeds).toHaveLength(3);
		expect(r.embeds[0]).toEqual({
			title: 'NullReferenceException: Object reference not set (1)',
			color: 10038562,
			description: FENCE + frame(0) + '\n' + frame(1) + FENCE,
		});
	});

	it('omits the description when the stack is empty', () => {
		const r = parseLog('ArgumentException: bad\nnext line', meta);
		expect(r.embeds).toEqual([{ title: 'ArgumentException: bad', color: 10038562 }]);
	});

	it('detects LogException lines', () => {
		const r = parseLog(['plain', 'DebugLogException: x', 'UnityLogException'].join(NL), meta);
		expect(r.embeds.map((e) => e.title)).toEqual(['DebugLogException: x', 'UnityLogException']);
	});

	it('detects prefixed time|level|Exception lines and stack lines', () => {
		const text = '12:00:01|Error|NullReferenceException: boom\n12:00:01|Error|  at A.B () in x:0\n';
		const r = parseLog(text, meta);
		expect(r.embeds).toHaveLength(1);
		expect(r.embeds[0].title).toBe('12:00:01|Error|NullReferenceException: boom');
		expect(r.embeds[0].description).toBe(FENCE + '12:00:01|Error|  at A.B () in x:0' + FENCE);
	});

	it('ignores a stack line without an open exception', () => {
		expect(parseLog('  at A.B () in x:0\n', meta).embeds).toEqual([]);
	});

	it('closes the open exception on a non-stack line', () => {
		const r = parseLog('XException: a\n  at one\nplain\n  at two\n', meta);
		expect(r.embeds).toHaveLength(1);
		expect(r.embeds[0].description).toBe(FENCE + '  at one' + FENCE);
	});

	it('cuts a 400-character exception line to a 256-character title', () => {
		const line = 'NullReferenceException: ' + 'x'.repeat(400 - 'NullReferenceException: '.length);
		expect(line).toHaveLength(400);
		const r = parseLog(line, meta);
		expect(r.mode).toBe('embeds');
		expect(r.embeds[0].title).toBe(line.slice(0, 256));
		expect(r.embeds[0].title).toHaveLength(256);
	});

	it('cuts a stack over 4000 characters and marks the cut', () => {
		const long = Array.from({ length: 200 }, (_, i) => frame(i));
		const r = parseLog(['XException: big', ...long].join('\n'), meta);
		const d = r.embeds[0].description;
		const body = d.slice(FENCE.length, d.length - FENCE.length);
		expect(body.endsWith('\n…')).toBe(true);
		expect(body).toHaveLength(4002);
		expect(d.startsWith(FENCE) && d.endsWith(FENCE)).toBe(true);
		expect(d.length).toBeLessThanOrEqual(4096);
	});

	it('sends 9 exceptions as embeds and 10 as a file', () => {
		const nine = parseLog(Array.from({ length: 9 }, (_, i) => ex(i)).join('\n'), meta);
		expect(nine.mode).toBe('embeds');
		expect(nine.embeds).toHaveLength(9);
		const ten = parseLog(Array.from({ length: 10 }, (_, i) => ex(i)).join('\n'), meta);
		expect(ten.mode).toBe('file');
		expect(ten.content).toBe('There are 10 exceptions in the log.');
	});

	it('uses file mode for 25 exceptions, each followed by two empty lines', () => {
		const r = parseLog(Array.from({ length: 25 }, (_, i) => ex(i)).join('\n'), meta);
		expect(r.mode).toBe('file');
		expect(r.content).toBe('There are 25 exceptions in the log.');
		expect(r.embeds).toBeUndefined();
		const first = [
			'NullReferenceException: Object reference not set (0)',
			frame(0),
			frame(1),
			'',
			'',
			'',
		].join('\n');
		expect(r.file.startsWith(first)).toBe(true);
		expect(r.file.split('NullReferenceException').length - 1).toBe(25);
	});

	it('falls back to the file when embed text passes 6000 characters', () => {
		const stack = Array.from({ length: 60 }, (_, i) => frame(i));
		const text = Array.from({ length: 4 }, (_, i) =>
			[`XException: e${i}`, ...stack].join('\n'),
		).join('\n');
		const r = parseLog(text, meta);
		expect(r.mode).toBe('file');
		expect(r.content).toBe('There are 4 exceptions in the log.');
		expect(r.file).toContain('XException: e3');
	});

	it('uses singular and plural copy for the file message', () => {
		expect(fileMessage(1)).toBe('There is 1 exception in the log.');
		expect(fileMessage(0)).toBe('There are 0 exceptions in the log.');
		expect(fileMessage(2)).toBe('There are 2 exceptions in the log.');
	});

	it('keeps a single maximal exception in embed mode', () => {
		const huge = Array.from({ length: 200 }, (_, i) => frame(i));
		const r = parseLog(['XException: ' + 'a'.repeat(400), ...huge].join(NL), meta);
		expect(r.mode).toBe('embeds');
		expect(r.embeds[0].title).toHaveLength(256);
	});

	it('does not crash on binary, PNG-like input', () => {
		let png = '\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR';
		for (let i = 0; i < 5000; i++) png += String.fromCharCode((i * 31) % 256);
		const r = parseLog(png, { filename: 'a.png', size: png.length });
		expect(r.mode).toBe('embeds');
		expect(r.embeds).toEqual([]);
		expect(r.content).toContain('Exceptions Count:0');
	});

	it('handles missing and non-string input', () => {
		expect(parseLog(undefined, meta).embeds).toEqual([]);
		expect(parseLog(null, meta).embeds).toEqual([]);
		expect(parseLog(12345, meta).embeds).toEqual([]);
	});
});

describe('findAttachment', () => {
	const inter = {
		options: { logfile: '99' },
		resolved: { attachments: { 99: { url: 'https://cdn/x.log', filename: 'x.log', size: 7 } } },
	};
	it('returns the url, filename and size', () => {
		expect(findAttachment(inter)).toEqual({ url: 'https://cdn/x.log', filename: 'x.log', size: 7 });
	});
	it('returns null when the attachment is missing or has no url', () => {
		expect(findAttachment({ options: { logfile: '1' }, resolved: {} })).toBeNull();
		expect(findAttachment({ options: {} })).toBeNull();
		expect(
			findAttachment({ options: { logfile: '99' }, resolved: { attachments: { 99: {} } } }),
		).toBeNull();
		expect(findAttachment(undefined)).toBeNull();
	});
});
