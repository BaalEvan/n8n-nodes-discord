const NAME_PATTERN = '^[-_\\p{Ll}\\p{N}]{1,32}$';
const NAME_RE = new RegExp(NAME_PATTERN, 'u');

function checkName(value, path, errors) {
	if (typeof value !== 'string' || !NAME_RE.test(value)) {
		errors.push(path + ': must match ' + NAME_PATTERN);
	}
}

function checkDescription(value, path, errors) {
	if (typeof value !== 'string' || value.length < 1 || value.length > 100) {
		errors.push(path + ': must be 1-100 characters');
	}
}

function checkOptions(options, path, errors) {
	if (!Array.isArray(options)) {
		errors.push(path + ': must be an array');
		return;
	}
	if (options.length > 25) errors.push(path + ': at most 25 options');
	options.forEach(function (option, i) {
		const p = path + '[' + i + ']';
		if (!option || typeof option !== 'object' || Array.isArray(option)) {
			errors.push(p + ': must be an object');
			return;
		}
		checkName(option.name, p + '.name', errors);
		checkDescription(option.description, p + '.description', errors);
		if (!Number.isInteger(option.type) || option.type < 1 || option.type > 11) {
			errors.push(p + '.type: must be an integer from 1 to 11');
		}
		if (option.choices !== undefined) {
			if (!Array.isArray(option.choices)) errors.push(p + '.choices: must be an array');
			else if (option.choices.length > 25) errors.push(p + '.choices: at most 25 choices');
		}
		if (option.options !== undefined) checkOptions(option.options, p + '.options', errors);
	});
}

function checkIdList(list, path, errors) {
	if (list === undefined) return;
	if (!Array.isArray(list) || list.some(function (v) { return typeof v !== 'string'; })) {
		errors.push(path + ': must be an array of strings');
	}
}

const SCOPES = ['guild', 'global'];
const GLOBAL_DEFAULTS = { contexts: [0, 1, 2], integration_types: [0, 1] };

function checkEnumList(list, allowed, path, errors) {
	const ok =
		Array.isArray(list) &&
		list.length > 0 &&
		list.every(function (v, i) {
			return allowed.indexOf(v) !== -1 && list.indexOf(v) === i;
		});
	if (!ok) errors.push(path + ': must be a non-empty array of distinct values from ' + allowed.join(', '));
}

function checkScope(def, errors) {
	if (def.scope !== undefined && SCOPES.indexOf(def.scope) === -1) {
		errors.push('scope: must be "guild" or "global"');
		return;
	}
	const global = def.scope === 'global';
	Object.keys(GLOBAL_DEFAULTS).forEach(function (key) {
		if (def[key] === undefined) return;
		if (!global) errors.push(key + ': only for "scope": "global"');
		else checkEnumList(def[key], GLOBAL_DEFAULTS[key], key, errors);
	});
}

function applyScopeDefaults(def) {
	if (def.scope !== 'global') return def;
	Object.keys(GLOBAL_DEFAULTS).forEach(function (key) {
		if (def[key] === undefined) def[key] = GLOBAL_DEFAULTS[key].slice();
	});
	return def;
}

function checkModals(modals, errors) {
	if (!modals || typeof modals !== 'object' || Array.isArray(modals)) {
		errors.push('modals: must be an object');
		return;
	}
	Object.keys(modals).forEach(function (action) {
		const p = 'modals.' + action;
		const modal = modals[action];
		if (action.indexOf(':') !== -1 || action === '') errors.push(p + ': action must be non-empty and contain no ":"');
		if (!modal || typeof modal !== 'object') {
			errors.push(p + ': must be an object');
			return;
		}
		if (typeof modal.title !== 'string' || modal.title.length < 1 || modal.title.length > 45) {
			errors.push(p + '.title: must be 1-45 characters');
		}
		if (!Array.isArray(modal.fields) || modal.fields.length < 1 || modal.fields.length > 5) {
			errors.push(p + '.fields: must be an array of 1-5 fields');
			return;
		}
		modal.fields.forEach(function (f, i) {
			const fp = p + '.fields[' + i + ']';
			if (!f || typeof f.id !== 'string' || f.id === '') errors.push(fp + '.id: must be a non-empty string');
			if (!f || typeof f.label !== 'string' || f.label === '' || f.label.length > 45) {
				errors.push(fp + '.label: must be 1-45 characters');
			}
			if (f && f.style !== undefined && f.style !== 'short' && f.style !== 'paragraph') {
				errors.push(fp + '.style: must be "short" or "paragraph"');
			}
			if (f && f.required !== undefined && typeof f.required !== 'boolean') {
				errors.push(fp + '.required: must be a boolean');
			}
			if (f && f.maxLength !== undefined && (!Number.isInteger(f.maxLength) || f.maxLength < 1 || f.maxLength > 4000)) {
				errors.push(fp + '.maxLength: must be an integer from 1 to 4000');
			}
		});
	});
}

function parseDefinition(jsonText) {
	let def;
	try {
		def = JSON.parse(jsonText);
	} catch (e) {
		return { ok: false, errors: ['definition: not valid JSON (' + e.message + ')'] };
	}
	if (!def || typeof def !== 'object' || Array.isArray(def)) {
		return { ok: false, errors: ['definition: must be a JSON object'] };
	}
	const errors = [];
	checkName(def.name, 'name', errors);
	checkDescription(def.description, 'description', errors);
	if (def.options !== undefined) checkOptions(def.options, 'options', errors);
	if (def.whitelist !== undefined) {
		if (!def.whitelist || typeof def.whitelist !== 'object' || Array.isArray(def.whitelist)) {
			errors.push('whitelist: must be an object');
		} else {
			checkIdList(def.whitelist.users, 'whitelist.users', errors);
			checkIdList(def.whitelist.roles, 'whitelist.roles', errors);
			if (def.whitelist.everyone !== undefined && typeof def.whitelist.everyone !== 'boolean') {
				errors.push('whitelist.everyone: must be a boolean');
			}
		}
	}
	if (def.ephemeral !== undefined && typeof def.ephemeral !== 'boolean') errors.push('ephemeral: must be a boolean');
	if (def.modals !== undefined) checkModals(def.modals, errors);
	checkScope(def, errors);
	return errors.length ? { ok: false, errors: errors } : { ok: true, definition: applyScopeDefaults(def) };
}

if (typeof module !== 'undefined') module.exports = { parseDefinition };
