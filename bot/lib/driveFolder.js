var MONTH_WORDS = [
	['styczen', 'sty', 'january', 'jan'],
	['luty', 'lut', 'february', 'feb'],
	['marzec', 'mar', 'march'],
	['kwiecien', 'kwi', 'april', 'apr'],
	['maj', 'may'],
	['czerwiec', 'cze', 'june', 'jun'],
	['lipiec', 'lip', 'july', 'jul'],
	['sierpien', 'sie', 'august', 'aug'],
	['wrzesien', 'wrz', 'september', 'sep', 'sept'],
	['pazdziernik', 'paz', 'october', 'oct'],
	['listopad', 'lis', 'november', 'nov'],
	['grudzien', 'gru', 'december', 'dec'],
];

function normalizeName(name) {
	return text(name)
		.replace(/\s+/g, ' ')
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ł/g, 'l');
}

function monthOf(name) {
	var m = /^(?:(\d{1,2})\s*[-.]?\s*)?([a-z]+)$/.exec(normalizeName(name));
	if (!m) return null;
	for (var i = 0; i < MONTH_WORDS.length; i++) {
		if (MONTH_WORDS[i].indexOf(m[2]) === -1) continue;
		return m[1] === undefined || Number(m[1]) === i + 1 ? i + 1 : null;
	}
	return null;
}

function oldestFolder(children, match) {
	var hits = (children || []).filter(function (c) {
		return c && match(c);
	});
	hits.sort(function (a, b) {
		var x = text(a.createdTime) || '9999';
		var y = text(b.createdTime) || '9999';
		return x < y ? -1 : x > y ? 1 : 0;
	});
	return hits.length ? hits[0] : null;
}

function pickExact(children, name) {
	var hit = oldestFolder(children, function (c) {
		return c.name === name;
	});
	return hit ? { id: hit.id } : null;
}

function pickPerson(children, name) {
	var want = normalizeName(name);
	var hit = oldestFolder(children, function (c) {
		return normalizeName(c.name) === want;
	});
	return hit ? { id: hit.id } : null;
}

function pickMonthFolder(children, month) {
	if (!month) return null;
	var canonical = monthFolderName(month);
	var exact = oldestFolder(children, function (c) {
		return c.name === canonical;
	});
	if (exact) return { id: exact.id, rename: null };
	var variant = oldestFolder(children, function (c) {
		return monthOf(c.name) === month;
	});
	return variant ? { id: variant.id, rename: canonical } : null;
}

function cachePath(year, month, person) {
	var key = text(year);
	if (month !== undefined && month !== null && month !== '') key += '/' + pad2(Number(month));
	if (person !== undefined && person !== null) key += '/' + normalizeName(person);
	return key;
}

function driveError(item) {
	var e = item && item.error !== undefined ? item.error : item;
	if (typeof e === 'string') e = { message: e };
	e = e || {};
	var code = Number(e.httpCode || e.status || e.statusCode) || 0;
	if (!code) {
		var m = /status code (\d{3})/.exec(text(e.cause && e.cause.message) + ' ' + text(e.message));
		if (m) code = Number(m[1]);
	}
	return {
		httpCode: code || null,
		message: text(e.description) || text(e.message) || 'unknown error',
		raw: e,
	};
}

function cacheAction(check) {
	var c = check || {};
	var failed =
		(c.error !== undefined && c.error !== null) || c.httpCode || c.status || c.statusCode;
	if (failed)
		return driveError(c.error !== undefined ? c : { error: c }).httpCode === 404 ? 'drop' : 'error';
	if (c.trashed === true) return 'drop';
	return text(c.id) ? 'use' : 'error';
}

function pickLevel(kind, children, name) {
	var list = children || [];
	var hit;
	if (kind === 'month') hit = pickMonthFolder(list, monthOf(name));
	else if (kind === 'person') hit = pickPerson(list, name);
	else hit = pickExact(list, name);
	if (!hit) return { action: 'create', id: null, rename: null, from: null };
	if (!hit.rename) return { action: 'use', id: hit.id, rename: null, from: null };
	var from = list.filter(function (c) {
		return c && c.id === hit.id;
	})[0].name;
	return { action: 'rename', id: hit.id, rename: hit.rename, from: from };
}

function levelResult(pick, response) {
	var p = pick || {};
	if (p.action === 'create')
		return { id: text(response && response.id), created: true, renamed: null };
	return {
		id: p.id,
		created: false,
		renamed: p.action === 'rename' ? { from: p.from, to: p.rename } : null,
	};
}

function levelError(kind, op, item) {
	var d = driveError(item);
	var auth = isDriveAuthError({
		httpCode: d.httpCode,
		url: d.raw.url,
		message: d.raw.message,
		description: d.raw.description,
	});
	return {
		error: { step: kind + ': ' + op, message: d.message, httpCode: d.httpCode, auth: auth },
	};
}

function inputError(field) {
	return {
		error: { step: 'input', message: 'missing or invalid ' + field, httpCode: null, auth: false },
	};
}

function folderPlan(input) {
	var i = input || {};
	var rootId = text(i.rootId);
	var year = Number(text(i.year) || NaN);
	var month = Number(text(i.month) || NaN);
	var person = text(i.personFolderName);
	if (!rootId) return inputError('rootId');
	if (!(year % 1 === 0 && year >= 1000 && year <= 9999)) return inputError('year');
	if (!(month % 1 === 0 && month >= 1 && month <= 12)) return inputError('month');
	if (!person) return inputError('personFolderName');
	var y = String(year);
	var m = monthFolderName(month);
	return {
		rootId: rootId,
		path: y + '/' + m + '/' + person,
		year: { name: y, cachePath: cachePath(y), path: y },
		month: { name: m, cachePath: cachePath(y, month), path: y + '/' + m },
		person: {
			name: person,
			cachePath: cachePath(y, month, person),
			path: y + '/' + m + '/' + person,
		},
	};
}

function folderDone(plan, results) {
	var levels = [plan.year, plan.month, plan.person];
	var created = [];
	var renamed = [];
	for (var i = 0; i < levels.length; i++) {
		var r = results[i] || {};
		if (r.created) created.push(levels[i].path);
		if (r.renamed) renamed.push(r.renamed);
	}
	return { folderId: results[2].id, path: plan.path, created: created, renamed: renamed };
}

function folderFailure(kind, result) {
	var r = result || {};
	if (r.error && typeof r.error === 'object' && r.error.step) return { error: r.error };
	var message = typeof r.error === 'string' && r.error ? r.error : 'no folder id returned';
	return { error: { step: kind + ': call', message: message, httpCode: null, auth: false } };
}

if (typeof module !== 'undefined')
	module.exports = {
		normalizeName,
		monthOf,
		pickExact,
		pickPerson,
		pickMonthFolder,
		cachePath,
		cacheAction,
		driveError,
		pickLevel,
		levelResult,
		levelError,
		folderPlan,
		folderDone,
		folderFailure,
	};
