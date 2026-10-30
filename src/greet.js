import { parseArgs } from 'node:util';

export const DEFAULT_NAME = 'World';
export const USAGE = 'Usage: hello [--name <name>]';

/**
 * Error raised for every invalid CLI usage.
 */
export class UsageError extends Error {
  constructor(message = USAGE) {
    super(message);
    this.name = 'UsageError';
  }
}

/**
 * Pure greeting formatter.
 * @param {string} [name] display name; defaults to World
 * @returns {string} greeting text without trailing newline
 */
export function formatGreeting(name = DEFAULT_NAME) {
  return `Hello, ${name}!`;
}

/**
 * Parse CLI arguments into options; never reads process state.
 * Every parse failure is normalized to UsageError.
 * @param {string[]} argv arguments after the executable and script
 * @returns {{ name?: string }} parsed options
 */
export function parseCliArgs(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: { name: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError();
  }
  if (values.name === undefined) return {};
  if (values.name === '') throw new UsageError();
  return { name: values.name };
}