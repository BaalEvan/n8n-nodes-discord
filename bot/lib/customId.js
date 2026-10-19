function encodeCustomId(command, action, payload) {
	if (String(command).indexOf(':') !== -1 || String(action).indexOf(':') !== -1) {
		throw new Error('command and action must not contain ":"');
	}
	const id = command + ':' + action + ':' + (payload === undefined || payload === null ? '' : payload);
	if (id.length > 100) throw new Error('custom_id exceeds 100 characters');
	return id;
}

function decodeCustomId(id) {
	if (typeof id !== 'string') return null;
	const first = id.indexOf(':');
	const second = first === -1 ? -1 : id.indexOf(':', first + 1);
	if (second === -1) return null;
	return { command: id.slice(0, first), action: id.slice(first + 1, second), payload: id.slice(second + 1) };
}

if (typeof module !== 'undefined') module.exports = { encodeCustomId, decodeCustomId };
