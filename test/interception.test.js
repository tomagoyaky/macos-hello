import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// S9 drill record contract (written by the implementation step):
// {
//   "story": "S9",
//   "baseline": { "ref": "develop", "headSha": "<sha>", "runUrl": "<actions run url>", "conclusion": "success" },
//   "mutation": {
//     "file": "src/greet.js",
//     "branch": "temp/s9-fail",
//     "headSha": "<sha>",
//     "runUrl": "<actions run url>",
//     "conclusion": "failure",
//     "local": { "command": "pnpm test", "exitCode": 1, "failingCases": ["US-01 / UT-01 ...", "..."] },
//     "ci": { "jobName": "test", "notOkLines": ["not ok 3 - US-01 / UT-01 ...", "..."] }
//   },
//   "restore": { "localExitCode": 0, "branchDeleted": true, "mergedIntoMain": false }
// }

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RECORD_PATH = 'docs/drill/S9-test-interception.json';
const DRILL_TARGETS = ['test/greet.test.js', 'test/cli.test.js'];
const TEMPLATE = '`Hello, ${name}!`';
const MUTATED_TEMPLATE = '`Hello, ${name}`';
const API_ROOT = 'https://api.github.com';
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';

const readText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/**
 * Load the committed S9 drill record.
 * @returns {Record<string, any>} parsed drill record
 */
const readRecord = () => {
  assert.ok(existsSync(new URL(`../${RECORD_PATH}`, import.meta.url)), `S9 drill record ${RECORD_PATH} must exist`);
  const record = JSON.parse(readText(RECORD_PATH));
  assert.equal(record.story, 'S9', `${RECORD_PATH} must describe story S9`);
  return record;
};

const copyInto = (directory, entry) => {
  cpSync(join(ROOT, entry), join(directory, entry), { recursive: true });
};

/**
 * Build an isolated copy of the sources and both test layers.
 * @returns {string} sandbox directory
 */
const createSandbox = () => {
  const directory = mkdtempSync(join(tmpdir(), 's9-interception-'));
  for (const entry of ['package.json', 'src', 'bin', ...DRILL_TARGETS]) copyInto(directory, entry);
  return directory;
};

// NODE_TEST_CONTEXT leaks into child processes; clearing it keeps the sandboxed run independent.
const CHILD_ENV = { ...process.env };
delete CHILD_ENV.NODE_TEST_CONTEXT;

/**
 * Run the unit and CLI suites with the TAP reporter CI relies on.
 * @param {string} cwd sandbox directory
 * @returns {import('node:child_process').SpawnSyncReturns<string>} child process result
 */
const runSuite = (cwd) =>
  spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...DRILL_TARGETS], {
    cwd,
    encoding: 'utf8',
    env: CHILD_ENV,
  });

const tapOutput = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`;

const notOkLines = (output) => output.split('\n').filter((line) => line.startsWith('not ok '));

const notOkNames = (output) => notOkLines(output).map((line) => line.replace(/^not ok \d+ - /, ''));

let drillRun;
/**
 * Reproduce the S9 mutation drill locally: one untouched copy and one copy
 * whose greeting template lost its exclamation mark.
 * @returns {{ baseline: object, mutated: object, source: string, mutatedSource: string }} drill result
 */
const runDrill = () =>
  (drillRun ??= (() => {
    const baselineDirectory = createSandbox();
    const mutatedDirectory = createSandbox();
    try {
      const baseline = runSuite(baselineDirectory);
      const source = readFileSync(join(mutatedDirectory, 'src/greet.js'), 'utf8');
      assert.ok(source.includes(TEMPLATE), `sandbox src/greet.js must contain ${TEMPLATE}`);
      const mutatedSource = source.replace(TEMPLATE, MUTATED_TEMPLATE);
      writeFileSync(join(mutatedDirectory, 'src/greet.js'), mutatedSource);
      const mutated = runSuite(mutatedDirectory);
      return { baseline, mutated, source, mutatedSource };
    } finally {
      rmSync(baselineDirectory, { recursive: true, force: true });
      rmSync(mutatedDirectory, { recursive: true, force: true });
    }
  })());

/**
 * Resolve owner/repo from the origin remote or GITHUB_REPOSITORY.
 * @returns {string} owner/repo slug
 */
const resolveRepository = () => {
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' });
  const origin = result.status === 0 ? result.stdout.trim() : '';
  for (const candidate of [origin, process.env.GITHUB_REPOSITORY ?? '']) {
    const match = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(candidate);
    if (match) return `${match[1]}/${match[2]}`;
  }
  assert.fail(`cannot resolve owner/repo from origin ${JSON.stringify(origin)} or GITHUB_REPOSITORY`);
};

let repository;
const repoSlug = () => (repository ??= resolveRepository());

const getJson = async (path) => {
  const response = await fetch(`${API_ROOT}/repos/${repoSlug()}${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'macos-hello-interception-test',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    },
  });
  const body = await response.json().catch(() => null);
  assert.equal(
    response.status,
    200,
    `GET ${API_ROOT}/repos/${repoSlug()}${path} must succeed, got ${response.status}: ${JSON.stringify(body)}`,
  );
  return body;
};

/**
 * Extract the numeric run id from a GitHub Actions run URL.
 * @param {string} url run URL recorded by the drill
 * @returns {string} run id
 */
const runIdOf = (url) => {
  const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)$/.exec(String(url ?? ''));
  assert.ok(match, `expected a GitHub Actions run URL, got ${JSON.stringify(url)}`);
  return match[1];
};

