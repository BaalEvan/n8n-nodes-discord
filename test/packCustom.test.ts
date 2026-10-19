/* eslint-disable @n8n/community-nodes/no-restricted-imports, @n8n/community-nodes/no-restricted-globals, @n8n/community-nodes/no-dangerous-functions */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');

function listFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = join(dir, entry.name);
		return entry.isDirectory() ? listFiles(full) : [full];
	});
}

describe('pack:custom', () => {
	it('pack produces a loadable folder', () => {
		// Relies on an existing dist/ (npm run pack:custom builds first); builds only if missing.
		if (!existsSync(join(root, 'dist', 'nodes'))) {
			execFileSync('npm', ['run', 'build'], { cwd: root, shell: true, stdio: 'pipe' });
		}
		execFileSync(process.execPath, ['scripts/pack-custom.mjs'], { cwd: root, stdio: 'pipe' });

		const source = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
		const name = `n8n-nodes-discord-${source.version}`;
		const folder = join(root, 'release', name);
		expect(existsSync(folder)).toBe(true);

		const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
		expect(pkg.n8n.nodes).toHaveLength(4);
		expect(pkg.n8n.credentials).toHaveLength(4);
		for (const file of [...pkg.n8n.nodes, ...pkg.n8n.credentials]) {
			expect(existsSync(join(folder, file)), file).toBe(true);
		}
		expect(pkg).not.toHaveProperty('devDependencies');
		expect(pkg).not.toHaveProperty('scripts');
		expect(pkg).not.toHaveProperty('files');
		expect(pkg.dependencies).toBeUndefined();

		const all = listFiles(join(folder, 'dist'));
		expect(all.filter((f) => f.endsWith('.map') || f.endsWith('.tsbuildinfo'))).toEqual([]);

		const tarball = join(root, 'release', `${name}.tar.gz`);
		expect(existsSync(tarball)).toBe(true);
		const entries = execFileSync('tar', ['-tzf', `${name}.tar.gz`], {
			cwd: join(root, 'release'),
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
		})
			.split('\n')
			.filter(Boolean);
		expect(entries.every((e) => e.startsWith(`${name}/`))).toBe(true);
		expect(entries).toContain(`${name}/package.json`);
	});
});
