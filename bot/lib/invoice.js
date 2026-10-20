var MONTHS_PL = [
	'Styczeń',
	'Luty',
	'Marzec',
	'Kwiecień',
	'Maj',
	'Czerwiec',
	'Lipiec',
	'Sierpień',
	'Wrzesień',
	'Październik',
	'Listopad',
	'Grudzień',
];

var MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

var NOT_REGISTERED = "You're not registered for invoice uploads yet; ask the board.";
var AMBIGUOUS = 'Your Discord account matches more than one employee profile; ask the board.';
var INCOMPLETE = 'Your employee profile is incomplete; ask the board.';
var FAILED = 'Something went wrong saving your file. The board has been told.';
var DRIVE_AUTH_HINT =
	'Google Drive login has expired or was revoked — reconnect the `Google Drive account` credential in n8n.';

var REQUIRED = {
	b2b: ['fullname', 'b2bentity', 'contract'],
	zlecenie: ['fullname', 'contract'],
	client: [],
};

function text(v) {
	return v === undefined || v === null ? '' : String(v).trim();
}

function pad2(n) {
	return (n < 10 ? '0' : '') + n;
}

function monthFolderName(month) {
	return pad2(month) + ' - ' + MONTHS_PL[month - 1];
}

function monthLowerPl(month) {
	return MONTHS_PL[month - 1].toLowerCase();
}

function daysInMonth(year, month) {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDate(input) {
	var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(input));
	if (!m) return { ok: false };
	var year = Number(m[1]);
	var month = Number(m[2]);
	var day = Number(m[3]);
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return { ok: false };
	return { ok: true, year: year, month: month, day: day, iso: m[1] + '-' + m[2] + '-' + m[3] };
}

function isoOf(year, month, day) {
	return year + '-' + pad2(month) + '-' + pad2(day);
}

function warsawDate(nowMs) {
	var parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Europe/Warsaw',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(new Date(nowMs));
	var out = {};
	for (var i = 0; i < parts.length; i++) out[parts[i].type] = Number(parts[i].value);
	return out;
}

function dateSuggestions(nowMs) {
	var t = warsawDate(nowMs);
	var prevYear = t.month === 1 ? t.year - 1 : t.year;
	var prevMonth = t.month === 1 ? 12 : t.month - 1;
	var values = [
		isoOf(t.year, t.month, t.day),
		isoOf(t.year, t.month, daysInMonth(t.year, t.month)),
		isoOf(prevYear, prevMonth, daysInMonth(prevYear, prevMonth)),
	];
	var out = [];
	for (var i = 0; i < values.length; i++) {
		if (out.every((c) => c.value !== values[i])) out.push({ name: values[i], value: values[i] });
	}
	return out;
}

function discordIds(cell) {
	return text(cell)
		.split(/[\s,;]+/)
		.filter((s) => s);
}

function findEmployee(rows, userId) {
	var id = text(userId);
	var hits = [];
	if (id) {
		var list = rows || [];
		for (var i = 0; i < list.length; i++) {
			if (discordIds(list[i] && list[i].discordID).indexOf(id) !== -1) hits.push(list[i]);
		}
	}
	if (hits.length === 1) return { ok: true, row: hits[0] };
	return { ok: false, reason: hits.length ? 'ambiguous' : 'none', count: hits.length };
}

function missingFields(command, row) {
	var need = REQUIRED[command] || [];
	return need.filter((f) => !text(row && row[f]));
}

function isPdf(attachment) {
	var type = text(attachment.content_type).toLowerCase();
	return type === 'application/pdf' || /\.pdf$/i.test(text(attachment.filename));
}

function badDate(option) {
	return '`' + option + '` must be a date like 2026-08-31.';
}

function badPdf(option) {
	return '`' + option + '` must be a PDF.';
}

function tooLarge(option) {
	return '`' + option + '` is larger than 20 MB.';
}

function checkAttachment(attachment, option) {
	if (!attachment || !isPdf(attachment)) return badPdf(option);
	if (Number(attachment.size) > MAX_ATTACHMENT_BYTES) return tooLarge(option);
	return null;
}

function dashed(s) {
	return s.replace(/\s+/g, '-');
}

function names(command, row, input) {
	var r = row || {};
	var date = text(input && input.date);
	var contract = text(r.contract);
	var fullname = text(r.fullname);
	if (command === 'b2b') {
		var entity = text(r.b2bentity);
		return {
			personFolder: contract + ' - ' + fullname + ' - ' + entity,
			files: [
				{
					option: 'invoice',
					fileName:
						contract + '-INVOICE-' + date + '-' + dashed(fullname) + '-' + dashed(entity) + '.pdf',
				},
			],
		};
	}
	if (command === 'zlecenie') {
		var base = contract + '-' + date + '-' + dashed(fullname);
		return {
			personFolder: contract + ' - ' + fullname,
			files: [
				{ option: 'timesheet', fileName: base + '-TIMESHEET.pdf' },
				{ option: 'bill', fileName: base + '-Bill.pdf' },
			],
		};
	}
	var att = input && input.attachments && input.attachments.invoice;
	return {
		personFolder: 'Klienci',
		files: [{ option: 'invoice', fileName: att ? att.filename : '' }],
	};
}

