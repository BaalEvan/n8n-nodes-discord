function workflowInput(classified) {
	return { mode: classified.kind, interaction: classified };
}

if (typeof module !== 'undefined') module.exports = { workflowInput };
