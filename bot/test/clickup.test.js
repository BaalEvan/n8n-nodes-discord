import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { extractTaskId, buildTaskEmbed, NO_LINK, NOT_FETCHED } = loadModule('clickup');

describe('copy', () => {
	it('is word for word', () => {
		expect(NO_LINK).toBe('No link provided.');
		expect(NOT_FETCHED).toBe('Could not fetch ClickUp task.');
	});
});

describe('extractTaskId', () => {
	it('reads app.clickup.com/t/<id>', () => {
		expect(extractTaskId('https://app.clickup.com/t/86abc123')).toBe('86abc123');
	});
	it('takes the last segment of /t/<team>/<id> custom task ids', () => {
		expect(extractTaskId('https://app.clickup.com/t/9012345/DEV-42')).toBe('DEV-42');
	});
	it('cuts query strings and fragments', () => {
		expect(extractTaskId('https://app.clickup.com/t/86abc123?comment=1&x=y')).toBe('86abc123');
		expect(extractTaskId('https://app.clickup.com/t/86abc123#top')).toBe('86abc123');
		expect(extractTaskId('https://app.clickup.com/t/123/DEV-42?a=b#c')).toBe('DEV-42');
	});
	it('drops trailing punctuation and slashes', () => {
		expect(extractTaskId('https://app.clickup.com/t/86abc123).')).toBe('86abc123');
		expect(extractTaskId('https://app.clickup.com/t/86abc123,')).toBe('86abc123');
		expect(extractTaskId('https://app.clickup.com/t/86abc123.')).toBe('86abc123');
		expect(extractTaskId('https://app.clickup.com/t/86abc123/')).toBe('86abc123');
		expect(extractTaskId('(https://app.clickup.com/t/86abc123)')).toBe('86abc123');
	});
	it('accepts an uppercase scheme and host', () => {
		expect(extractTaskId('HTTPS://APP.CLICKUP.COM/t/86abc123')).toBe('86abc123');
	});
	it('finds the link inside surrounding text', () => {
		expect(extractTaskId('see https://app.clickup.com/t/86abc123 please')).toBe('86abc123');
	});
	it('trims the input', () => {
		expect(extractTaskId('  https://app.clickup.com/t/86abc123\n')).toBe('86abc123');
	});
	it('falls back to the last segment for other http links', () => {
		expect(extractTaskId('https://example.com/some/task/abc123')).toBe('abc123');
		expect(extractTaskId('http://example.com/abc123')).toBe('abc123');
		expect(extractTaskId('HTTP://example.com/abc123')).toBe('abc123');
	});
	it('rejects fallback ids with ? / " or &', () => {
		expect(extractTaskId('https://example.com/abc?x=1')).toBeNull();
		expect(extractTaskId('https://example.com/abc&x=1')).toBeNull();
		expect(extractTaskId('https://example.com/ab"c')).toBeNull();
		expect(extractTaskId('https://example.com/')).toBeNull();
	});
	it('returns null for text that is not a link', () => {
		expect(extractTaskId('hello')).toBeNull();
		expect(extractTaskId('ftp://example.com/abc')).toBeNull();
	});
	it('returns null for empty and missing input', () => {
		expect(extractTaskId('')).toBeNull();
		expect(extractTaskId('   ')).toBeNull();
		expect(extractTaskId(null)).toBeNull();
		expect(extractTaskId(undefined)).toBeNull();
	});
	it('returns null for /t/ with nothing after it', () => {
		expect(extractTaskId('https://app.clickup.com/t/')).toBeNull();
		expect(extractTaskId('https://app.clickup.com/t/?x=1')).toBeNull();
	});
	it('works without a URL global', () => {
		const saved = globalThis.URL;
		delete globalThis.URL;
		try {
			expect(extractTaskId('https://app.clickup.com/t/86abc123')).toBe('86abc123');
		} finally {
			globalThis.URL = saved;
		}
	});
});

describe('buildTaskEmbed', () => {
	const task = {
		name: 'Fix login',
		description: 'It breaks.',
		status: { status: 'in progress' },
		url: 'https://app.clickup.com/t/86abc123',
	};
	it('builds the full embed', () => {
		expect(buildTaskEmbed(task)).toEqual({
			title: 'Fix login',
			description: 'It breaks.',
			color: 3447003,
			url: 'https://app.clickup.com/t/86abc123',
			fields: [
				{ name: 'Status', value: 'in progress' },
				{ name: 'Link', value: 'https://app.clickup.com/t/86abc123' },
			],
		});
	});
	it('uses the defaults for missing name, description and status', () => {
		const e = buildTaskEmbed({});
		expect(e.title).toBe('No Name');
		expect(e.description).toBe('No Description');
		expect(e.fields).toEqual([{ name: 'Status', value: 'Unknown' }]);
		expect(e).not.toHaveProperty('url');
	});
	it('treats blank text as missing', () => {
		const e = buildTaskEmbed({ name: '   ', description: '\n ', status: { status: '' } });
		expect(e.title).toBe('No Name');
		expect(e.description).toBe('No Description');
		expect(e.fields[0].value).toBe('Unknown');
	});
	it('cuts the title at 256 and the description at 4096', () => {
		const e = buildTaskEmbed({ name: 'n'.repeat(300), description: 'd'.repeat(5000) });
		expect(e.title).toHaveLength(256);
		expect(e.description).toHaveLength(4096);
	});
	it('uses Blue', () => {
		expect(buildTaskEmbed(task).color).toBe(3447003);
	});
	it('omits url and Link when url is empty', () => {
		const e = buildTaskEmbed({ ...task, url: '' });
		expect(e).not.toHaveProperty('url');
		expect(e.fields).toHaveLength(1);
	});
	it('copes with null and non-object input', () => {
		expect(buildTaskEmbed(null).title).toBe('No Name');
		expect(buildTaskEmbed(undefined).description).toBe('No Description');
	});
});
