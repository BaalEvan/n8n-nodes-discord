function buildModal(customId, modal) {
	return {
		custom_id: customId,
		title: modal.title,
		components: modal.fields.map(function (f) {
			const input = {
				type: 4,
				custom_id: f.id,
				label: f.label,
				style: f.style === 'paragraph' ? 2 : 1,
				required: f.required !== false,
			};
			if (f.maxLength) input.max_length = f.maxLength;
			return { type: 1, components: [input] };
		}),
	};
}

function decideRoute(classified, row, ownerId) {
	const isCommand = classified.kind === 'command' || classified.kind === 'autocomplete';
	const unavailable = {
		route: isCommand || classified.kind === 'unknown' ? 'unknownCommand' : 'unknownComponent',
		ephemeral: true,
	};
	if (classified.kind === 'unknown') return unavailable;
	if (!isCommand && !classified.commandName) return unavailable;
	if (!row) return unavailable;
	const parsed = parseDefinition(row.definition);
	if (!parsed.ok) return unavailable;
	const definition = parsed.definition;
	if (!isAllowed(definition, classified, ownerId)) return { route: 'refuse', ephemeral: true };
	const ephemeral = definition.ephemeral === true;
	const base = { ephemeral: ephemeral, workflowId: row.workflowId };
	if (classified.kind === 'autocomplete') return { route: 'autocomplete', ephemeral: false, workflowId: row.workflowId };
	if (classified.kind === 'modal') return Object.assign({ route: 'deferUpdate' }, base);
	if (classified.kind === 'component') {
		const modal = definition.modals && definition.modals[classified.action];
		if (modal) {
			const customId = encodeCustomId(classified.commandName, classified.action, classified.payload || '');
			return { route: 'openModal', ephemeral: ephemeral, modal: buildModal(customId, modal), workflowId: row.workflowId };
		}
	}
	return Object.assign({ route: 'deferCommand' }, base);
}

if (typeof module !== 'undefined') module.exports = { decideRoute };
