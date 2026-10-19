import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { previewLink, NO_URL, NO_DOMAIN } = loadModule('preview');

describe('previewLink', () => {
	it('copy is word for word', () => {
		expect(NO_URL).toBe('Please provide a URL.');
		expect(NO_DOMAIN).toBe('No supported domain found in the URL.');
	});
	it('rewrites x.com', () => {
		expect(previewLink('https://x.com/user/status/1')).toBe('https://fxtwitter.com/user/status/1');
	});
	it('rewrites twitter.com, facebook.com and instagram.com', () => {
		expect(previewLink('https://twitter.com/a/status/2')).toBe('https://fxtwitter.com/a/status/2');
		expect(previewLink('https://facebook.com/a/posts/3')).toBe('https://facebed.com/a/posts/3');
		expect(previewLink('https://instagram.com/p/abc/')).toBe('https://vxinstagram.com/p/abc/');
	});
	it('drops www. and other subdomains', () => {
		expect(previewLink('https://www.instagram.com/p/abc/')).toBe('https://vxinstagram.com/p/abc/');
		expect(previewLink('https://mobile.twitter.com/a/status/2')).toBe(
			'https://fxtwitter.com/a/status/2',
		);
	});
	it('takes the first URL out of surrounding text', () => {
		expect(previewLink('look at this https://twitter.com/a/status/2 lol')).toBe(
			'https://fxtwitter.com/a/status/2',
		);
		expect(previewLink('https://x.com/a https://instagram.com/b')).toBe('https://fxtwitter.com/a');
	});
	it('handles angle brackets and trailing punctuation', () => {
		expect(previewLink('<https://x.com/a>')).toBe('https://fxtwitter.com/a');
		expect(previewLink('see https://x.com/a/status/1.')).toBe('https://fxtwitter.com/a/status/1');
		expect(previewLink('(https://x.com/a/status/1), ok')).toBe('https://fxtwitter.com/a/status/1');
		expect(previewLink('wow https://x.com/a?b=1!')).toBe('https://fxtwitter.com/a?b=1');
	});
	it('matches case-insensitively and keeps http', () => {
		expect(previewLink('HTTPS://X.COM/Abc')).toBe('https://fxtwitter.com/Abc');
		expect(previewLink('http://x.com/a')).toBe('http://fxtwitter.com/a');
	});
	it('keeps query and fragment', () => {
		expect(previewLink('https://x.com/a/status/1?s=20&t=z#frag')).toBe(
			'https://fxtwitter.com/a/status/1?s=20&t=z#frag',
		);
	});
	it('does not rely on the URL global (absent in the Code node sandbox)', () => {
		const saved = globalThis.URL;
		globalThis.URL = undefined;
		try {
			expect(previewLink('https://x.com/a')).toBe('https://fxtwitter.com/a');
		} finally {
			globalThis.URL = saved;
		}
	});
	it('keeps port, query-only and path-less URLs', () => {
		expect(previewLink('https://x.com:8443/a')).toBe('https://fxtwitter.com:8443/a');
		expect(previewLink('https://x.com')).toBe('https://fxtwitter.com');
		expect(previewLink('https://x.com?a=1')).toBe('https://fxtwitter.com?a=1');
	});
	it('does not match a domain inside another host', () => {
		expect(previewLink('https://netflix.com/x')).toBe(NO_DOMAIN);
		expect(previewLink('https://notx.com/a')).toBe(NO_DOMAIN);
		expect(previewLink('https://x.com.evil.example/a')).toBe(NO_DOMAIN);
		expect(previewLink('https://x.com@evil.example/a')).toBe(NO_DOMAIN);
		expect(previewLink('https://example.com/?u=https://x.com/a')).toBe(NO_DOMAIN);
	});
	it('rejects text that is not a URL', () => {
		expect(previewLink('not a url')).toBe(NO_DOMAIN);
		expect(previewLink('x.com/foo')).toBe(NO_DOMAIN);
	});
	it('asks for a URL when the input is empty', () => {
		expect(previewLink('')).toBe(NO_URL);
		expect(previewLink('   ')).toBe(NO_URL);
		expect(previewLink(undefined)).toBe(NO_URL);
		expect(previewLink(null)).toBe(NO_URL);
	});
});
