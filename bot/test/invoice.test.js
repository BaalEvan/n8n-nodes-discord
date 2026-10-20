import { describe, it, expect } from 'vitest';
const { loadModule } = require('./load.js');
const inv = loadModule('invoice');
const {
	MONTHS_PL,
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
	replies,
	notices,
} = inv;

const FOLDERS = [
	'01 - Styczeń',
	'02 - Luty',
	'03 - Marzec',
	'04 - Kwiecień',
	'05 - Maj',
	'06 - Czerwiec',
	'07 - Lipiec',
	'08 - Sierpień',
	'09 - Wrzesień',
	'10 - Październik',
	'11 - Listopad',
	'12 - Grudzień',
];

describe('months', () => {
	it('names every month folder exactly', () => {
		FOLDERS.forEach((f, i) => expect(monthFolderName(i + 1)).toBe(f));
		expect(MONTHS_PL).toHaveLength(12);
		expect(MONTHS_PL[7]).toBe('Sierpień');
	});
	it('gives the lowercase name', () => {
		expect(monthLowerPl(8)).toBe('sierpień');
		expect(monthLowerPl(1)).toBe('styczeń');
		expect(monthLowerPl(12)).toBe('grudzień');
	});
});

describe('parseDate', () => {
	it('accepts a real date', () => {
		expect(parseDate('2026-08-31')).toEqual({
			ok: true,
			year: 2026,
			month: 8,
			day: 31,
			iso: '2026-08-31',
		});
	});
	it('rejects impossible and malformed dates', () => {
		expect(parseDate('2026-02-30').ok).toBe(false);
		expect(parseDate('2026-13-01').ok).toBe(false);
		expect(parseDate('2026-8-31').ok).toBe(false);
		expect(parseDate('31-08-2026').ok).toBe(false);
		expect(parseDate('').ok).toBe(false);
		expect(parseDate(undefined).ok).toBe(false);
	});
	it('accepts a leap day only in a leap year', () => {
		expect(parseDate('2028-02-29').ok).toBe(true);
		expect(parseDate('2026-02-29').ok).toBe(false);
	});
	it('trims whitespace', () => {
		expect(parseDate(' 2026-08-31 ').iso).toBe('2026-08-31');
	});
});

describe('dateSuggestions', () => {
	it('uses the Warsaw date, not the UTC one', () => {
		const s = dateSuggestions(Date.parse('2026-08-31T23:30:00Z'));
		expect(s.map((x) => x.value)).toEqual(['2026-09-01', '2026-09-30', '2026-08-31']);
		s.forEach((x) => expect(x.name).toBe(x.value));
	});
	it('mid month', () => {
		const s = dateSuggestions(Date.parse('2026-08-15T10:00:00Z'));
		expect(s.map((x) => x.value)).toEqual(['2026-08-15', '2026-08-31', '2026-07-31']);
	});
	it('deduplicates on the last day of a month', () => {
		const s = dateSuggestions(Date.parse('2026-08-31T10:00:00Z'));
		expect(s.map((x) => x.value)).toEqual(['2026-08-31', '2026-07-31']);
	});
	it('crosses the year boundary', () => {
		const s = dateSuggestions(Date.parse('2026-01-10T10:00:00Z'));
		expect(s.map((x) => x.value)).toEqual(['2026-01-10', '2026-01-31', '2025-12-31']);
	});
	it('handles February in a leap year', () => {
		const s = dateSuggestions(Date.parse('2028-03-05T10:00:00Z'));
		expect(s[2].value).toBe('2028-02-29');
	});
});

