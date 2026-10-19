import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { buildChangelogUrl, replyFor, REPLY_OK, NOT_CONFIGURED, failedReply, errorReply } =
	loadModule('changelog');

const BASE = 'https://hook.example';
const PATH = '/webhook/hg-build-hook?BuildID=';

describe('buildChangelogUrl', () => {
	it('leaves SkipAI out when the option was not given', () => {
		expect(buildChangelogUrl(BASE, '905')).toBe(`${BASE}${PATH}905`);
		expect(buildChangelogUrl(BASE, '905', undefined)).toBe(`${BASE}${PATH}905`);
		expect(buildChangelogUrl(BASE, '905', null)).toBe(`${BASE}${PATH}905`);
	});
	it('sends SkipAI=True for true', () => {
		expect(buildChangelogUrl(BASE, '905', true)).toBe(`${BASE}${PATH}905&SkipAI=True`);
	});
	it('sends an empty SkipAI for false (the only value that reaches the AI branch)', () => {
		expect(buildChangelogUrl(BASE, '905', false)).toBe(`${BASE}${PATH}905&SkipAI=`);
	});
	it('encodes the build id', () => {
		expect(buildChangelogUrl(BASE, 'a b&c')).toBe(`${BASE}${PATH}a%20b%26c`);
	});
	it('passes a range through unchanged', () => {
		expect(buildChangelogUrl(BASE, '900-905')).toBe(`${BASE}${PATH}900-905`);
	});
	it('drops a trailing slash on the base', () => {
		expect(buildChangelogUrl(`${BASE}/`, '1')).toBe(`${BASE}${PATH}1`);
		expect(buildChangelogUrl(`${BASE}`, '1')).toBe(`${BASE}${PATH}1`);
	});
	it('gives an empty url without a base', () => {
		expect(buildChangelogUrl(undefined, '1')).toBe('');
		expect(buildChangelogUrl('  ', '1')).toBe('');
	});
	it('stringifies a numeric build id', () => {
		expect(buildChangelogUrl(BASE, 905)).toBe(`${BASE}${PATH}905`);
	});
});

describe('reply copy', () => {
	it('is word for word', () => {
		expect(REPLY_OK).toBe('Asked backend for changelog');
		expect(NOT_CONFIGURED).toBe(
			"Changelog hook isn't configured (discord_config row webhookBase is missing).",
		);
		expect(failedReply(404)).toBe('Failed to fetch changelog. Status: 404');
		expect(errorReply('boom')).toBe('Error fetching changelog: boom');
	});
	it('replyFor reads the status from the error output', () => {
		expect(replyFor({ error: { httpCode: '404', message: 'x' } })).toBe(
			'Failed to fetch changelog. Status: 404',
		);
		expect(replyFor({ error: { status: 500 } })).toBe('Failed to fetch changelog. Status: 500');
		expect(replyFor({ error: { statusCode: 502 } })).toBe('Failed to fetch changelog. Status: 502');
	});
	it('replyFor falls back to the message, then to unknown error', () => {
		expect(replyFor({ error: { message: 'getaddrinfo ENOTFOUND nope' } })).toBe(
			'Error fetching changelog: getaddrinfo ENOTFOUND nope',
		);
		expect(replyFor({ error: {} })).toBe('Error fetching changelog: unknown error');
		expect(replyFor({})).toBe('Error fetching changelog: unknown error');
		expect(replyFor(undefined)).toBe('Error fetching changelog: unknown error');
	});
});
