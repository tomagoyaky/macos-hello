import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

const readText = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const readPackageJson = () => JSON.parse(readText('package.json'));

test('US-05 package.json declares no third-party dependencies', () => {
  const pkg = readPackageJson();
  for (const field of DEPENDENCY_FIELDS) {
    const value = pkg[field];
    assert.ok(
      value === undefined || (typeof value === 'object' && value !== null && Object.keys(value).length === 0),
      `${field} must be absent or an empty object, got ${JSON.stringify(value)}`,
    );
  }
});

test('US-05 pnpm list --prod --depth 0 reports zero entries', () => {
  const result = spawnSync('pnpm', ['list', '--prod', '--depth', '0', '--json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `pnpm list failed: ${result.error ?? result.stderr}`);
  const projects = JSON.parse(result.stdout);
  const entries = projects.flatMap((project) => [
    ...Object.keys(project.dependencies ?? {}),
    ...Object.keys(project.optionalDependencies ?? {}),
  ]);
  assert.deepEqual(entries, []);
});

test('S1 package.json keeps private, ESM, bin, engines, packageManager and test script', () => {
  const pkg = readPackageJson();
  assert.equal(pkg.private, true);
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.bin?.hello, './bin/hello.js');
  assert.equal(pkg.engines?.node, '>=20');
  assert.equal(pkg.packageManager, 'pnpm@10.28.2');
  assert.equal(pkg.scripts?.test, 'node --test');
});

test('S1 .nvmrc pins Node 20', () => {
  assert.equal(readText('.nvmrc').trim(), '20');
});

test('S1 README documents support scope and pnpm install method', () => {
  const readme = readText('README.md');
  assert.match(readme, /macOS/);
  assert.match(readme, /Node\.js\s*20\.x/);
  assert.match(readme, /10\.28\.2/);
  assert.match(readme, /corepack|npm (?:install|i) -g pnpm|brew install pnpm/);
});

test('S1 README lists at least three usage commands', () => {
  const lines = readText('README.md')
    .split('\n')
    .map((line) => line.trim().replace(/^\$\s+/, ''));
  const commands = new Set(lines.filter((line) => /^node bin\/hello\.js\b/.test(line) || line === 'pnpm test'));
  assert.ok(commands.has('node bin/hello.js'), `README must show the default command\nfound: ${[...commands].join(' | ')}`);
  assert.ok(
    [...commands].some((command) => command.startsWith('node bin/hello.js --name')),
    `README must show a --name usage example\nfound: ${[...commands].join(' | ')}`,
  );
  assert.ok(commands.size >= 3, `README must list at least three usage commands\nfound: ${[...commands].join(' | ')}`);
});

test('S1 pnpm-lock.yaml and .gitignore are committed', () => {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', 'pnpm-lock.yaml', '.gitignore'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});