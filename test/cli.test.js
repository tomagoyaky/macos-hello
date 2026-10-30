import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_PATH = fileURLToPath(new URL('../bin/hello.js', import.meta.url));
const EXPECTED_STDOUT = Buffer.from('Hello, World!\n', 'utf8');

const runCli = (...args) => spawnSync(process.execPath, [CLI_PATH, ...args]);

test('US-01 AC1 / E2E-01 default greeting writes exactly "Hello, World!\\n" to stdout', () => {
  const { status, stdout, stderr } = runCli();
  assert.equal(stderr.length, 0, `stderr must be empty, got: ${JSON.stringify(stderr.toString())}`);
  assert.equal(status, 0, `exit code must be 0, got ${status}; stderr: ${stderr.toString()}`);
  assert.ok(
    stdout.equals(EXPECTED_STDOUT),
    `stdout must be exactly ${JSON.stringify(EXPECTED_STDOUT.toString())} (${EXPECTED_STDOUT.length} bytes), ` +
      `got ${JSON.stringify(stdout.toString())} (${stdout.length} bytes)`,
  );
});

test('US-01 AC3 / E2E-02 two consecutive runs produce byte-identical stdout', () => {
  const first = runCli();
  const second = runCli();
  assert.equal(first.status, 0, `first run exit code must be 0, got ${first.status}; stderr: ${first.stderr.toString()}`);
  assert.equal(second.status, 0, `second run exit code must be 0, got ${second.status}; stderr: ${second.stderr.toString()}`);
  assert.equal(first.stderr.length, 0, `first run stderr must be empty, got: ${JSON.stringify(first.stderr.toString())}`);
  assert.equal(second.stderr.length, 0, `second run stderr must be empty, got: ${JSON.stringify(second.stderr.toString())}`);
  assert.equal(
    Buffer.compare(first.stdout, second.stdout),
    0,
    `stdout must be byte-identical between runs\nfirst:  ${JSON.stringify(first.stdout.toString())}\nsecond: ${JSON.stringify(second.stdout.toString())}`,
  );
  assert.ok(first.stdout.equals(EXPECTED_STDOUT), 'byte-identical stdout must also equal the expected greeting');
});

test('US-01 AC3 bin/hello.js passes "node --check" syntax validation', () => {
  const { status, stderr } = spawnSync(process.execPath, ['--check', CLI_PATH]);
  assert.equal(status, 0, `node --check must pass, got exit code ${status}; stderr: ${stderr.toString()}`);
});