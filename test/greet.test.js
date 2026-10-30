import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatGreeting } from '../src/greet.js';

const GREET_SOURCE = readFileSync(new URL('../src/greet.js', import.meta.url), 'utf8');
const GREET_CODE = GREET_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('US-01 / UT-01 formatGreeting() returns "Hello, World!"', () => {
  assert.equal(formatGreeting(), 'Hello, World!');
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