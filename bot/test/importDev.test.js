import { describe, it, expect } from 'vitest';
import { prepareWorkflow, sameContent } from '../import-dev.mjs';
import { buildAll } from '../build-workflows.mjs';
const path = require('path');

const built = buildAll(path.join(__dirname, '..'));
const credentials = [
	{ id: 'C1', name: 'Discord Bot (live)', type: 'discordGatewayBotApi' },
	{ id: 'C2', name: 'n8n API', type: 'n8nApi' },
	{ id: 'C3', name: 'n8n API', type: 'otherApi' },
];
const OWNER = '181510541934592000';

describe('prepareWorkflow', () => {
	it('injects credential ids by name and type', () => {
		const { body } = prepareWorkflow(built.sync, { credentials, ownerId: OWNER });
		const getWf = body.nodes.find((n) => n.name === 'Get Workflows');
		expect(getWf.credentials).toEqual({ n8nApi: { id: 'C2', name: 'n8n API' } });
		const register = body.nodes.find((n) => n.name === 'Register');
		expect(register.credentials).toEqual({
			discordGatewayBotApi: { id: 'C1', name: 'Discord Bot (live)' },
		});
	});

	it('fails when a credential is missing', () => {
		expect(() =>
			prepareWorkflow(built.sync, { credentials: credentials.slice(1), ownerId: OWNER }),
		).toThrow(/Discord Sync \/ .*no discordGatewayBotApi credential named "Discord Bot \(live\)"/);
	});

	it('strips tags and returns them separately', () => {
		const { body, tags } = prepareWorkflow(built['reload-commands'], {
			credentials,
			ownerId: OWNER,
		});
		expect(tags).toEqual(['discord-command']);
		expect(Object.keys(body).sort()).toEqual(['connections', 'name', 'nodes', 'settings']);
	});

	it('fills __OWNER_ID__ in parameters only, leaving notes alone', () => {
		const { body } = prepareWorkflow(built.router, { credentials, ownerId: OWNER });
		const trigger = body.nodes.find((n) => n.name === 'Discord Trigger');
		expect(trigger.parameters.alertUserId).toBe(OWNER);
		expect(trigger.notes).toContain('__OWNER_ID__');
		expect(JSON.stringify(body.nodes.map((n) => n.parameters))).not.toContain('__OWNER_ID__');
	});

	it('refuses an owner id that is not a snowflake', () => {
		expect(() => prepareWorkflow(built.router, { credentials, ownerId: '' })).toThrow(
			/not a Discord snowflake/,
		);
		expect(() => prepareWorkflow(built.router, { credentials, ownerId: 'abc' })).toThrow(
			/not a Discord snowflake/,
		);
	});

	it('does not modify its input', () => {
		const before = JSON.stringify(built.router);
		prepareWorkflow(built.router, { credentials, ownerId: OWNER });
		expect(JSON.stringify(built.router)).toBe(before);
	});
});

describe('sameContent', () => {
	const { body } = prepareWorkflow(built.sync, { credentials, ownerId: OWNER });

	it('ignores key order and extra workflow fields', () => {
		const stored = JSON.parse(JSON.stringify({ id: 'x', active: true, ...body }));
		stored.nodes = stored.nodes.map((n) => Object.fromEntries(Object.entries(n).reverse()));
		expect(sameContent(stored, body)).toBe(true);
	});

	it('compares an activeVersion (no settings) on nodes and connections', () => {
		expect(sameContent({ nodes: body.nodes, connections: body.connections }, body)).toBe(true);
	});

	it('detects a parameter change and a missing version', () => {
		const stored = structuredClone(body);
		stored.nodes[0].parameters = { changed: true };
		expect(sameContent(stored, body)).toBe(false);
		expect(sameContent(null, body)).toBe(false);
	});
});
