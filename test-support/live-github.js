import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Shared plumbing for test files that verify live GitHub state (branch
// rulesets and recorded CI runs). The product never touches the network, so
// these checks must degrade to a skip instead of turning the offline suite red.
// The module lives outside test/ because the runner executes every file found
// there as a test case.

export const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const DEFAULT_API_ROOT = 'https://api.github.com';
export const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Resolve the REST API base URL; GITHUB_API_URL is honoured for runners that
 * proxy the API and for tests that point the probe at a local server.
 * @param {NodeJS.ProcessEnv} [env] environment to read
 * @returns {string} base URL without a trailing slash
 */
export function resolveApiRoot(env = process.env) {
  return (env.GITHUB_API_URL || DEFAULT_API_ROOT).replace(/\/+$/, '');
}

/**
 * Resolve owner/repo from the origin remote or GITHUB_REPOSITORY.
 * @param {{ root?: string, env?: NodeJS.ProcessEnv, spawn?: typeof spawnSync }} [options] lookup options
 * @returns {string|null} owner/repo slug, or null when it cannot be resolved
 */
export function resolveRepository({ root = ROOT, env = process.env, spawn = spawnSync } = {}) {
  const result = spawn('git', ['remote', 'get-url', 'origin'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const origin = result?.status === 0 ? String(result.stdout).trim() : '';
  for (const candidate of [origin, env.GITHUB_REPOSITORY ?? '']) {
    // GITHUB_REPOSITORY is a bare "owner/repo" slug, remotes are URLs.
    const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(candidate) ?? /^([^/\s]+)\/([^/\s]+)$/.exec(candidate);
    if (match) return `${match[1]}/${match[2]}`;
  }
  return null;
}

/**
 * Read the local gh CLI token so live checks keep working on developer machines.
 * @param {{ spawn?: typeof spawnSync }} [options] spawn override for tests
 * @returns {string} token or an empty string
 */
export function localGhToken({ spawn = spawnSync } = {}) {
  const result = spawn('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return result?.status === 0 ? String(result.stdout).trim() : '';
}

/**
 * Resolve the GitHub token from the environment, falling back to gh auth.
 * @param {NodeJS.ProcessEnv} [env] environment to read
 * @param {{ spawn?: typeof spawnSync }} [options] spawn override for the gh fallback
 * @returns {string} token or an empty string
 */
export function resolveToken(env = process.env, options = {}) {
  return env.GH_TOKEN ?? env.GITHUB_TOKEN ?? localGhToken(options);
}

/**
 * Build request headers for the GitHub REST API.
 * @param {string} token bearer token, may be empty
 * @param {string} userAgent User-Agent required by GitHub
 * @returns {Record<string, string>} headers
 */
export function githubHeaders(token, userAgent) {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': userAgent,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Probe the GitHub REST API once so live checks can skip instead of failing
 * when the machine is offline, the token is invalid or the API is rate limited.
 * @param {{
 *   repository: string|null,
 *   token?: string,
 *   apiRoot?: string,
 *   fetchImpl?: typeof fetch,
 *   userAgent?: string,
 *   timeoutMs?: number,
 * }} [options] probe options
 * @returns {Promise<string|null>} null when the API answered 200, otherwise a skip reason
 */
export async function probeGithub({
  repository,
  token = '',
  apiRoot = resolveApiRoot(),
  fetchImpl = fetch,
  userAgent = 'macos-hello-test',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!repository) return 'cannot resolve owner/repo from the git origin or GITHUB_REPOSITORY';
  let response;
  try {
    response = await fetchImpl(`${apiRoot}/repos/${repository}`, {
      headers: githubHeaders(token, userAgent),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    return `GitHub API unreachable at ${apiRoot} (${error?.message ?? error}); live checks need network access`;
  }
  if (response.status === 200) return null;
  const body = await response.json().catch(() => null);
  const detail = body?.message ? `: ${body.message}` : '';
  if (response.status === 401) return `GitHub rejected the credentials (401${detail}); export a valid GH_TOKEN`;
  if (response.status === 403) return `GitHub refused the request (403${detail}); token scopes or rate limits block live checks`;
  if (response.status === 404) {
    return `repository ${repository} is not visible (404${detail}); live checks need a token with repo access`;
  }
  return `GitHub API answered ${response.status}${detail}; live checks are unavailable`;
}