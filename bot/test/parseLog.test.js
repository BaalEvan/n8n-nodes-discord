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

describe('parseLog on Switch logs', () => {
	const hint =
		"[LocalFileSystemSwitch::CreateAsDir] Trying to write to 'rom:' mount path 'rom:/Data/%HOMEPATH%'! ";
	const error = 'Error: nn::fs::CreateDirectory() failed because the operation is unsupported.';
	const search = "Search '2002-6364' on the following Error Code List for more information.";
	const url = 'https://developer.nintendo.com/html/online-docs/x/2002.html';
	const dashes = '------------';
	const abort = [
		'AbortObserver called: Failed: nnFsResult',
		'  Module: 2',
		'  Description: 6364',
		'Condition: nn::Result::IsSuccess()',
		'Function: CreateDirectory in D:\\sdk\\fs_UserFileSystem.cpp:58',
	];
	const dump = "[SnapShotDumper] Dump completed to 'C:\\dumps\\a.nxdmp'";

	it('collects an SDK error and its abort box into one entry', () => {
		const text = [
			'UnloadTime: 1.9 ms',
			hint,
			'',
			error,
			search,
			url,
			'',
			dashes,
			...abort,
			dashes,
			dump,
			'',
		].join(NL);
		const r = parseLog(text, meta);
		expect(r.embeds).toHaveLength(1);
		expect(r.embeds[0].title).toBe(error);
		expect(r.embeds[0].description).toBe(
			FENCE + [hint, search, url, ...abort, dump].join(NL) + FENCE,
		);
	});

	it('handles the newline-stripped abort box', () => {
		const glued =
			'AbortObserver called: Failed: nnFsResult  Module: 2  Description: 6364Condition: nn::Result::IsSuccess()';
		const text = ['', error, search, '', dashes, glued, dashes, dump].join(NL);
		const r = parseLog(text, meta);
		expect(r.embeds).toHaveLength(1);
		expect(r.embeds[0].description).toBe(
			FENCE +
				[
					search,
					'AbortObserver called: Failed: nnFsResult',
					'  Module: 2',
					'  Description: 6364',
					'Condition: nn::Result::IsSuccess()',
					dump,
				].join(NL) +
				FENCE,
		);
	});

	it('titles a glued abort by its failed call and trims text glued after the dump', () => {
		const glued =
			'AbortObserver called: Failed: OpenUser(pOutHandle)  Module: 124  Description: 101Function: TryOpenPreselectedUser in account_Api.cpp:330';
		const start = "[SnapShotDumper] Start dumping to 'C:\\dumps\\a.nxdmp'";
		const text = [dashes, glued, dashes, start + dump + 'Memory available: 6823936KiB'].join(NL);
		const r = parseLog(text, meta);
		expect(r.embeds).toHaveLength(1);
		expect(r.embeds[0].title).toBe('AbortObserver called: Failed: OpenUser(pOutHandle)');
		expect(r.embeds[0].description).toBe(
			FENCE +
				[
					'  Module: 124',
					'  Description: 101',
					'Function: TryOpenPreselectedUser in account_Api.cpp:330',
					start,
					dump,
				].join(NL) +
				FENCE,
		);
	});

	it('reports an abort box with no SDK error line', () => {
		const r = parseLog(['plain', dashes, ...abort, dashes, 'next'].join(NL), meta);
		expect(r.embeds).toHaveLength(1);
		expect(r.embeds[0].title).toBe(abort[0]);
		expect(r.embeds[0].description).toBe(FENCE + abort.slice(1).join(NL) + FENCE);
	});

	it('ends the SDK entry at the first unrelated line', () => {
		const r = parseLog([error, search, 'Frame: 01172 frm_fps: 59.61'].join(NL), meta);
		expect(r.embeds[0].description).toBe(FENCE + search + FENCE);
	});

	it('keeps the parameter line and stack of a managed exception', () => {
		const at = '  at System.IO.Directory.CreateDirectory (System.String path) [0x00000] in <0>:0 ';
		const text = [
			'UnityEngine.SetupCoroutine:InvokeMoveNext(IEnumerator, IntPtr)',
			'ArgumentException: Path cannot be the empty string or all whitespace.',
			'Parameter name: path',
			at,
			'Frame: 02373  frm_fps: 59.99',
		].join(NL);
		const r = parseLog(text, meta);
		expect(r.embeds).toHaveLength(1);
		expect(r.embeds[0].description).toBe(FENCE + ['Parameter name: path', at].join(NL) + FENCE);
	});

	it('reads Unity-format frames as stack lines', () => {
		const frames = [
			'ElevenPuzzles.Network.<CreateRoom>d__23:MoveNext()',
			'System.Runtime.CompilerServices.AsyncTaskMethodBuilder`1:SetException(Exception)',
			'ElevenPuzzles.Logger:Info(String) (at C:\\Proj\\Assets\\Logger.cs:80)',
		];
		const text = ['NullReferenceException: Object reference not set', ...frames, ''].join(NL);
		const r = parseLog(text, meta);
		expect(r.embeds[0].description).toBe(FENCE + frames.join(NL) + FENCE);
	});

	it('does not treat Unity-format frames of plain log lines as exceptions', () => {
		const text = ['[12/10/2026 11:49:16] Set GlobalTextureMipmapLimit to 0 [1]', 'A.B:C()'].join(
			NL,
		);
		expect(parseLog(text, meta).embeds).toEqual([]);
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

describe('findAttachment size cap', () => {
	const MAX = 20 * 1024 * 1024;
	const withSize = (size) => ({
		options: { logfile: '1' },
		resolved: { attachments: { 1: { url: 'u', filename: 'x.log', size } } },
	});
	const tooLarge = (label) =>
		`That log file is too large to parse (${label}, limit 20 MB). Upload a smaller or trimmed log.`;

	it('accepts exactly 20 MB', () => {
		expect(findAttachment(withSize(MAX))).toEqual({ url: 'u', filename: 'x.log', size: MAX });
	});
	it('rejects 20 MB plus one byte', () => {
		expect(findAttachment(withSize(MAX + 1))).toEqual({ error: tooLarge('20.0 MB') });
	});
	it('prints the size with one decimal', () => {
		expect(findAttachment(withSize(150 * 1024 * 1024))).toEqual({
			error: tooLarge('150.0 MB'),
		});
		expect(findAttachment(withSize(31.5 * 1024 * 1024))).toEqual({ error: tooLarge('31.5 MB') });
	});
	it('rejects a missing or non-numeric size', () => {
		const unknown = tooLarge('unknown size');
		expect(findAttachment(withSize(undefined))).toEqual({ error: unknown });
		expect(findAttachment(withSize('12'))).toEqual({ error: unknown });
		expect(findAttachment(withSize(NaN))).toEqual({ error: unknown });
		expect(findAttachment(withSize(null))).toEqual({ error: unknown });
	});
});

describe('parseLog file cap', () => {
	const NL = String.fromCharCode(10);
	const block = (i) => ['XException: e' + i, '  at A.B () in x:' + i].join(NL);
	const log = (n) => Array.from({ length: n }, (_, i) => block(i)).join(NL);

	it('does not truncate a file under the cap', () => {
		const r = parseLog(log(25), meta);
		expect(r.content).toBe('There are 25 exceptions in the log.');
		expect(r.file).not.toContain('truncated');
	});

	it('cuts the file at the cap, ends with a truncation line and flags the message', () => {
		const r = parseLog(log(50), meta, { fileLimit: 600 });
		expect(r.mode).toBe('file');
		expect(r.content).toBe('There are 50 exceptions in the log. The file was truncated.');
		const shown = r.file.split('XException').length - 1;
		expect(shown).toBeGreaterThan(0);
		expect(shown).toBeLessThan(50);
		expect(r.file.trimEnd().split(NL).pop()).toBe(
			`… truncated (${50 - shown} more exceptions not shown)`,
		);
		expect(Buffer.byteLength(r.file, 'utf8')).toBeLessThanOrEqual(600);
	});

	it('caps at 8 MB by default', () => {
		const stack = Array.from({ length: 200 }, (_, i) => frame(i));
		const one = ['XException: big', ...stack].join(NL);
		const r = parseLog(Array.from({ length: 2000 }, () => one).join(NL), meta);
		expect(r.mode).toBe('file');
		expect(Buffer.byteLength(r.file, 'utf8')).toBeLessThanOrEqual(8 * 1024 * 1024);
		expect(r.content.endsWith(' The file was truncated.')).toBe(true);
		expect(r.file).toMatch(/… truncated \(\d+ more exceptions not shown\)\s*$/);
	});

	it('counts bytes, not characters', () => {
		const text = Array.from({ length: 30 }, (_, i) => 'XException: ' + 'é'.repeat(50) + i).join(NL);
		const r = parseLog(text, meta, { fileLimit: 1000 });
		expect(Buffer.byteLength(r.file, 'utf8')).toBeLessThanOrEqual(1000);
		expect(r.content).toContain('The file was truncated.');
	});
});
