function cutContent(value) {
	const s = value === undefined || value === null ? '' : String(value);
	return s.length > 2000 ? s.slice(0, 1999) + '…' : s;
}

function followupList(result) {
	if (!result) return [];
	if (Array.isArray(result.followups)) return result.followups;
	if (result.followup && typeof result.followup === 'object') return [result.followup];
	return [];
}

function toDiscordMessage(result, defaultEphemeral) {
	const r = result && typeof result === 'object' ? result : {};
	const content = cutContent(r.content);
	const embeds = Array.isArray(r.embeds) ? r.embeds : [];
	const components = Array.isArray(r.components) ? r.components : [];
	if (!content && embeds.length === 0 && components.length === 0) {
		return { content: 'Done.', embeds: [], components: [], flags: 64 };
	}
	const ephemeral = typeof r.ephemeral === 'boolean' ? r.ephemeral : defaultEphemeral === true;
	return { content: content, embeds: embeds, components: components, flags: ephemeral ? 64 : 0 };
}

function toFollowups(result) {
	return followupList(result)
		.slice(0, 10)
		.filter(function (f) {
			return (
				f &&
				(f.content ||
					(Array.isArray(f.embeds) && f.embeds.length > 0) ||
					(Array.isArray(f.components) && f.components.length > 0))
			);
		})
		.map(function (f) {
			return {
				content: cutContent(f.content),
				embeds: Array.isArray(f.embeds) ? f.embeds : [],
				components: Array.isArray(f.components) ? f.components : [],
				flags: f.ephemeral ? 64 : 0,
			};
		});
}

if (typeof module !== 'undefined') module.exports = { toDiscordMessage, toFollowups };
