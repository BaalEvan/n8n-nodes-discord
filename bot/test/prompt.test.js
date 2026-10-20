import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const {
	buildPromptUrl,
	splitText,
	parseBody,
	buildResult,
	replyFor,
	NOT_CONFIGURED,
	EMPTY_REPLY,
	CUT_NOTE,
	failedReply,
	errorReply,
} = loadModule('prompt');

const BASE = 'https://hook.example';
const PATH = '/webhook/gemini-hook?prompt=';

describe('buildPromptUrl', () => {
	it('sends only the prompt without a preset', () => {
		expect(buildPromptUrl(BASE, 'hello')).toBe(`${BASE}${PATH}hello`);
		expect(buildPromptUrl(BASE, 'hello', '')).toBe(`${BASE}${PATH}hello`);
		expect(buildPromptUrl(BASE, 'hello', null)).toBe(`${BASE}${PATH}hello`);
	});
	it('adds the preset', () => {
		expect(buildPromptUrl(BASE, 'hello', 'ffxiv')).toBe(`${BASE}${PATH}hello&preset=ffxiv`);
	});
	it('encodes & # ? emoji and Polish characters', () => {
		const p = 'a&b #c? 😀 zażółć gęślą jaźń';
		const url = buildPromptUrl(BASE, p, 'x&y');
		expect(url).toBe(`${BASE}${PATH}${encodeURIComponent(p)}&preset=x%26y`);
		expect(url).not.toMatch(/[ #😀ż]/);
		const q = url.split('?')[1].split('&');
		expect(q).toHaveLength(2);
		expect(decodeURIComponent(q[0].slice('prompt='.length))).toBe(p);
	});
	it('drops trailing slashes on the base', () => {
		expect(buildPromptUrl(`${BASE}//`, 'a')).toBe(`${BASE}${PATH}a`);
	});
	it('gives an empty url without a base', () => {
		expect(buildPromptUrl(undefined, 'a')).toBe('');
		expect(buildPromptUrl(null, 'a')).toBe('');
		expect(buildPromptUrl('  ', 'a')).toBe('');
	});
	it('stringifies a missing prompt as empty', () => {
		expect(buildPromptUrl(BASE, undefined)).toBe(`${BASE}${PATH}`);
	});
});

describe('splitText', () => {
	it('keeps short text whole', () => {
		expect(splitText('abc')).toEqual(['abc']);
		expect(splitText('x'.repeat(1950))).toEqual(['x'.repeat(1950)]);
	});
	it('splits after the last ". " before 1950', () => {
		const head = 'a'.repeat(1000) + '. ';
		const text = head + 'b'.repeat(1500);
		expect(splitText(text)).toEqual([head, 'b'.repeat(1500)]);
	});
	it('matches C# LastIndexOf(". ", 1950): a match starting at 1950 counts', () => {
		const text = 'a'.repeat(1950) + '. ' + 'b'.repeat(10);
		expect(splitText(text)).toEqual(['a'.repeat(1950) + '. ', 'b'.repeat(10)]);
	});
	it('falls back to the last space', () => {
		const text = 'a'.repeat(1900) + ' ' + 'b'.repeat(200);
		expect(splitText(text)).toEqual(['a'.repeat(1900) + ' ', 'b'.repeat(200)]);
	});
	it('hard cuts at 1950 without any separator', () => {
		const text = 'z'.repeat(4000);
		expect(splitText(text)).toEqual(['z'.repeat(1950), 'z'.repeat(1950), 'z'.repeat(100)]);
	});
	it('a 5000-character essay loses and duplicates nothing', () => {
		const sentence = 'Zażółć gęślą jaźń to zdanie testowe. ';
		let essay = '';
		while (essay.length < 5000) essay += sentence;
		essay = essay.slice(0, 5000);
		const chunks = splitText(essay);
		expect(chunks.length).toBeGreaterThanOrEqual(3);
		expect(chunks.join('')).toBe(essay);
		for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1952);
	});
	it('also loses nothing with spaces only and with a mix', () => {
		const words = Array.from({ length: 2000 }, (_, i) => 'w' + i).join(' ');
		expect(splitText(words).join('')).toBe(words);
		const mix = ('x'.repeat(3000) + ' end. ').repeat(3);
		expect(splitText(mix).join('')).toBe(mix);
	});
});

describe('parseBody', () => {
	it('uses plain text as is', () => {
		expect(parseBody('hello there')).toEqual({ text: 'hello there', embeds: [] });
	});
	it('reads Text and Embeds from a JSON body', () => {
		const body = JSON.stringify({ Text: 'hi', Embeds: ['one', 'two'] });
		expect(parseBody(body)).toEqual({ text: 'hi', embeds: ['one', 'two'] });
	});
	it('URL-decodes a body that looks like JSON before parsing it', () => {
		const partly = '{"Text":"100%25 sure %26 more","Embeds":[]}';
		expect(parseBody(partly).text).toBe('100% sure & more');
		const body = encodeURIComponent(JSON.stringify({ Text: 'x' }));
		expect(parseBody(body).text).toBe(body);
	});
	it('parses undecodable JSON as is, and falls back to the raw body when parsing fails', () => {
		expect(parseBody('{not json}')).toEqual({ text: '{not json}', embeds: [] });
		expect(parseBody('{"Text":"50% off"}')).toEqual({ text: '50% off', embeds: [] });
	});
	it('keeps the raw body when the JSON has no Text string', () => {
		const raw = '{"Other":1}';
		expect(parseBody(raw)).toEqual({ text: raw, embeds: [] });
	});
	it('drops non-string and blank embeds', () => {
		const body = JSON.stringify({ Text: 't', Embeds: ['a', '', '  ', 3, null, 'b'] });
		expect(parseBody(body).embeds).toEqual(['a', 'b']);
	});
	it('trims surrounding whitespace only to detect JSON', () => {
		expect(parseBody('  {"Text":"x"}\n').text).toBe('x');
		expect(parseBody('  plain  ').text).toBe('  plain  ');
	});
	it('treats a missing body as empty', () => {
		expect(parseBody(undefined)).toEqual({ text: '', embeds: [] });
	});
});

describe('buildResult', () => {
	it('answers short text in one message', () => {
		expect(buildResult('hello')).toEqual({ content: 'hello', embeds: [], followups: [] });
	});
	it('says (empty response) for an empty body', () => {
		expect(EMPTY_REPLY).toBe('(empty response)');
		expect(buildResult('')).toEqual({ content: '(empty response)', embeds: [], followups: [] });
		expect(buildResult(undefined).content).toBe('(empty response)');
	});
	it('puts later chunks in followups, in order', () => {
		const text = 'q'.repeat(5000);
		const r = buildResult(text);
		expect(r.content).toBe('q'.repeat(1950));
		expect(r.followups.map((f) => f.content)).toEqual(['q'.repeat(1950), 'q'.repeat(1100)]);
		expect([r.content, ...r.followups.map((f) => f.content)].join('')).toBe(text);
	});
	it('makes one embed per Embeds string, at most 10, description at most 4096', () => {
		const embeds = Array.from({ length: 12 }, (_, i) => 'e' + i);
		embeds[0] = 'L'.repeat(5000);
		const r = buildResult(JSON.stringify({ Text: 'hi', Embeds: embeds }));
		expect(r.content).toBe('hi');
		expect(r.embeds).toHaveLength(10);
		expect(r.embeds[0].description).toHaveLength(4096);
		expect(r.embeds[1]).toEqual({ description: 'e1' });
		expect(r.embeds[9]).toEqual({ description: 'e9' });
	});
	it('keeps 11 chunks whole', () => {
		const r = buildResult('k'.repeat(1950 * 10 + 5));
		expect(r.followups).toHaveLength(10);
		expect(r.followups[9].content).toBe('k'.repeat(5));
		expect(r.followups[9].content).not.toContain('cut');
	});
	it('keeps 10 followups and marks the cut when there are more than 11 chunks', () => {
		const r = buildResult('k'.repeat(1950 * 12));
		expect(r.followups).toHaveLength(10);
		expect(CUT_NOTE).toBe('\n… (answer cut, too long for Discord)');
		expect(r.followups[9].content).toBe('k'.repeat(1950) + CUT_NOTE);
		expect(r.followups[8].content).toBe('k'.repeat(1950));
		expect(r.followups[9].content.length).toBeLessThanOrEqual(2000);
	});
});

describe('reply copy', () => {
	it('is word for word', () => {
		expect(NOT_CONFIGURED).toBe(
			"Prompt hook isn't configured (discord_config row webhookBase is missing).",
		);
		expect(failedReply(500)).toBe('Failed to get an AI response. Status: 500');
		expect(errorReply('boom')).toBe('Error contacting the AI service: boom');
	});
	it('replyFor reads the status from the error output', () => {
		expect(replyFor({ error: { httpCode: '404' } })).toBe(
			'Failed to get an AI response. Status: 404',
		);
		expect(replyFor({ error: { status: 500 } })).toBe('Failed to get an AI response. Status: 500');
		expect(replyFor({ error: { statusCode: 502 } })).toBe(
			'Failed to get an AI response. Status: 502',
		);
	});
	it('replyFor falls back to the message, then to unknown error', () => {
		expect(replyFor({ error: { message: 'ENOTFOUND x' } })).toBe(
			'Error contacting the AI service: ENOTFOUND x',
		);
		expect(replyFor({ error: {} })).toBe('Error contacting the AI service: unknown error');
		expect(replyFor({})).toBe('Error contacting the AI service: unknown error');
	});
});
