import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_API_ROOT,
  githubHeaders,
  probeGithub,
  resolveApiRoot,
  resolveRepository,
  resolveToken,
} from '../test-support/live-github.js';

const RULESET_SUITE = fileURLToPath(new URL('ruleset.test.js', import.meta.url));
const ROOT = fileURLToPath(new URL('..', import.meta.url));

// Keep nested test runs independent from the outer runner.
const CHILD_ENV = { ...process.env };
delete CHILD_ENV.NODE_TEST_CONTEXT;

const fakeSpawn = (status, stdout = '') => () => ({ status, stdout, stderr: '' });
const fakeResponse = (status, body) => ({ status, json: async () => body });
const failingFetch = (error = new Error('fetch failed')) => () => Promise.reject(error);

/**
 * Start a throwaway HTTP server bound to a random loopback port.
 * @param {import('node:http').RequestListener} handler request handler
 * @returns {Promise<{ server: import('node:http').Server, origin: string }>} listening server and base URL
 */
const startServer = (handler) =>
  new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });

/**
 * Close a server and wait for all sockets to be released.
 * @param {import('node:http').Server} server server to close
 * @returns {Promise<void>} resolves once closed
 */
const closeServer = (server) => new Promise((resolve) => server.close(resolve));

/**
 * Run the ruleset suite against a fake GitHub API and return its TAP output.
 * Uses async spawn so an in-process mock server keeps answering while the
 * child runs; spawnSync would block the event loop and the probe would time out.
 * @param {string} apiRoot API base URL handed to the child process
 * @returns {Promise<{ status: number|null, stdout: string, stderr: string }>} child process result
 */
const runRulesetSuite = (apiRoot) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ['--test', '--test-reporter=tap', RULESET_SUITE], {
      cwd: ROOT,
      env: { ...CHILD_ENV, GITHUB_API_URL: apiRoot, GH_TOKEN: 'invalid-token' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });

const tapOutput = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`;

/**
 * Count the TAP summary line for a given key.
 * @param {string} output TAP output
 * @param {string} key summary key
 * @returns {number} parsed count, or NaN when absent
 */
const summaryCount = (output, key) => {
  const match = new RegExp(`^# ${key} (\\d+)$`, 'm').exec(output);
  return match ? Number(match[1]) : Number.NaN;
};

test('resolveApiRoot defaults to the public API and trims trailing slashes', () => {
  assert.equal(resolveApiRoot({}), DEFAULT_API_ROOT);
  assert.equal(resolveApiRoot({ GITHUB_API_URL: '' }), DEFAULT_API_ROOT);
  assert.equal(resolveApiRoot({ GITHUB_API_URL: 'http://127.0.0.1:8080/' }), 'http://127.0.0.1:8080');
});

test('resolveRepository accepts ssh and https remotes, falls back to GITHUB_REPOSITORY and returns null otherwise', () => {
  assert.equal(resolveRepository({ env: {}, spawn: fakeSpawn(0, 'git@github.com:acme/widget.git\n') }), 'acme/widget');
  assert.equal(resolveRepository({ env: {}, spawn: fakeSpawn(0, 'https://github.com/acme/widget.git\n') }), 'acme/widget');
  assert.equal(
    resolveRepository({ env: { GITHUB_REPOSITORY: 'octo/demo' }, spawn: fakeSpawn(1, '') }),
    'octo/demo',
    'a failing git remote lookup must fall back to GITHUB_REPOSITORY',
  );
  assert.equal(resolveRepository({ env: {}, spawn: fakeSpawn(0, '/tmp/local/repo\n') }), null);
  assert.equal(resolveRepository({ env: {}, spawn: fakeSpawn(0, '') }), null);
});

test('resolveToken prefers GH_TOKEN, then GITHUB_TOKEN, then the gh CLI', () => {
  const unreachable = () => {
    throw new Error('the gh CLI must not run when an environment token exists');
  };
  assert.equal(resolveToken({ GH_TOKEN: 'env-gh', GITHUB_TOKEN: 'env-github' }, { spawn: unreachable }), 'env-gh');
  assert.equal(resolveToken({ GITHUB_TOKEN: 'env-github' }, { spawn: unreachable }), 'env-github');
  assert.equal(resolveToken({}, { spawn: fakeSpawn(0, 'cli-token\n') }), 'cli-token');
  assert.equal(resolveToken({}, { spawn: fakeSpawn(1, '') }), '', 'a missing gh CLI must degrade to an empty token');
});

test('githubHeaders only attach Authorization when a token is present', () => {
  const anonymous = githubHeaders('', 'agent');
  assert.equal(anonymous['User-Agent'], 'agent');
  assert.equal(anonymous.Accept, 'application/vnd.github+json');
  assert.equal('Authorization' in anonymous, false, 'an empty token must not produce an Authorization header');
  assert.equal(githubHeaders('secret', 'agent').Authorization, 'Bearer secret');
});

