function commandErrorText(name) {
	return 'Something went wrong running /' + name + '. The details are in the n8n execution log.';
}

function isErrorResult(json) {
	return (
		!!json &&
		typeof json === 'object' &&
		Object.keys(json).length === 1 &&
		json.error !== undefined &&
		json.error !== null
	);
}

function hasMessage(r) {
	return (
		(r.content !== undefined && r.content !== null && String(r.content) !== '') ||
		(Array.isArray(r.embeds) && r.embeds.length > 0) ||
		(Array.isArray(r.components) && r.components.length > 0)
	);
}

function formatResult(json, hasFile, decision) {
	const isUpdate = decision.route === 'deferUpdate';
	if (isErrorResult(json)) {
		const name = (decision.classified && decision.classified.commandName) || '';
		return { action: isUpdate ? 'updateError' : 'commandError', errorText: commandErrorText(name) };
	}
	const r = json && typeof json === 'object' ? json : {};
	if (isUpdate && !hasMessage(r)) return { action: 'skip' };
	const m = toDiscordMessage(r, decision.ephemeral);
	return {
		action: hasFile ? 'editWithFile' : 'edit',
		message: { content: m.content, embeds: m.embeds, components: m.components },
	};
}

if (typeof module !== 'undefined') module.exports = { formatResult, commandErrorText, isErrorResult };
