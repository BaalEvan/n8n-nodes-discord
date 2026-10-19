import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const name = `n8n-nodes-discord-${pkg.version}`;
const releaseDir = join(root, 'release');
const target = join(releaseDir, name);
const tarball = `${name}.tar.gz`;

if (!existsSync(join(root, 'dist', 'nodes'))) {
	console.error('dist/ is missing. Run "npm run build" first (or use "npm run pack:custom").');
	process.exit(1);
}

rmSync(target, { recursive: true, force: true });
rmSync(join(releaseDir, tarball), { force: true });
mkdirSync(target, { recursive: true });

cpSync(join(root, 'dist'), join(target, 'dist'), {
	recursive: true,
	filter: (src) => !src.endsWith('.map') && !src.endsWith('.tsbuildinfo'),
});

const { devDependencies, scripts, files, ...runtime } = pkg;
writeFileSync(join(target, 'package.json'), `${JSON.stringify(runtime, null, '\t')}\n`);

// Relative names with cwd=release keep GNU tar from reading "C:" as a remote host.
execFileSync('tar', ['-czf', tarball, name], { cwd: releaseDir });

console.log(`Folder:  ${target}`);
console.log(`Tarball: ${join(releaseDir, tarball)}`);
