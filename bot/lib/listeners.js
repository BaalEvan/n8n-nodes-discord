const MESSAGE_EVENTS = { MESSAGE_CREATE: 'create', MESSAGE_UPDATE: 'update', MESSAGE_DELETE: 'delete' };

function filterMessage(eventName, message, botUserId) {
	const event = MESSAGE_EVENTS[eventName];
	if (!event) return null;
	if (!botUserId) return null;
	const m = message && typeof message === 'object' ? message : {};
	if (event !== 'delete' && m.author && m.author.id === String(botUserId)) return null;
	return { event: event, message: m };
}

function listenerInputs(rows, filtered) {
	if (!filtered) return [];
	return (rows || [])
		.filter(function (row) {
			return row && row.workflowId !== undefined && row.workflowId !== null && row.workflowId !== '';
		})
		.map(function (row) {
			return {
				event: filtered.event,
				message: filtered.message,
				listener: { name: row.name || '', workflowId: String(row.workflowId) },
			};
		});
}

if (typeof module !== 'undefined') module.exports = { filterMessage, listenerInputs };
