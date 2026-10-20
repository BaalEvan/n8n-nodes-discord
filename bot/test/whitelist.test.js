import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const { isAllowed } = loadModule('whitelist');

const caller = (o = {}) => ({ userId: 'u1', roleIds: [], guildId: 'g1', ...o });

describe('isAllowed', () => {
	it('owner passes an empty whitelist', () => {
		expect(isAllowed({}, caller({ userId: 'own' }), 'own')).toBe(true);
	});
	it('stranger fails an empty whitelist', () => {
		expect(isAllowed({}, caller(), 'own')).toBe(false);
		expect(isAllowed({ whitelist: { users: [], roles: [] } }, caller(), 'own')).toBe(false);
	});
	it('role match passes', () => {
		expect(isAllowed({ whitelist: { roles: ['r2'] } }, caller({ roleIds: ['r1', 'r2'] }), 'own')).toBe(true);
	});
	it('user match passes', () => {
		expect(isAllowed({ whitelist: { users: ['u1'] } }, caller(), 'own')).toBe(true);
	});
	it('a role entry equal to the guild id admits every member', () => {
		expect(isAllowed({ whitelist: { roles: ['g1'] } }, caller(), 'own')).toBe(true);
	});
	it('the guild id entry never admits a DM caller', () => {
		expect(isAllowed({ whitelist: { roles: ['g1'] } }, caller({ guildId: null }), 'own')).toBe(false);
	});
	it('an undefined owner id does not admit an undefined user', () => {
		expect(isAllowed({}, caller({ userId: undefined }), undefined)).toBe(false);
	});
	it('everyone admits any caller, in a server, a DM or a user install', () => {
		const open = { whitelist: { everyone: true, users: [], roles: [] } };
		expect(isAllowed(open, caller(), 'own')).toBe(true);
		expect(isAllowed(open, { userId: 'u9', roleIds: [], guildId: null }, 'own')).toBe(true);
		expect(isAllowed(open, { userId: 'u9', roleIds: [], guildId: 'not-our-guild' }, 'own')).toBe(true);
	});
	it('a DM caller without everyone passes only as owner or listed user', () => {
		const dm = { userId: 'u9', roleIds: [], guildId: null };
		expect(isAllowed({ whitelist: { users: [], roles: [] } }, dm, 'own')).toBe(false);
		expect(isAllowed({ whitelist: { everyone: false, roles: ['r1'] } }, dm, 'own')).toBe(false);
		expect(isAllowed({ whitelist: { users: ['u9'] } }, dm, 'own')).toBe(true);
		expect(isAllowed({}, { ...dm, userId: 'own' }, 'own')).toBe(true);
	});
});
