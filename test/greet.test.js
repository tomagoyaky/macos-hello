import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatGreeting, parseCliArgs, UsageError, USAGE } from '../src/greet.js';

const GREET_SOURCE = readFileSync(new URL('../src/greet.js', import.meta.url), 'utf8');
const GREET_CODE = GREET_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

/**
 * Assert that parseCliArgs rejects argv with a UsageError carrying the fixed usage text.
 * @param {string[]} argv raw CLI arguments
 */
function assertUsageError(argv) {
  assert.throws(
    () => parseCliArgs(argv),
    (error) => {
      assert.ok(
        error instanceof UsageError,
        `${JSON.stringify(argv)} must throw UsageError, got ${error.name}: ${error.message}`,
      );
      assert.equal(error.message, USAGE);
      return true;
    },
    `${JSON.stringify(argv)} must be rejected`,
  );
}

test('US-01 / UT-01 formatGreeting() returns "Hello, World!"', () => {
  assert.equal(formatGreeting(), 'Hello, World!');
});

test('US-01 / UT-02 formatGreeting("Alice") returns "Hello, Alice!"', () => {
  assert.equal(formatGreeting('Alice'), 'Hello, Alice!');
});

test('US-01 / UT-03 formatGreeting("Wu Ming") returns "Hello, Wu Ming!"', () => {
  assert.equal(formatGreeting('Wu Ming'), 'Hello, Wu Ming!');
});

test('US-02 / UT-04 parseCliArgs([]) returns an empty options object', () => {
  assert.deepEqual(parseCliArgs([]), {});
});

test('US-02 / UT-05 parseCliArgs(["--name", "Alice"]) returns { name: "Alice" }', () => {
  assert.deepEqual(parseCliArgs(['--name', 'Alice']), { name: 'Alice' });
});

test('US-02 / UT-06 parseCliArgs(["--name=Alice"]) matches the space-separated form', () => {
  assert.deepEqual(parseCliArgs(['--name=Alice']), { name: 'Alice' });
});

test('US-02 / UT-07 parseCliArgs(["--name", "Wu Ming"]) keeps the space inside the value', () => {
  assert.deepEqual(parseCliArgs(['--name', 'Wu Ming']), { name: 'Wu Ming' });
});

test('US-02 / UT-08 parseCliArgs(["--name", ""]) throws UsageError for an empty value', () => {
  assertUsageError(['--name', '']);
});

test('US-02 / UT-09 parseCliArgs(["--name"]) throws UsageError for a missing value', () => {
  assertUsageError(['--name']);
});

test('US-02 / UT-10 parseCliArgs(["--foo"]) throws UsageError for an unknown option', () => {
  assertUsageError(['--foo']);
});

test('US-02 / UT-11 parseCliArgs(["--help"]) throws UsageError because help is unsupported', () => {
  assertUsageError(['--help']);
});

test('US-02 / UT-12 parseCliArgs(["extra"]) throws UsageError for a positional argument', () => {
  assertUsageError(['extra']);
});

test('US-02 / UT-13 parseCliArgs(["--name", "-x"]) throws UsageError for an ambiguous value', () => {
  assertUsageError(['--name', '-x']);
});

test('US-02 / UT-14 parseCliArgs(["--name", "a", "--name", "b"]) keeps the last value', () => {
  assert.deepEqual(parseCliArgs(['--name', 'a', '--name', 'b']), { name: 'b' });
});

test('US-02 / UT-15 parseCliArgs(["--name", " "]) keeps a whitespace-only value instead of trimming it', () => {
  assert.deepEqual(parseCliArgs(['--name', ' ']), { name: ' ' });
  assert.deepEqual(parseCliArgs(['--name', '   ']), { name: '   ' });
});

test('US-02 / UT-16 parseCliArgs(["--name= "]) keeps a whitespace-only inline value', () => {
  assert.deepEqual(parseCliArgs(['--name= ']), { name: ' ' });
});

test('US-02 AC4 formatGreeting preserves whitespace-only names verbatim', () => {
  assert.equal(formatGreeting(' '), 'Hello,  !');
  assert.equal(formatGreeting('   '), 'Hello,    !');
});

test('US-01 AC3 formatGreeting does not reference process, clock or randomness', () => {
  const banned = [
    [/\bprocess\b/, 'process'],
    [/\bDate\b/, 'Date (clock)'],
    [/\bMath\.random\b/, 'Math.random'],
    [/\bperformance\.now\b/, 'performance.now'],
    [/\bcrypto\./, 'crypto'],
  ];
  for (const [pattern, label] of banned) {
    assert.equal(pattern.test(GREET_CODE), false, `src/greet.js must not reference ${label}`);
  }
});

test('US-01 AC3 formatGreeting output ignores ambient env, clock and random state', () => {
  const envSnapshot = { ...process.env };
  const { now } = Date;
  const { random } = Math;
  try {
    process.env.GREETING_NAME = 'Shadow';
    process.env.TZ = 'Pacific/Kiritimati';
    Date.now = () => 0;
    Math.random = () => 0;
    assert.equal(formatGreeting(), 'Hello, World!');
  } finally {
    Date.now = now;
    Math.random = random;
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) delete process.env[key];
    }
    Object.assign(process.env, envSnapshot);
  }
});

test('US-02 AC3 parseCliArgs wraps every parse failure as UsageError', () => {
  const invalidArgv = [['--name', ''], ['--name'], ['--foo'], ['--help'], ['-h'], ['extra'], ['--name', '-x']];
  for (const argv of invalidArgv) {
    assert.throws(
      () => parseCliArgs(argv),
      (error) => {
        assert.equal(error.name, 'UsageError', `${JSON.stringify(argv)} must throw UsageError, got ${error.name}: ${error.message}`);
        return true;
      },
      `${JSON.stringify(argv)} must be rejected`,
    );
  }
});