describe('discordIds / findEmployee', () => {
	it('splits on comma, semicolon and whitespace', () => {
		expect(discordIds('111, 222;333  444')).toEqual(['111', '222', '333', '444']);
		expect(discordIds('')).toEqual([]);
		expect(discordIds(undefined)).toEqual([]);
		expect(discordIds(null)).toEqual([]);
	});
	it('matches either id on a multi-id row', () => {
		const rows = [{ discordID: '111, 222', fullname: 'A' }];
		expect(findEmployee(rows, '111')).toEqual({ ok: true, row: rows[0] });
		expect(findEmployee(rows, '222')).toEqual({ ok: true, row: rows[0] });
	});
	it('does not match a partial id', () => {
		expect(findEmployee([{ discordID: '1111' }], '111')).toEqual({
			ok: false,
			reason: 'none',
			count: 0,
		});
	});
	it('refuses an id on two rows', () => {
		const rows = [{ discordID: '111' }, { discordID: '5; 111' }];
		expect(findEmployee(rows, '111')).toEqual({ ok: false, reason: 'ambiguous', count: 2 });
	});
	it('never matches an empty cell or empty user id', () => {
		expect(findEmployee([{ discordID: '' }, { discordID: undefined }], '').reason).toBe('none');
		expect(findEmployee([{ discordID: '' }], '111').reason).toBe('none');
	});
	it('counts a row once even if its id repeats', () => {
		expect(findEmployee([{ discordID: '111, 111' }], '111').ok).toBe(true);
	});
});

describe('missingFields', () => {
	it('reports missing b2b fields', () => {
		expect(missingFields('b2b', { fullname: 'A', contract: 'B2B' })).toEqual(['b2bentity']);
		expect(missingFields('b2b', {})).toEqual(['fullname', 'b2bentity', 'contract']);
	});
	it('treats blank as missing', () => {
		expect(missingFields('b2b', { fullname: ' ', b2bentity: 'X', contract: 'B2B' })).toEqual([
			'fullname',
		]);
	});
	it('zlecenie and client', () => {
		expect(missingFields('zlecenie', { fullname: 'A' })).toEqual(['contract']);
		expect(missingFields('zlecenie', { fullname: 'A', contract: 'UZ' })).toEqual([]);
		expect(missingFields('client', {})).toEqual([]);
	});
});

describe('checkAttachment', () => {
	const MB = 1024 * 1024;
	const ok = { filename: 'a.pdf', content_type: 'application/pdf', size: 1000 };
	it('accepts a PDF by type', () => {
		expect(checkAttachment({ ...ok, filename: 'noext' }, 'invoice')).toBeNull();
	});
	it('accepts a PDF by name, case-insensitively', () => {
		expect(
			checkAttachment(
				{ filename: 'A.PDF', content_type: 'application/octet-stream', size: 5 },
				'x',
			),
		).toBeNull();
		expect(checkAttachment({ filename: 'A.Pdf', size: 5 }, 'x')).toBeNull();
	});
	it('rejects a PNG', () => {
		expect(
			checkAttachment({ filename: 'a.png', content_type: 'image/png', size: 5 }, 'timesheet'),
		).toBe('`timesheet` must be a PDF.');
	});
	it('enforces 20 MB exactly', () => {
		expect(checkAttachment({ ...ok, size: 20 * MB }, 'bill')).toBeNull();
		expect(checkAttachment({ ...ok, size: 20 * MB + 1 }, 'bill')).toBe(
			'`bill` is larger than 20 MB.',
		);
	});
	it('rejects a missing attachment', () => {
		expect(checkAttachment(undefined, 'invoice')).toBe('`invoice` must be a PDF.');
	});
});

