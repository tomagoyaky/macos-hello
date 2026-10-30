import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Absolute entry path keeps every case independent of the current working directory.
const CLI_PATH = fileURLToPath(new URL('../bin/hello.js', import.meta.url));
const DEFAULT_STDOUT = 'Hello, World!\n';
const USAGE_STDERR = 'Usage: hello [--name <name>]\n';

/**
 * Run the real CLI in a child process and decode its streams as UTF-8 text.
 * @param {...string} args arguments after the script path
 * @returns {{ stdout: string, stderr: string, status: number|null }}
 */
function runCli(...args) {
  const { stdout, stderr, status } = spawnSync(process.execPath, [CLI_PATH, ...args]);
  return { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), status };
}

/**
 * Run the real CLI from an explicit working directory to prove cwd independence.
 * @param {string} cwd working directory of the child process
 * @param {...string} args arguments after the script path
 * @returns {{ stdout: string, stderr: string, status: number|null }}
 */
function runCliFrom(cwd, ...args) {
  const { stdout, stderr, status } = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd });
  return { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8'), status };
}

const greeting = (name) => `Hello, ${name}!\n`;

/**
 * Assert the stdout/stderr/exit-code triple of a successful greeting run.
 * @param {{ stdout: string, stderr: string, status: number|null }} result child process result
 * @param {string} expectedStdout full expected stdout including the trailing newline
 * @param {string} command human readable command used in failure messages
 */
function assertGreeting(result, expectedStdout, command) {
  assert.strictEqual(result.status, 0, `${command}: exit code must be 0, got ${result.status}`);
  assert.strictEqual(result.stderr, '', `${command}: stderr must be empty, got ${JSON.stringify(result.stderr)}`);
  assert.strictEqual(
    result.stdout,
    expectedStdout,
    `${command}: stdout must be exactly ${JSON.stringify(expectedStdout)}, got ${JSON.stringify(result.stdout)}`,
  );
}

/**
 * Assert the stdout/stderr/exit-code triple of an invalid usage run.
 * @param {string[]} args raw CLI arguments
 * @param {string} command human readable command used in failure messages
 */
function assertUsageError(args, command) {
  const result = runCli(...args);
  assert.strictEqual(result.status, 1, `${command}: exit code must be 1, got ${result.status}`);
  assert.strictEqual(result.stdout, '', `${command}: stdout must be empty, got ${JSON.stringify(result.stdout)}`);
  assert.strictEqual(
    result.stderr,
    USAGE_STDERR,
    `${command}: stderr must be exactly ${JSON.stringify(USAGE_STDERR)}, got ${JSON.stringify(result.stderr)}`,
  );
  assert.strictEqual(
    result.stderr.includes('ERR_PARSE_ARGS'),
    false,
    `${command}: stderr must not leak Node's ERR_PARSE_ARGS text, got ${JSON.stringify(result.stderr)}`,
  );
}

test('US-01 AC1 / E2E-01 default greeting writes exactly "Hello, World!\\n" to stdout', () => {
  assertGreeting(runCli(), DEFAULT_STDOUT, 'no arguments');
});

test('US-01 AC3 / E2E-02 two consecutive runs produce identical stdout, stderr and exit code', () => {
  const first = runCli();
  const second = runCli();
  assertGreeting(first, DEFAULT_STDOUT, 'first run');
  assertGreeting(second, DEFAULT_STDOUT, 'second run');
  assert.strictEqual(
    first.stdout,
    second.stdout,
    `stdout must be identical between runs\nfirst:  ${JSON.stringify(first.stdout)}\nsecond: ${JSON.stringify(second.stdout)}`,
  );
  assert.strictEqual(first.stderr, second.stderr, 'stderr must be identical between runs');
  assert.strictEqual(first.status, second.status, 'exit code must be identical between runs');
});

test('US-01 AC3 bin/hello.js passes "node --check" syntax validation', () => {
  const { status, stdout, stderr } = spawnSync(process.execPath, ['--check', CLI_PATH], { encoding: 'utf8' });
  assert.strictEqual(status, 0, `node --check must pass, got exit code ${status}; stderr: ${stderr}`);
  assert.strictEqual(stdout, '', `node --check must not write to stdout, got ${JSON.stringify(stdout)}`);
  assert.strictEqual(stderr, '', `node --check must not write to stderr, got ${JSON.stringify(stderr)}`);
});

