import { NodeHelpers } from 'n8n-workflow';
import type { INodeParameters, INodeProperties } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Discord } from '../nodes/Discord/Discord.node';

const properties = new Discord().description.properties;

const base = { authentication: 'bot', resource: 'interactionResponse' };

function findProperty(name: string): INodeProperties {
	const matches = properties.filter(
		(p) =>
			p.name === name &&
			(p.displayOptions?.show?.resource as unknown[] | undefined)?.includes('interactionResponse'),
	);
	expect(matches.length, `interactionResponse property "${name}"`).toBe(1);
	return matches[0];
}

function isDisplayed(name: string, values: INodeParameters): boolean {
	const full = NodeHelpers.getNodeParameters(
		properties,
		{ ...base, ...values },
		true,
		true,
		null,
	) as INodeParameters;
	return NodeHelpers.displayParameter(full, findProperty(name), null);
}

const callback = (responseType: number) => ({
	operation: 'createInitialCallback',
	responseType,
});

describe('interaction response display rules', () => {
	it.each(['content', 'embeds', 'buttonRow', 'flags', 'tts', 'poll'])(
		'shows %s for type 4 (channel message)',
		(name) => {
			expect(isDisplayed(name, callback(4))).toBe(true);
		},
	);

	it('shows content for type 7 (update message)', () => {
		expect(isDisplayed('content', callback(7))).toBe(true);
	});

	it('hides content and shows flags for type 5 (deferred message)', () => {
		expect(isDisplayed('content', callback(5))).toBe(false);
		expect(isDisplayed('flags', callback(5))).toBe(true);
	});

	it('hides content and shows modal fields for type 9', () => {
		expect(isDisplayed('content', callback(9))).toBe(false);
		expect(isDisplayed('customId', callback(9))).toBe(true);
		expect(isDisplayed('title', callback(9))).toBe(true);
	});

	it('shows choices and hides content for type 8 (autocomplete)', () => {
		expect(isDisplayed('choices', callback(8))).toBe(true);
		expect(isDisplayed('content', callback(8))).toBe(false);
	});

	it.each(['editOriginalResponse', 'createFollowupMessage', 'editFollowupMessage'])(
		'shows message fields for %s',
		(operation) => {
			for (const name of ['content', 'embeds', 'buttonRow', 'flags']) {
				expect(isDisplayed(name, { operation }), name).toBe(true);
			}
		},
	);

	it('keeps content when saving a type 4 initial callback', () => {
		const saved = NodeHelpers.getNodeParameters(
			properties,
			{
				...base,
				operation: 'createInitialCallback',
				responseType: 4,
				content: 'pong',
				interactionId: '1',
				interactionToken: 't',
			},
			true,
			false,
			null,
		);
		expect(saved?.content).toBe('pong');
	});
});

describe('multi-key hide rules', () => {
	const allowList: string[] = [];

	it('no property hides on more than one key', () => {
		const offenders: string[] = [];
		const walk = (props: unknown[], path: string) => {
			for (const raw of props) {
				const p = raw as {
					name?: string;
					displayOptions?: { hide?: Record<string, unknown> };
					options?: unknown[];
					values?: unknown[];
				};
				const here = `${path}/${p.name}`;
				const keys = Object.keys(p.displayOptions?.hide ?? {});
				if (keys.length > 1 && !allowList.includes(here)) {
					offenders.push(`${here} [${keys.join(', ')}]`);
				}
				if (Array.isArray(p.options)) walk(p.options, here);
				if (Array.isArray(p.values)) walk(p.values, here);
			}
		};
		walk(properties, '');
		expect(offenders).toEqual([]);
	});
});