test('S9 AC1 an untouched copy passes while the missing-exclamation mutation fails with a non-zero exit', () => {
  const { baseline, mutated } = runDrill();
  assert.equal(baseline.status, 0, `untouched copy must pass\n${tapOutput(baseline)}`);
  assert.notEqual(mutated.status, 0, `mutation must fail the suite\n${tapOutput(mutated)}`);
});

test('S9 AC1 the mutated run prints "not ok" lines naming the failing unit and CLI cases', () => {
  const output = tapOutput(runDrill().mutated);
  const names = notOkNames(output);
  assert.ok(names.some((name) => name.startsWith('US-01 / UT-01')), `expected a US-01 / UT-01 failure in\n${output}`);
  assert.ok(names.some((name) => name.startsWith('US-01 AC1 / E2E-01')), `expected a US-01 AC1 / E2E-01 failure in\n${output}`);
  assert.ok(
    notOkLines(output).every((line) => /^not ok \d+ - \S/.test(line)),
    `every failing case must use the TAP "not ok" form\n${output}`,
  );
});

test('S9 AC1 the drill mutation only strips the "!" from the greeting template', () => {
  const { source, mutatedSource } = runDrill();
  assert.equal(mutatedSource, source.replace(TEMPLATE, MUTATED_TEMPLATE));
  assert.equal(mutatedSource.length, source.length - 1, 'the mutation must delete exactly one character');
});

test('S9 AC1 the drill record documents a non-zero local "pnpm test" run with failing case names', () => {
  const { mutation } = readRecord();
  assert.equal(mutation.file, 'src/greet.js');
  assert.equal(mutation.local.command, 'pnpm test');
  assert.notEqual(Number(mutation.local.exitCode), 0, 'local drill must record a non-zero exit code');
  const cases = mutation.local.failingCases ?? [];
  assert.ok(cases.some((name) => String(name).includes('US-01 / UT-01')), `expected US-01 / UT-01 in ${JSON.stringify(cases)}`);
  assert.ok(
    cases.some((name) => String(name).includes('US-01 AC1 / E2E-01')),
    `expected US-01 AC1 / E2E-01 in ${JSON.stringify(cases)}`,
  );
});

test('S9 AC2 the drill record documents a failed CI "test" job whose log contains "not ok" lines', async () => {
  const { mutation } = readRecord();
  assert.match(String(mutation.branch), /^temp\/s9/, 'the drill must run on a temporary temp/s9* branch');
  assert.equal(mutation.conclusion, 'failure');
  assert.match(String(mutation.headSha), /^[0-9a-f]{40}$/);
  assert.equal(mutation.ci.jobName, 'test');

  const ciLines = (mutation.ci.notOkLines ?? []).map((line) => String(line).trim());
  assert.ok(ciLines.length > 0, 'the CI log excerpt must contain "not ok" lines');
  assert.ok(ciLines.every((line) => /^not ok \d+ - \S/.test(line)), `unexpected CI log excerpt ${JSON.stringify(ciLines)}`);
  assert.ok(ciLines.some((line) => line.includes('US-01')), `expected a US-01 case in ${JSON.stringify(ciLines)}`);

  const runId = runIdOf(mutation.runUrl);
  const run = await getJson(`/actions/runs/${runId}`);
  assert.equal(run.head_branch, mutation.branch);
  assert.equal(run.head_sha, mutation.headSha);
  assert.equal(run.conclusion, 'failure');

  const jobs = await getJson(`/actions/runs/${runId}/jobs`);
  const testJobs = (jobs.jobs ?? []).filter((job) => job.name === 'test');
  assert.ok(testJobs.length > 0, 'the CI run must contain the "test" job');
  assert.ok(
    testJobs.some((job) => job.conclusion === 'failure'),
    `expected a failed "test" job, got ${JSON.stringify(testJobs.map((job) => [job.name, job.conclusion]))}`,
  );
});

test('S9 AC3 baseline CI is green, the temporary branch is gone and the drill commit never reached main', async () => {
  const { baseline, mutation, restore } = readRecord();
  assert.ok(['develop', 'main'].includes(baseline.ref), `baseline ref must be develop or main, got ${baseline.ref}`);
  assert.equal(baseline.conclusion, 'success');
  assert.match(String(baseline.headSha), /^[0-9a-f]{40}$/);
  assert.equal(restore.localExitCode, 0);
  assert.equal(restore.branchDeleted, true);
  assert.equal(restore.mergedIntoMain, false);

  const baselineRun = await getJson(`/actions/runs/${runIdOf(baseline.runUrl)}`);
  assert.equal(baselineRun.conclusion, 'success');
  assert.equal(baselineRun.head_branch, baseline.ref);
  assert.equal(baselineRun.head_sha, baseline.headSha);

  const remaining = spawnSync('git', ['ls-remote', '--heads', 'origin', 'refs/heads/temp/s9*'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(remaining.status, 0, `git ls-remote failed: ${remaining.stderr}`);
  assert.equal(remaining.stdout.trim(), '', `temporary drill branches must be deleted, found ${remaining.stdout.trim()}`);

  const comparison = await getJson(`/compare/${mutation.headSha}...main`);
  assert.ok(
    ['diverged', 'behind'].includes(comparison.status),
    `the drill commit must not be an ancestor of main, compare status=${comparison.status}`,
  );
});