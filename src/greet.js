import { parseArgs } from 'node:util';

const DEFAULT_NAME = 'World';

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
 * @param {string[]} argv arguments after the executable and script
 * @returns {{ name?: string }} parsed options
 */
export function parseCliArgs(argv) {
  const { values } = parseArgs({ args: argv, options: { name: { type: 'string' } }, strict: true });
  return values.name === undefined ? {} : { name: values.name };
}