test('probeGithub reports no skip and sends the token when the API answers 200', async () => {
  const calls = [];
  const skip = await probeGithub({
    repository: 'acme/widget',
    token: 'secret',
    apiRoot: 'https://api.test',
    userAgent: 'agent',
    fetchImpl: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(fakeResponse(200, {}));
    },
  });
  assert.equal(skip, null, 'a healthy API must not skip the live checks');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.test/repos/acme/widget');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');
  assert.equal(calls[0].init.headers['User-Agent'], 'agent');
});

test('probeGithub degrades with a readable reason when the network is unreachable', async () => {
  const skip = await probeGithub({ repository: 'acme/widget', apiRoot: 'https://api.test', fetchImpl: failingFetch() });
  assert.match(String(skip), /unreachable/, `unexpected reason ${JSON.stringify(skip)}`);
  assert.match(String(skip), /https:\/\/api\.test/, 'the reason must name the API root that failed');
  assert.match(String(skip), /network access/, 'the reason must tell the operator what to provide');
});

test('probeGithub degrades on 401 without leaking the token', async () => {
  const skip = await probeGithub({
    repository: 'acme/widget',
    token: 'secret-token',
    fetchImpl: () => Promise.resolve(fakeResponse(401, { message: 'Bad credentials' })),
  });
  assert.match(String(skip), /401/, `unexpected reason ${JSON.stringify(skip)}`);
  assert.match(String(skip), /GH_TOKEN/, 'the reason must name the environment variable to fix');
  assert.equal(String(skip).includes('secret-token'), false, 'the skip reason must never include the token value');
});

test('probeGithub degrades on 403 rate limits and missing scopes', async () => {
  const skip = await probeGithub({
    repository: 'acme/widget',
    fetchImpl: () => Promise.resolve(fakeResponse(403, { message: 'API rate limit exceeded' })),
  });
  assert.match(String(skip), /403/, `unexpected reason ${JSON.stringify(skip)}`);
  assert.match(String(skip), /rate limits/);
});

test('probeGithub degrades on 404 for repositories the token cannot see', async () => {
  const skip = await probeGithub({
    repository: 'acme/private-widget',
    fetchImpl: () => Promise.resolve(fakeResponse(404, { message: 'Not Found' })),
  });
  assert.match(String(skip), /acme\/private-widget/);
  assert.match(String(skip), /404/);
  assert.match(String(skip), /not visible/);
});

test('probeGithub degrades on unexpected statuses and non-JSON error bodies', async () => {
  const serverError = await probeGithub({
    repository: 'acme/widget',
    fetchImpl: () => Promise.resolve(fakeResponse(500, { message: 'boom' })),
  });
  assert.match(String(serverError), /500/, `unexpected reason ${JSON.stringify(serverError)}`);

  const badBody = await probeGithub({
    repository: 'acme/widget',
    fetchImpl: () =>
      Promise.resolve({
        status: 502,
        json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
      }),
  });
  assert.match(String(badBody), /502/, 'a non-JSON error body must still produce a skip reason');
});

test('probeGithub degrades without a network call when owner/repo cannot be resolved', async () => {
  const skip = await probeGithub({
    repository: null,
    fetchImpl: () => {
      throw new Error('fetch must not run without a repository');
    },
  });
  assert.match(String(skip), /owner\/repo/);
  assert.match(String(skip), /GITHUB_REPOSITORY/);
});

test('offline degradation: ruleset live checks skip instead of failing when GitHub answers 401', async () => {
  const requested = [];
  const { server, origin } = await startServer((request, response) => {
    requested.push(request.url);
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'Bad credentials' }));
  });
  try {
    const result = await runRulesetSuite(origin);
    const output = tapOutput(result);
    assert.equal(result.status, 0, `the suite must stay green when GitHub rejects the token\n${output}`);
    assert.equal(output.includes('not ok'), false, `no live case may fail on a 401\n${output}`);
    assert.match(output, /# SKIP .*401/, `every live case must carry the 401 skip reason\n${output}`);
    assert.equal(summaryCount(output, 'skipped'), 4, `all four S8 cases must be skipped\n${output}`);
    assert.equal(summaryCount(output, 'fail'), 0, `the run must report zero failures\n${output}`);
    assert.ok(
      requested.includes('/repos/tomagoyaky/macos-hello'),
      `the probe must target the configured API root, got ${JSON.stringify(requested)}`,
    );
  } finally {
    await closeServer(server);
  }
});

test('offline degradation: ruleset live checks skip instead of failing when the API is unreachable', async () => {
  const { server, origin } = await startServer(() => {});
  await closeServer(server);
  const result = await runRulesetSuite(origin);
  const output = tapOutput(result);
  assert.equal(result.status, 0, `the suite must stay green offline\n${output}`);
  assert.equal(output.includes('not ok'), false, `no live case may fail offline\n${output}`);
  assert.match(output, /# SKIP .*unreachable/, `every live case must carry the unreachable skip reason\n${output}`);
  assert.equal(summaryCount(output, 'skipped'), 4, `all four S8 cases must be skipped offline\n${output}`);
});