test('US-02 AC1 / E2E-03 "--name Alice" writes exactly "Hello, Alice!\\n" to stdout', () => {
  assertGreeting(runCli('--name', 'Alice'), greeting('Alice'), '--name Alice');
});

test('US-02 AC2 / E2E-04 omitting --name keeps the default "Hello, World!\\n" greeting', () => {
  const withFlag = runCli('--name', 'World');
  const withoutFlag = runCli();
  assertGreeting(withoutFlag, DEFAULT_STDOUT, 'no arguments');
  assertGreeting(withFlag, DEFAULT_STDOUT, '--name World');
  assert.strictEqual(
    withoutFlag.stdout,
    withFlag.stdout,
    `omitting --name must match the explicit default\nomitted: ${JSON.stringify(withoutFlag.stdout)}\nexplicit: ${JSON.stringify(withFlag.stdout)}`,
  );
});

test('US-02 AC3 / E2E-05 "--name" without a value prints exactly the Usage line and exits 1', () => {
  assertUsageError(['--name'], '--name');
});

test('US-02 AC3 / E2E-06 "--name \\"\\"" (empty value) prints exactly the Usage line and exits 1', () => {
  assertUsageError(['--name', ''], '--name ""');
});

test('US-02 AC2 / E2E-07 "--name \\"Wu Ming\\"" preserves the space in the greeting', () => {
  assertGreeting(runCli('--name', 'Wu Ming'), greeting('Wu Ming'), '--name "Wu Ming"');
});

test('US-02 AC3 / E2E-08 unknown option "--foo" prints exactly the Usage line and exits 1', () => {
  assertUsageError(['--foo'], '--foo');
});

test('US-02 AC3 / E2E-09 positional argument "extra" prints exactly the Usage line and exits 1', () => {
  assertUsageError(['extra'], 'extra');
});

test('US-02 AC3 / E2E-10 "--help" is rejected as an unknown option with the Usage line and exit 1', () => {
  assertUsageError(['--help'], '--help');
});

test('US-02 AC2 / E2E-11 "--name=Alice" matches "--name Alice" character for character', () => {
  const separated = runCli('--name', 'Alice');
  const inline = runCli('--name=Alice');
  assertGreeting(separated, greeting('Alice'), '--name Alice');
  assertGreeting(inline, greeting('Alice'), '--name=Alice');
  assert.strictEqual(
    inline.stdout,
    separated.stdout,
    `inline form must match separated form\nseparated: ${JSON.stringify(separated.stdout)}\ninline:    ${JSON.stringify(inline.stdout)}`,
  );
});

test('US-02 AC4 / E2E-12 a 256-character --name value is emitted verbatim', () => {
  const longName = `${'Ab c"d\\'.repeat(36)}efGH`;
  assert.strictEqual(longName.length, 256, `fixture must be exactly 256 characters, got ${longName.length}`);
  assertGreeting(runCli('--name', longName), greeting(longName), '--name <256 chars>');
});

test('US-02 AC3 "-h" is rejected as an unknown option with the Usage line and exit 1', () => {
  assertUsageError(['-h'], '-h');
});

test('US-02 AC3 ambiguous value "--name -x" prints exactly the Usage line and exits 1', () => {
  assertUsageError(['--name', '-x'], '--name -x');
});

test('S6 AC3 entry path is absolute so results do not depend on the current working directory', () => {
  assert.strictEqual(isAbsolute(CLI_PATH), true, `CLI_PATH must be absolute, got ${CLI_PATH}`);
  const fromTemporaryDirectory = runCliFrom(tmpdir(), '--name', 'Alice');
  const fromRepositoryRoot = runCliFrom(fileURLToPath(new URL('..', import.meta.url)), '--name', 'Alice');
  assertGreeting(fromTemporaryDirectory, greeting('Alice'), `cwd=${tmpdir()} --name Alice`);
  assertGreeting(fromRepositoryRoot, greeting('Alice'), 'cwd=repo root --name Alice');
  assert.strictEqual(
    fromTemporaryDirectory.stdout,
    fromRepositoryRoot.stdout,
    `stdout must not depend on cwd\ntmpdir: ${JSON.stringify(fromTemporaryDirectory.stdout)}\nrepo:   ${JSON.stringify(fromRepositoryRoot.stdout)}`,
  );
});