describe('names', () => {
	const b2b = { contract: 'B2B', fullname: 'Jan Kowalski', b2bentity: 'Firma X' };
	it('b2b', () => {
		expect(names('b2b', b2b, { date: '2026-08-31' })).toEqual({
			personFolder: 'B2B - Jan Kowalski - Firma X',
			files: [{ option: 'invoice', fileName: 'B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-X.pdf' }],
		});
	});
	it('zlecenie', () => {
		expect(
			names('zlecenie', { contract: 'UZ', fullname: 'Jan Kowalski' }, { date: '2026-08-31' }),
		).toEqual({
			personFolder: 'UZ - Jan Kowalski',
			files: [
				{ option: 'timesheet', fileName: 'UZ-2026-08-31-Jan-Kowalski-TIMESHEET.pdf' },
				{ option: 'bill', fileName: 'UZ-2026-08-31-Jan-Kowalski-Bill.pdf' },
			],
		});
	});
	it('client keeps the attachment name and the Klienci folder', () => {
		expect(
			names(
				'client',
				{},
				{ date: '2026-08-31', attachments: { invoice: { filename: 'FV 1 2026.pdf' } } },
			),
		).toEqual({
			personFolder: 'Klienci',
			files: [{ option: 'invoice', fileName: 'FV 1 2026.pdf' }],
		});
	});
	it('trims row fields first', () => {
		const r = names(
			'b2b',
			{ contract: ' B2B ', fullname: ' Jan Kowalski ', b2bentity: ' Firma X ' },
			{ date: '2026-08-31' },
		);
		expect(r.personFolder).toBe('B2B - Jan Kowalski - Firma X');
		expect(r.files[0].fileName).toBe('B2B-INVOICE-2026-08-31-Jan-Kowalski-Firma-X.pdf');
	});
});

describe('isDriveAuthError', () => {
	it('true for 401 and 403, by any field', () => {
		expect(isDriveAuthError({ httpCode: 401 })).toBe(true);
		expect(isDriveAuthError({ httpCode: '403' })).toBe(true);
		expect(isDriveAuthError({ status: 401 })).toBe(true);
		expect(
			isDriveAuthError({ httpCode: 403, url: 'https://www.googleapis.com/drive/v3/files' }),
		).toBe(true);
	});
	it('false for a 401 from another host', () => {
		expect(isDriveAuthError({ httpCode: 401, url: 'https://example.com/x' })).toBe(false);
	});
	it('true for the token messages', () => {
		expect(isDriveAuthError({ message: 'invalid_grant' })).toBe(true);
		expect(isDriveAuthError({ description: 'Token has been expired or revoked.' })).toBe(true);
		expect(isDriveAuthError({ message: 'The invalid_token error' })).toBe(true);
	});
	it('false for 404, 500 and empties', () => {
		expect(isDriveAuthError({ httpCode: 404 })).toBe(false);
		expect(isDriveAuthError({ httpCode: 500, message: 'boom' })).toBe(false);
		expect(isDriveAuthError({})).toBe(false);
		expect(isDriveAuthError(undefined)).toBe(false);
	});
});

describe('replies', () => {
	it('fixed copy', () => {
		expect(replies.NOT_REGISTERED).toBe(
			"You're not registered for invoice uploads yet; ask the board.",
		);
		expect(replies.AMBIGUOUS).toBe(
			'Your Discord account matches more than one employee profile; ask the board.',
		);
		expect(replies.INCOMPLETE).toBe('Your employee profile is incomplete; ask the board.');
		expect(replies.FAILED).toBe('Something went wrong saving your file. The board has been told.');
	});
	it('option errors', () => {
		expect(replies.badDate('invoice')).toBe('`invoice` must be a date like 2026-08-31.');
		expect(replies.badPdf('bill')).toBe('`bill` must be a PDF.');
		expect(replies.tooLarge('bill')).toBe('`bill` is larger than 20 MB.');
	});
	it('success reply', () => {
		expect(inv.successReply(['a.pdf'], 'Invoices/2026/08 - Sierpień/Klienci', [])).toBe(
			'Uploaded `a.pdf` to `Invoices/2026/08 - Sierpień/Klienci`.',
		);
		expect(inv.successReply(['a.pdf', 'b.pdf'], 'P', ['b.pdf'])).toBe(
			'Uploaded `a.pdf` to `P`.\nUploaded `b.pdf` to `P`.\nA file named `b.pdf` was already there; both are kept.',
		);
		expect(inv.successReply(['a.pdf'], 'P')).toBe('Uploaded `a.pdf` to `P`.');
	});
});

