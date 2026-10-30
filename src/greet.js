const DEFAULT_NAME = 'World';

/**
 * Pure greeting formatter.
 * @param {string} [name] display name; defaults to World
 * @returns {string} greeting text without trailing newline
 */
export function formatGreeting(name = DEFAULT_NAME) {
  return `Hello, ${name}!`;
}