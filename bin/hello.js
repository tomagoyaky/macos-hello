#!/usr/bin/env node
import { USAGE, UsageError, formatGreeting, parseCliArgs } from '../src/greet.js';

try {
  const { name } = parseCliArgs(process.argv.slice(2));
  process.stdout.write(`${formatGreeting(name)}\n`);
} catch (error) {
  if (!(error instanceof UsageError)) throw error;
  process.stderr.write(`${USAGE}\n`);
  process.exitCode = 1;
}