function isDriveAuthError(err) {
	var e = err || {};
	var code = Number(e.httpCode || e.status || e.statusCode);
	if (code === 401 || code === 403) {
		var url = text(e.url);
		if (!url || url.indexOf('googleapis.com') !== -1) return true;
	}
	var msg = text(e.message) + ' ' + text(e.description);
	return /invalid_grant|Token has been expired or revoked|invalid_token/.test(msg);
}

function successReply(files, path, duplicates) {
	var lines = [];
	var list = files || [];
	for (var i = 0; i < list.length; i++) lines.push('Uploaded `' + list[i] + '` to `' + path + '`.');
	var dups = duplicates || [];
	for (var j = 0; j < dups.length; j++)
		lines.push('A file named `' + dups[j] + '` was already there; both are kept.');
	return lines.join('\n');
}

function failureNote(command, userId, step, reason, auth) {
	var note =
		'⚠️ Invoice upload failed: /' +
		command +
		' by <@' +
		userId +
		'> at step `' +
		step +
		'`: ' +
		reason;
	return auth ? note + '\n' + DRIVE_AUTH_HINT : note;
}

function notRegisteredNote(command, userId) {
	return '⚠️ <@' + userId + '> tried /' + command + ' but no Employee row has their Discord ID.';
}

function ambiguousNote(command, userId, count) {
	return (
		'⚠️ <@' + userId + '> tried /' + command + ' but their Discord ID is on ' + count + ' Employee rows.'
	);
}

function incompleteNote(command, userId, fields) {
	return (
		'⚠️ <@' +
		userId +
		'> tried /' +
		command +
		' but their Employee row is missing: ' +
		(fields || []).join(', ') +
		'.'
	);
}

function monthWord(month) {
	return typeof month === 'number' ? monthLowerPl(month) : text(month);
}

function b2bNotice(p) {
	return (
		'Cześć Dziadu, ten zjeb **' +
		p.shortname +
		'** wysłał fakture **(' +
		p.hours +
		' godzin)** za `' +
		monthWord(p.month) +
		'` `' +
		p.year +
		'`\n -> [Pobierz Dziadu](' +
		p.webContentLink +
		')\n -> [Zobacz Dziadu](' +
		p.webViewLink +
		')'
	);
}

function zlecenieNotice(p) {
	return (
		'Cześć Dziadu, ten kurwipołeć **' +
		p.shortname +
		'** Podpisał rachunek i godzinki za `' +
		monthWord(p.month) +
		'` `' +
		p.year +
		'`\n -> [Zobacz Godziny](' +
		p.timesheetLink +
		')\n -> [Zobacz Rachunek](' +
		p.billLink +
		')'
	);
}

function clientNotice(p) {
	var uploader = text(p.uploader);
	return (
		'Któryś z was dzbany jebane wrzucił nową fakture dla klienta, pamiętajcie zeby ją dać na ksef i wysłać ją klientowi... bo jeszcze nie zapłaci i będzie na was pacany' +
		(uploader ? ' (wrzucił: ' + uploader + ')' : '') +
		'\n`' +
		p.fileName +
		'` za `' +
		monthWord(p.month) +
		'` `' +
		p.year +
		'`\n\n OPIS Faktury: ' +
		(text(p.description) || '-') +
		'\n -> [Pobierz Fakture](' +
		p.webContentLink +
		')\n -> [Zobacz Fakture](' +
		p.webViewLink +
		')'
	);
}

var replies = {
	NOT_REGISTERED,
	AMBIGUOUS,
	INCOMPLETE,
	FAILED,
	badDate,
	badPdf,
	tooLarge,
	successReply,
};

var notices = {
	DRIVE_AUTH_HINT,
	failureNote,
	notRegisteredNote,
	ambiguousNote,
	incompleteNote,
	b2bNotice,
	zlecenieNotice,
	clientNotice,
};

if (typeof module !== 'undefined')
	module.exports = {
		MONTHS_PL,
		MAX_ATTACHMENT_BYTES,
		monthFolderName,
		monthLowerPl,
		parseDate,
		dateSuggestions,
		discordIds,
		findEmployee,
		missingFields,
		checkAttachment,
		names,
		isDriveAuthError,
		successReply,
		failureNote,
		notRegisteredNote,
		ambiguousNote,
		incompleteNote,
		b2bNotice,
		zlecenieNotice,
		clientNotice,
		replies,
		notices,
	};