describe('notices', () => {
	it('exposes the same functions under notices', () => {
		expect(notices.failureNote).toBe(inv.failureNote);
		expect(notices.clientNotice).toBe(inv.clientNotice);
		expect(replies.successReply).toBe(inv.successReply);
	});
	it('failure note', () => {
		expect(inv.failureNote('invoice-b2b', '42', 'upload', 'boom', false)).toBe(
			'⚠️ Invoice upload failed: /invoice-b2b by <@42> at step `upload`: boom',
		);
		expect(inv.failureNote('invoice-b2b', '42', 'upload', 'boom', true)).toBe(
			'⚠️ Invoice upload failed: /invoice-b2b by <@42> at step `upload`: boom\nGoogle Drive login has expired or was revoked — reconnect the `Google Drive account` credential in n8n.',
		);
	});
	it('failure note cuts a long reason to 1500 characters so the note fits in a Discord message', () => {
		const long = 'x'.repeat(5000);
		for (const auth of [false, true]) {
			const note = inv.failureNote(
				'invoice-zlecenie',
				'111111111111111111',
				'bill: upload',
				long,
				auth,
			);
			expect(note.length).toBeLessThan(2000);
			const reason = note.split('\n')[0].split('`bill: upload`: ')[1];
			expect(reason).toBe('x'.repeat(1500) + '…');
		}
		const edge = 'y'.repeat(1500);
		expect(inv.failureNote('invoice-b2b', '42', 'upload', edge, false)).toBe(
			'⚠️ Invoice upload failed: /invoice-b2b by <@42> at step `upload`: ' + edge,
		);
	});
	it('registration notes', () => {
		expect(inv.notRegisteredNote('invoice-zlecenie', '42')).toBe(
			'⚠️ <@42> tried /invoice-zlecenie but no Employee row has their Discord ID.',
		);
		expect(inv.ambiguousNote('invoice-zlecenie', '42', 2)).toBe(
			'⚠️ <@42> tried /invoice-zlecenie but their Discord ID is on 2 Employee rows.',
		);
		expect(inv.incompleteNote('invoice-b2b', '42', ['fullname', 'contract'])).toBe(
			'⚠️ <@42> tried /invoice-b2b but their Employee row is missing: fullname, contract.',
		);
	});
	it('b2b notice', () => {
		expect(
			inv.b2bNotice({
				shortname: 'Jan',
				hours: 160,
				month: 8,
				year: 2026,
				webContentLink: 'https://c',
				webViewLink: 'https://v',
			}),
		).toBe(
			'Cześć Dziadu, ten zjeb **Jan** wysłał fakture **(160 godzin)** za `sierpień` `2026`\n -> [Pobierz Dziadu](https://c)\n -> [Zobacz Dziadu](https://v)',
		);
	});
	it('zlecenie notice', () => {
		expect(
			inv.zlecenieNotice({
				shortname: 'Jan',
				month: 8,
				year: 2026,
				timesheetLink: 'https://t',
				billLink: 'https://b',
			}),
		).toBe(
			'Cześć Dziadu, ten kurwipołeć **Jan** Podpisał rachunek i godzinki za `sierpień` `2026`\n -> [Zobacz Godziny](https://t)\n -> [Zobacz Rachunek](https://b)',
		);
	});
	it('client notice', () => {
		const base = {
			fileName: 'FV.pdf',
			month: 8,
			year: 2026,
			description: 'Opis',
			webContentLink: 'https://c',
			webViewLink: 'https://v',
		};
		const head =
			'Któryś z was dzbany jebane wrzucił nową fakture dla klienta, pamiętajcie zeby ją dać na ksef i wysłać ją klientowi... bo jeszcze nie zapłaci i będzie na was pacany';
		const tail =
			'\n`FV.pdf` za `sierpień` `2026`\n\n OPIS Faktury: Opis\n -> [Pobierz Fakture](https://c)\n -> [Zobacz Fakture](https://v)';
		expect(inv.clientNotice({ ...base, uploader: 'Jan' })).toBe(head + ' (wrzucił: Jan)' + tail);
		expect(inv.clientNotice(base)).toBe(head + tail);
		expect(inv.clientNotice({ ...base, description: '' })).toContain('OPIS Faktury: -\n');
		expect(inv.clientNotice({ ...base, description: undefined })).toContain('OPIS Faktury: -\n');
	});
});
