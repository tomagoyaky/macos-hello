import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGE_URL = new URL('../package.json', import.meta.url);
const CORE_TEST_FILES = ['test/greet.test.js', 'test/cli.test.js'];
const THRESHOLD = 80;

// NODE_TEST_CONTEXT leaks into child processes; clearing it keeps the nested
// coverage run independent from the runner that owns this file.
const CHILD_ENV = { ...process.env };
delete CHILD_ENV.NODE_TEST_CONTEXT;

/**
 * Parse the coverage table printed by `node --test --experimental-test-coverage`.
 * Handles the flat Node 20 layout ("src/greet.js") and the directory-grouped
 * Node 22+ layout (a "src" row followed by an indented "greet.js" row).
 * @param {string} output combined stdout and stderr of a coverage run
 * @returns {{ file: string, line: number }[]} per-file line coverage rows
 */
function coverageRows(output) {
  const rows = [];
  let directory = '';
  let inReport = false;
  for (const line of output.split('\n')) {
    if (line.includes('start of coverage report')) {
      inReport = true;
      continue;
    }
    if (line.includes('end of coverage report')) break;
    if (!inReport || !line.startsWith('ℹ')) continue;
    const cells = line.replace(/^ℹ\s*/, '').split('|').map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const [name, linePercent] = cells;
    if (!name || name === 'file' || name === 'all files') continue;
    if (linePercent === '') {
      directory = name;
      continue;
    }
    rows.push({ file: directory && !name.includes('/') ? `${directory}/${name}` : name, line: Number(linePercent) });
  }
  return rows;
}

/**
 * Keep only production source rows; test files never count towards the gate.
 * @param {{ file: string, line: number }[]} rows parsed coverage rows
 * @returns {{ file: string, line: number }[]} src/ rows
 */
const srcRows = (rows) => rows.filter((row) => row.file.startsWith('src/'));

/**
 * List rows that miss the line coverage target; a non-numeric percentage counts
 * as a violation so a malformed report can never pass silently.
 * @param {{ file: string, line: number }[]} rows parsed coverage rows
 * @param {number} [threshold] minimum line percentage
 * @returns {{ file: string, line: number }[]} violating rows
 */
const violations = (rows, threshold = THRESHOLD) => rows.filter((row) => !(row.line >= threshold));

const NODE20_REPORT = [
  'ℹ start of coverage report',
  'ℹ -------------------------------------------------------------------',
  'ℹ file               | line % | branch % | funcs % | uncovered lines',
  'ℹ -------------------------------------------------------------------',
  'ℹ bin/hello.js       | 100.00 |    50.00 |  100.00 | 8',
  'ℹ src/greet.js       | 100.00 |   100.00 |  100.00 | ',
  'ℹ test/cli.test.js   | 100.00 |   100.00 |  100.00 | ',
  'ℹ -------------------------------------------------------------------',
  'ℹ all files          | 100.00 |    91.67 |  100.00 |',
  'ℹ -------------------------------------------------------------------',
  'ℹ end of coverage report',
].join('\n');

const NODE25_REPORT = [
  'ℹ start of coverage report',
  'ℹ ----------------------------------------------------------',
  'ℹ file      | line % | branch % | funcs % | uncovered lines',
  'ℹ ----------------------------------------------------------',
  'ℹ bin       |        |          |         | ',
  'ℹ  hello.js | 100.00 |    50.00 |  100.00 | ',
  'ℹ src       |        |          |         | ',
  'ℹ  greet.js | 100.00 |   100.00 |  100.00 | ',
  'ℹ ----------------------------------------------------------',
  'ℹ all files | 100.00 |    91.67 |  100.00 | ',
  'ℹ ----------------------------------------------------------',
  'ℹ end of coverage report',
].join('\n');

const LOW_REPORT = NODE20_REPORT.replace('ℹ src/greet.js       | 100.00', 'ℹ src/greet.js       |  62.50');

test('S6 coverageRows parses the flat Node 20 report', () => {
  assert.deepEqual(coverageRows(NODE20_REPORT), [
    { file: 'bin/hello.js', line: 100 },
    { file: 'src/greet.js', line: 100 },
    { file: 'test/cli.test.js', line: 100 },
  ]);
});

test('S6 coverageRows parses the directory-grouped Node 22+ report', () => {
  assert.deepEqual(coverageRows(NODE25_REPORT), [
    { file: 'bin/hello.js', line: 100 },
    { file: 'src/greet.js', line: 100 },
  ]);
});

test('S6 coverageRows returns nothing when the report marker is absent', () => {
  assert.deepEqual(coverageRows('no coverage here'), []);
  assert.deepEqual(coverageRows('ℹ src/greet.js | 100.00 | 100.00 | 100.00 |'), []);
});

test('S6 violations flags src/ files below the target and malformed percentages', () => {
  assert.deepEqual(violations(srcRows(coverageRows(NODE20_REPORT))), []);
  assert.deepEqual(violations(srcRows(coverageRows(NODE25_REPORT))), []);
  const low = violations(srcRows(coverageRows(LOW_REPORT)));
  assert.deepEqual(low, [{ file: 'src/greet.js', line: 62.5 }], `expected a 62.5% violation, got ${JSON.stringify(low)}`);
  assert.deepEqual(
    violations([{ file: 'src/broken.js', line: Number.NaN }]),
    [{ file: 'src/broken.js', line: Number.NaN }],
    'an unparsable percentage must fail the gate',
  );
});

test('S6 package.json exposes a coverage script built on the built-in coverage report', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_URL, 'utf8'));
  const script = String(pkg.scripts?.coverage ?? '');
  assert.match(script, /\bnode --test\b/, `coverage script must run the test runner, got ${JSON.stringify(script)}`);
  assert.match(script, /--experimental-test-coverage/, `coverage script must enable coverage, got ${JSON.stringify(script)}`);
});

test('S6 every src/ file keeps at least 80% line coverage', () => {
  const result = spawnSync(
    process.execPath,
    ['--test', '--experimental-test-coverage', '--test-reporter=spec', ...CORE_TEST_FILES],
    { cwd: ROOT, encoding: 'utf8', env: CHILD_ENV },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  assert.equal(result.status, 0, `the core suite with coverage must pass\n${output}`);
  const rows = srcRows(coverageRows(output));
  assert.ok(rows.length > 0, `coverage report must list at least one src/ file\n${output}`);
  const misses = violations(rows);
  assert.deepEqual(
    misses,
    [],
    `src/ line coverage must stay at or above ${THRESHOLD}%: ${misses.map((row) => `${row.file}=${row.line}%`).join(', ')}\n${output}`,
  );
});