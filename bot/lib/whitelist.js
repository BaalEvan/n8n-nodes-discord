function isAllowed(definition, caller, ownerId) {
	if (ownerId && caller.userId === ownerId) return true;
	const whitelist = (definition && definition.whitelist) || {};
	const users = whitelist.users || [];
	const roles = whitelist.roles || [];
	if (caller.userId && users.indexOf(caller.userId) !== -1) return true;
	if (caller.guildId && roles.indexOf(caller.guildId) !== -1) return true;
	return (caller.roleIds || []).some(function (r) {
		return roles.indexOf(r) !== -1;
	});
}

if (typeof module !== 'undefined') module.exports = { isAllowed };
