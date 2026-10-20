import { describe, it, expect } from 'vitest';
const fs = require('fs');
const path = require('path');
const { loadModule } = require('./load.js');
const {
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
} = loadModule('driveFolder', ['invoice']);

const f = (id, name, createdTime) => ({ id, name, createdTime });

describe('inlined together with invoice.js', () => {
	const topNames = (file) => {
		const src = fs.readFileSync(path.join(__dirname, '..', 'lib', file), 'utf8');
		return [...src.matchAll(/^(?:var|let|const|function)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
	};
	it('declares no top-level name that invoice.js already has', () => {
		const invoice = new Set(topNames('invoice.js'));
		const clash = topNames('driveFolder.js').filter((n) => invoice.has(n));
		expect(clash).toEqual([]);
	});
});

describe('normalizeName', () => {
	it('trims, collapses whitespace, lowercases and strips Polish diacritics', () => {
		expect(normalizeName('  B2B - Jan  Kowalski\t- Firma ')).toBe('b2b - jan kowalski - firma');
		expect(normalizeName('ZAŻÓŁĆ gęślą jaźń')).toBe('zazolc gesla jazn');
		expect(normalizeName('Michał Łoś')).toBe('michal los');
		expect(normalizeName(null)).toBe('');
	});
});

describe('monthOf', () => {
	it('reads Polish and English month names with or without a number prefix', () => {
		for (const name of ['sierpien', 'Sierpień', '08 - Sierpień', '8. sierpień', 'August', 'aug']) {
			expect(monthOf(name), name).toBe(8);
		}
		expect(monthOf('08-Sierpień')).toBe(8);
		expect(monthOf('08 – Sierpień')).toBe(8);
		expect(monthOf('08—Sierpień')).toBe(8);
		expect(monthOf('08_sierpien')).toBe(8);
		expect(monthOf('sierpnia')).toBe(8);
		expect(monthOf('09 - września')).toBe(9);
		expect(monthOf('wrzesnia')).toBe(9);
		expect(monthOf('8 sierpien')).toBe(8);
		expect(monthOf('SIE')).toBe(8);
		expect(monthOf('01 - Styczeń')).toBe(1);
		expect(monthOf('Październik')).toBe(10);
		expect(monthOf('Sept')).toBe(9);
		expect(monthOf('maj')).toBe(5);
		expect(monthOf('May')).toBe(5);
		expect(monthOf('12 - Grudzień')).toBe(12);
	});
	it('reads every Polish genitive month name, with or without diacritics', () => {
		const genitive = [
			'stycznia',
			'lutego',
			'marca',
			'kwietnia',
			'maja',
			'czerwca',
			'lipca',
			'sierpnia',
			'września',
			'października',
			'listopada',
			'grudnia',
		];
		genitive.forEach((name, i) => {
			expect(monthOf(name), name).toBe(i + 1);
			expect(monthOf(normalizeName(name)), name).toBe(i + 1);
			expect(monthOf(String(i + 1).padStart(2, '0') + ' – ' + name), name).toBe(i + 1);
		});
	});
	it('refuses anything that is not just a month name', () => {
		expect(monthOf('Sierpniowy raport')).toBeNull();
		expect(monthOf('08 – września')).toBeNull();
		expect(monthOf('08 _ - sierpien')).toBeNull();
		expect(monthOf('sierpień 2026')).toBeNull();
		expect(monthOf('2026')).toBeNull();
		expect(monthOf('08')).toBeNull();
		expect(monthOf('07 - Sierpień')).toBeNull();
		expect(monthOf('13 - Sierpień')).toBeNull();
		expect(monthOf('')).toBeNull();
		expect(monthOf(undefined)).toBeNull();
	});
});

describe('pickExact', () => {
	it('matches the exact name only, oldest createdTime first', () => {
		const children = [
			f('a', '2026', '2026-02-01T00:00:00.000Z'),
			f('b', '2026 ', '2025-01-01T00:00:00.000Z'),
			f('c', '2026', '2026-01-01T00:00:00.000Z'),
			f('d', '2025', '2024-01-01T00:00:00.000Z'),
		];
		expect(pickExact(children, '2026')).toEqual({ id: 'c' });
		expect(pickExact(children, '2027')).toBeNull();
		expect(pickExact([], '2026')).toBeNull();
		expect(pickExact(undefined, '2026')).toBeNull();
	});
});

describe('pickPerson', () => {
	it('matches after normalising and keeps the oldest', () => {
		const children = [
			f('new', 'B2B - Jan Kowalski - Firma', '2026-03-01T00:00:00.000Z'),
			f('old', 'B2B - Jan  Kowalski - Firma', '2025-03-01T00:00:00.000Z'),
			f('x', 'B2B - Jan Nowak - Firma', '2020-03-01T00:00:00.000Z'),
		];
		expect(pickPerson(children, 'B2B - Jan Kowalski - Firma')).toEqual({ id: 'old' });
		expect(pickPerson([children[1]], 'B2B - Jan Kowalski - Firma')).toEqual({ id: 'old' });
		expect(pickPerson(children, 'b2b - jan kowalski - firmą')).toEqual({ id: 'old' });
		expect(pickPerson(children, 'B2B - Anna Kowalska - Firma')).toBeNull();
	});
});

describe('pickMonthFolder', () => {
	it('reuses the oldest variant and renames it to the canonical name', () => {
		const children = [
			f('en', 'August', '2026-01-01T00:00:00.000Z'),
			f('pl', 'sierpien', '2025-12-01T00:00:00.000Z'),
			f('jul', 'Lipiec', '2020-01-01T00:00:00.000Z'),
		];
		expect(pickMonthFolder(children, 8)).toEqual({ id: 'pl', rename: '08 - Sierpień' });
	});
	it('prefers a folder that already has the canonical name, with no rename', () => {
		const children = [
			f('pl', 'sierpien', '2025-12-01T00:00:00.000Z'),
			f('ok', '08 - Sierpień', '2026-01-01T00:00:00.000Z'),
		];
		expect(pickMonthFolder(children, 8)).toEqual({ id: 'ok', rename: null });
	});
	it('returns null when no folder is that month', () => {
		expect(pickMonthFolder([f('jul', '07 - Lipiec', '2020-01-01T00:00:00.000Z')], 8)).toBeNull();
		expect(pickMonthFolder([], 8)).toBeNull();
		expect(pickMonthFolder([f('pl', 'sierpien', '')], null)).toBeNull();
	});
});

describe('cachePath', () => {
	it('builds root/year, root/year/month and root/year/month/normalised person keys', () => {
		expect(cachePath('ROOT', 2026)).toBe('ROOT/2026');
		expect(cachePath('ROOT', '2026', 8)).toBe('ROOT/2026/08');
		expect(cachePath('ROOT', 2026, 12)).toBe('ROOT/2026/12');
		expect(cachePath('ROOT', 2026, 8, 'B2B - Jan  Kowalski - Firma')).toBe(
			'ROOT/2026/08/b2b - jan kowalski - firma',
		);
	});
	it('gives a different key for the same folder under another root', () => {
		expect(cachePath('TEST', 2026, 8, 'Klienci')).not.toBe(cachePath('PROD', 2026, 8, 'Klienci'));
	});
});

describe('cacheAction', () => {
	it('uses a live folder', () => {
		expect(cacheAction({ id: 'f1', trashed: false })).toBe('use');
	});
	it('drops a folder that is gone or trashed', () => {
		expect(cacheAction({ id: 'f1', trashed: true })).toBe('drop');
		expect(cacheAction({ error: { httpCode: '404', message: 'File not found' } })).toBe('drop');
		expect(cacheAction({ error: { status: 404 } })).toBe('drop');
		expect(cacheAction({ httpCode: 404 })).toBe('drop');
	});
	it('drops a folder that was moved out of the expected parent', () => {
		expect(cacheAction({ id: 'f1', trashed: false, parents: ['elsewhere'] }, 'p1')).toBe('drop');
		expect(cacheAction({ id: 'f1', trashed: false, parents: [] }, 'p1')).toBe('drop');
	});
	it('uses a folder still under the expected parent, or one whose parents are unknown', () => {
		expect(cacheAction({ id: 'f1', trashed: false, parents: ['p1'] }, 'p1')).toBe('use');
		expect(cacheAction({ id: 'f1', trashed: false, parents: ['p0', 'p1'] }, 'p1')).toBe('use');
		expect(cacheAction({ id: 'f1', trashed: false }, 'p1')).toBe('use');
	});
	it('never drops a moved folder on an auth or server error', () => {
		expect(cacheAction({ error: { httpCode: '401' }, parents: ['elsewhere'] }, 'p1')).toBe('error');
		expect(cacheAction({ error: { httpCode: '503' } }, 'p1')).toBe('error');
	});
	it('never drops on an auth, server or unknown error', () => {
		expect(cacheAction({ error: { httpCode: '401', message: 'Unauthorized' } })).toBe('error');
		expect(cacheAction({ error: { httpCode: '403' } })).toBe('error');
		expect(cacheAction({ error: { httpCode: '500' } })).toBe('error');
		expect(cacheAction({ error: { httpCode: '503' } })).toBe('error');
		expect(cacheAction({ error: { message: 'invalid_grant' } })).toBe('error');
		expect(cacheAction({ error: 'socket hang up' })).toBe('error');
		expect(cacheAction({ status: 401 })).toBe('error');
		expect(cacheAction({})).toBe('error');
		expect(cacheAction(null)).toBe('error');
	});
});

describe('driveError', () => {
	it('reads the status and the most specific message', () => {
		expect(
			driveError({
				error: { httpCode: '404', message: 'Not found', description: 'File not found: x.' },
			}),
		).toMatchObject({ httpCode: 404, message: 'File not found: x.' });
		expect(driveError({ error: { message: 'boom' } })).toMatchObject({
			httpCode: null,
			message: 'boom',
		});
		expect(
			driveError({
				error: { message: 'x', cause: { message: 'Request failed with status code 502' } },
			}),
		).toMatchObject({ httpCode: 502 });
		expect(driveError({ error: 'plain' })).toMatchObject({ httpCode: null, message: 'plain' });
		expect(driveError(undefined)).toMatchObject({ httpCode: null, message: 'unknown error' });
	});
});

describe('pickLevel', () => {
	const kids = [
		f('y', '2026', '2025-01-01T00:00:00.000Z'),
		f('m', 'Sierpień', '2025-01-02T00:00:00.000Z'),
		f('p', 'B2B - Jan  Kowalski - Firma', '2025-01-03T00:00:00.000Z'),
	];
	it('uses an exact year, a normalised person, or renames a month variant', () => {
		expect(pickLevel('year', kids, '2026')).toEqual({
			action: 'use',
			id: 'y',
			rename: null,
			from: null,
		});
		expect(pickLevel('person', kids, 'B2B - Jan Kowalski - Firma')).toEqual({
			action: 'use',
			id: 'p',
			rename: null,
			from: null,
		});
		expect(pickLevel('month', kids, '08 - Sierpień')).toEqual({
			action: 'rename',
			id: 'm',
			rename: '08 - Sierpień',
			from: 'Sierpień',
		});
	});
	it('asks to create when nothing matches', () => {
		const create = { action: 'create', id: null, rename: null, from: null };
		expect(pickLevel('year', kids, '2027')).toEqual(create);
		expect(pickLevel('month', kids, '09 - Wrzesień')).toEqual(create);
		expect(pickLevel('person', undefined, 'X')).toEqual(create);
	});
});

describe('levelResult', () => {
	it('reports the folder id and what changed', () => {
		expect(levelResult({ action: 'use', id: 'a' }, {})).toEqual({
			id: 'a',
			created: false,
			renamed: null,
		});
		expect(
			levelResult({ action: 'rename', id: 'a', rename: '08 - Sierpień', from: 'sierpien' }, {}),
		).toEqual({ id: 'a', created: false, renamed: { from: 'sierpien', to: '08 - Sierpień' } });
		expect(levelResult({ action: 'create', id: null }, { id: 'new', name: '2026' })).toEqual({
			id: 'new',
			created: true,
			renamed: null,
		});
	});
});

describe('levelError', () => {
	it('labels the step and flags Drive auth errors', () => {
		expect(
			levelError('month', 'list', { error: { httpCode: '401', message: 'Unauthorized' } }),
		).toEqual({
			error: { step: 'month: list', message: 'Unauthorized', httpCode: 401, auth: true },
		});
		expect(
			levelError('person', 'create', { error: { httpCode: '500', message: 'Backend Error' } }),
		).toEqual({
			error: { step: 'person: create', message: 'Backend Error', httpCode: 500, auth: false },
		});
		expect(
			levelError('year', 'cache', {
				error: { message: 'invalid_grant: Token has been expired or revoked.' },
			}).error,
		).toMatchObject({ step: 'year: cache', httpCode: null, auth: true });
	});
});

describe('folderPlan', () => {
	it('builds the names, cache keys and display path for each level', () => {
		expect(
			folderPlan({
				rootId: 'ROOT',
				year: 2026,
				month: 8,
				personFolderName: 'B2B - Jan Kowalski - Firma',
			}),
		).toEqual({
			rootId: 'ROOT',
			path: '2026/08 - Sierpień/B2B - Jan Kowalski - Firma',
			year: { name: '2026', cachePath: 'ROOT/2026', path: '2026' },
			month: { name: '08 - Sierpień', cachePath: 'ROOT/2026/08', path: '2026/08 - Sierpień' },
			person: {
				name: 'B2B - Jan Kowalski - Firma',
				cachePath: 'ROOT/2026/08/b2b - jan kowalski - firma',
				path: '2026/08 - Sierpień/B2B - Jan Kowalski - Firma',
			},
		});
		expect(
			folderPlan({ rootId: 'R', year: '2026', month: '1', personFolderName: 'Klienci' }).month,
		).toEqual({ name: '01 - Styczeń', cachePath: 'R/2026/01', path: '2026/01 - Styczeń' });
	});
	it('returns an input error instead of throwing', () => {
		const ok = { rootId: 'R', year: 2026, month: 8, personFolderName: 'Klienci' };
		for (const [field, value] of [
			['rootId', ''],
			['year', null],
			['year', 26],
			['month', 0],
			['month', 13],
			['month', 2.5],
			['personFolderName', '  '],
		]) {
			const out = folderPlan({ ...ok, [field]: value });
			expect(out.error, field).toEqual({
				step: 'input',
				message: 'missing or invalid ' + field,
				httpCode: null,
				auth: false,
			});
		}
		expect(folderPlan(undefined).error.step).toBe('input');
	});
});

describe('folderDone', () => {
	const plan = folderPlan({ rootId: 'R', year: 2026, month: 8, personFolderName: 'Klienci' });
	it('returns the person folder id, the path and what was created or renamed', () => {
		expect(
			folderDone(plan, [
				{ id: 'y', created: false, renamed: null },
				{ id: 'm', created: false, renamed: { from: 'sierpien', to: '08 - Sierpień' } },
				{ id: 'p', created: true, renamed: null },
			]),
		).toEqual({
			folderId: 'p',
			path: '2026/08 - Sierpień/Klienci',
			created: ['2026/08 - Sierpień/Klienci'],
			renamed: [{ from: 'sierpien', to: '08 - Sierpień' }],
		});
	});
	it('lists every created level in order', () => {
		const made = { created: true, renamed: null };
		expect(
			folderDone(plan, [
				{ id: 'y', ...made },
				{ id: 'm', ...made },
				{ id: 'p', ...made },
			]).created,
		).toEqual(['2026', '2026/08 - Sierpień', '2026/08 - Sierpień/Klienci']);
	});
});

describe('folderFailure', () => {
	it('passes a level error through unchanged', () => {
		const error = { step: 'month: list', message: 'Unauthorized', httpCode: 401, auth: true };
		expect(folderFailure('month', { error })).toEqual({ error });
	});
	it('wraps a failed sub-workflow call', () => {
		expect(folderFailure('person', { error: 'Workflow does not exist.' })).toEqual({
			error: {
				step: 'person: call',
				message: 'Workflow does not exist.',
				httpCode: null,
				auth: false,
			},
		});
		expect(folderFailure('year', {})).toEqual({
			error: { step: 'year: call', message: 'no folder id returned', httpCode: null, auth: false },
		});
	});
});
