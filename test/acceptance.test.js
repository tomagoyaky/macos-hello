import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { githubHeaders, probeGithub, resolveApiRoot, resolveRepository, resolveToken } from '../test-support/live-github.js';

// S10 acceptance record contract (written by the implementation step):
// docs/acceptance/S10-acceptance.json
// {
//   "story": "S10",
//   "verifiedAt": "<ISO-8601 timestamp>",
//   "environment": {
//     "node": "v20.x.y",                 // Node.js used for the clean-clone acceptance rerun, must be 20.x
//     "nodePath": "<optional absolute path to that node binary>",
//     "pnpm": "10.28.2",
//     "platform": "<os and architecture>"
//   },
//   "clone": {
//     "source": "<git remote url>",
//     "branch": "chore/S10",
//     "commitSha": "<40 lowercase hex characters>",
//     "directory": "<temporary clone directory>",
//     "installCommand": "pnpm install --frozen-lockfile",
//     "installExitCode": 0
//   },
//   "scenarios": [
//     { "id": "SC1", "name": "本地快速自检", "command": "node bin/hello.js",
//       "stdout": "Hello, World!\n", "stderr": "", "exitCode": 0, "runs": 3 },
//     { "id": "SC2", "name": "个性化演示", "command": "node bin/hello.js --name Alice",
//       "stdout": "Hello, Alice!\n", "stderr": "", "exitCode": 0, "runs": 1 },
//     { "id": "SC3", "name": "流水线验证", "kind": "ci",
//       "runUrl": "https://github.com/<owner>/<repo>/actions/runs/<id>", "conclusion": "success" },
//     { "id": "SC4", "name": "交付验收复跑", "kind": "rerun",
//       "commands": ["node bin/hello.js", "node bin/hello.js --name Alice", "pnpm test"], "sameAsCi": true }
//   ],
//   "testSuite": {
//     "local": { "command": "pnpm test", "exitCode": 0, "tests": <n>, "pass": <n>, "fail": 0,
//                "summaryLines": ["ℹ tests <n>", "ℹ pass <n>", "ℹ fail 0"] },
//     "ci":    { "runUrl": "https://github.com/<owner>/<repo>/actions/runs/<id>", "jobName": "test",
//                "conclusion": "success", "tests": <n>, "pass": <n>, "fail": 0,
//                "summaryLines": ["ℹ tests <n>", "ℹ pass <n>", "ℹ fail 0"] },
//                // The green run may predate the record commit, so its case counts never exceed the local
//                // rerun; pointing it at the newest green run of this branch makes the counts equal.
//     "coverage": {
//       "defaultOutput": ["<passing case name>"],
//       "nameValue": ["<passing case name>"],
//       "nameMissingValue": ["<passing case name>"]
//     }
//   },
//   "metrics": [
//     { "id": "M1", "name": "hello 命令可运行", "status": "pass", "evidence": ["<command output>"] },
//     { "id": "M2", "name": "--name 参数可用", "status": "pass", "evidence": ["<command output>"] },
//     { "id": "M3", "name": "测试通过率", "status": "pass", "fail": 0,
//       "coverage": { "defaultOutput": <n>, "nameValue": <n>, "nameMissingValue": <n> }, "evidence": ["<pnpm test output>"] },
//     { "id": "M4", "name": "CI 成功率", "status": "pass", "successRate": 1,
//       "runs": [{ "url": "https://github.com/<owner>/<repo>/actions/runs/<id>", "conclusion": "success" }],
//       "evidence": ["<gh run list excerpt>"] },
//     { "id": "M5", "name": "运行时第三方依赖数", "status": "pass", "dependencies": 0,
//       "evidence": ["<pnpm list --prod --depth 0 output>"] }
//   ]
// }
//
// summaryLines must be copied verbatim from the test runner output (spec reporter),
// without `gh run view --log` job/step prefixes, so the local and CI triples are comparable.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RECORD_PATH = 'docs/acceptance/S10-acceptance.json';
const CORE_TEST_FILES = ['test/greet.test.js', 'test/cli.test.js'];
const DEFAULT_STDOUT = 'Hello, World!\n';
const USAGE_STDERR = 'Usage: hello [--name <name>]\n';
const TAP_SUMMARY = /^# (tests|pass|fail) (\d+)$/;
const SPEC_SUMMARY = /^ℹ (tests|pass|fail) (\d+)$/;
const CASE_ID = /\b(?:E2E|UT)-\d{2}\b/g;
const RUN_URL = /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/(\d+)$/;
const API_ROOT = resolveApiRoot();
const USER_AGENT = 'macos-hello-acceptance-test';
const TOKEN = resolveToken();
const BRANCHES = /^(?:chore\/S10|develop|main)$/;

const readText = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readPackageJson = () => JSON.parse(readText('package.json'));

/**
 * Load the committed S10 acceptance record.
 * @returns {Record<string, any>} parsed acceptance record
 */
const readRecord = () => {
  assert.ok(existsSync(new URL(`../${RECORD_PATH}`, import.meta.url)), `S10 acceptance record ${RECORD_PATH} must exist`);
  let record;
  try {
    record = JSON.parse(readText(RECORD_PATH));
  } catch (error) {
    assert.fail(`${RECORD_PATH} must contain valid JSON: ${error.message}`);
  }
  assert.equal(record.story, 'S10', `${RECORD_PATH} must describe story S10`);
  return record;
};

const readRecordIfPresent = () => {
  try {
    return readRecord();
  } catch {
    return null;
  }
};

// NODE_TEST_CONTEXT leaks into child processes; clearing it keeps nested test runs independent.
const CHILD_ENV = { ...process.env };
delete CHILD_ENV.NODE_TEST_CONTEXT;

/**
 * List node binaries installed by nvm or n for a specific major version.
 * @param {string[]} directories version manager roots
 * @param {string} prefix version directory prefix
 * @returns {string[]} candidate binary paths
 */
const versionedBinaries = (directories, prefix) =>
  directories.flatMap((directory) => {
    try {
      return readdirSync(directory)
        .filter((entry) => entry.startsWith(prefix))
        .sort()
        .reverse()
        .map((entry) => join(directory, entry, 'bin/node'));
    } catch {
      return [];
    }
  });

const nodeMajor = (binary) => {
  const { stdout, status } = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  if (status !== 0) return null;
  const match = /^v(\d+)\./.exec(stdout.trim());
  return match ? Number(match[1]) : null;
};

let runtime;
/**
 * Prefer a local Node.js 20 binary so the acceptance rerun matches the PRD, then
 * fall back to the runtime executing this suite (which must still satisfy engines >= 20).
 * @returns {{ binary: string, version: string, major: number|null }} runtime to use
 */
const resolveRuntime = () =>
  (runtime ??= (() => {
    const record = readRecordIfPresent();
    const candidates = [
      process.env.S10_NODE20,
      record?.environment?.nodePath,
      ...versionedBinaries([join(homedir(), '.nvm/versions/node'), '/usr/local/n/versions/node'], 'v20'),
      ...versionedBinaries([join(homedir(), '.nvm/versions/node'), '/usr/local/n/versions/node'], '20'),
      '/opt/homebrew/opt/node@20/bin/node',
      '/usr/local/opt/node@20/bin/node',
    ];
    for (const binary of candidates) {
      if (!binary || !existsSync(binary)) continue;
      const major = nodeMajor(binary);
      if (major === 20) {
        return { binary, version: spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout.trim(), major };
      }
    }
    return { binary: process.execPath, version: process.version, major: nodeMajor(process.execPath) };
  })());

/**
 * Run the real CLI inside a clone directory.
 * @param {string} binary node executable
 * @param {string[]} args CLI arguments
 * @param {string} cwd repository checkout
 * @returns {{ stdout: string, stderr: string, status: number|null }} process result
 */
function runCli(binary, args, cwd) {
  const { stdout, stderr, status } = spawnSync(binary, ['bin/hello.js', ...args], { cwd, encoding: 'utf8', env: CHILD_ENV });
  return { stdout, stderr, status };
}

let acceptance;
/**
 * Reproduce the S10 clean-clone acceptance run: clone the committed tree, prove the
 * CLI works without any installation, install with the frozen lockfile, then replay
 * the PRD section 3 scenarios. The clone only sees committed files, so forgotten
 * artifacts surface as failures instead of being masked by the working tree.
 * @returns {Record<string, any>} command results keyed by scenario
 */
const runFreshCloneAcceptance = () =>
  (acceptance ??= (() => {
    const directory = mkdtempSync(join(tmpdir(), 's10-acceptance-'));
    const clonePath = join(directory, 'macos-hello');
    try {
      const clone = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', ROOT, clonePath], {
        encoding: 'utf8',
        env: CHILD_ENV,
      });
      assert.equal(clone.status, 0, `git clone ${ROOT} must succeed, got ${clone.status}: ${clone.stderr}`);
      const node = resolveRuntime();
      const nodeModulesBeforeInstall = existsSync(join(clonePath, 'node_modules'));
      const beforeInstall = runCli(node.binary, [], clonePath);
      const install = spawnSync('pnpm', ['install', '--frozen-lockfile'], {
        cwd: clonePath,
        encoding: 'utf8',
        env: CHILD_ENV,
      });
      const defaultRuns = [runCli(node.binary, [], clonePath), runCli(node.binary, [], clonePath), runCli(node.binary, [], clonePath)];
      const alice = runCli(node.binary, ['--name', 'Alice'], clonePath);
      const wuMing = runCli(node.binary, ['--name', 'Wu Ming'], clonePath);
      const missing = runCli(node.binary, ['--name'], clonePath);
      return { node, nodeModulesBeforeInstall, beforeInstall, install, defaultRuns, alice, wuMing, missing };
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  })());

let coreSuite;
/**
 * Run the unit and CLI layers with the TAP reporter.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} child process result
 */
const runCoreSuite = () =>
  (coreSuite ??= spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...CORE_TEST_FILES], {
    cwd: ROOT,
    encoding: 'utf8',
    env: CHILD_ENV,
  }));

const tapOutput = (result) => `${result.stdout ?? ''}${result.stderr ?? ''}`;
const okCaseNames = (output) =>
  output
    .split('\n')
    .filter((line) => line.startsWith('ok '))
    .map((line) => line.replace(/^ok \d+ - /, ''));

/**
 * Read the tests/pass/fail triple from runner summary lines.
 * @param {string[]} lines summary lines
 * @param {RegExp} pattern anchored summary pattern
 * @returns {{ tests?: number, pass?: number, fail?: number }} parsed summary
 */
const summaryFrom = (lines, pattern) => {
  const summary = {};
  for (const line of lines) {
    const match = pattern.exec(String(line).trim());
    if (match) summary[match[1]] = Number(match[2]);
  }
  return summary;
};

const summaryTriple = (summary, label) => {
  for (const key of ['tests', 'pass', 'fail']) {
    assert.equal(typeof summary[key], 'number', `${label} must include a "tests/pass/fail" summary line for ${key}`);
  }
  return { tests: summary.tests, pass: summary.pass, fail: summary.fail };
};

const assertEvidence = (evidence, label) => {
  assert.ok(Array.isArray(evidence) && evidence.length > 0, `${label} must record at least one evidence entry`);
  for (const entry of evidence) {
    assert.ok(typeof entry === 'string' && entry.trim() !== '', `${label} evidence entries must be non-empty strings`);
  }
};

/**
 * Memoized owner/repo lookup shared by the network assertions.
 * @returns {string|null} owner/repo slug, or null when it cannot be resolved
 */
let repository;
const repoSlug = () => (repository ??= resolveRepository());

// Only the CI-run replay below touches the network; an offline machine or an
// unusable token must skip that case with a readable reason instead of failing.
const LIVE_SKIP = await probeGithub({ repository: repoSlug(), token: TOKEN, apiRoot: API_ROOT, userAgent: USER_AGENT });

const getJson = async (path) => {
  const response = await fetch(`${API_ROOT}/repos/${repoSlug()}${path}`, {
    headers: githubHeaders(TOKEN, USER_AGENT),
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
 * @param {string} url run URL recorded by the acceptance run
 * @returns {string} run id
 */
const runIdOf = (url) => {
  const match = RUN_URL.exec(String(url ?? ''));
  assert.ok(match, `expected a GitHub Actions run URL, got ${JSON.stringify(url)}`);
  return match[1];
};

const runCache = new Map();
const readRun = (url) => {
  const id = runIdOf(url);
  if (!runCache.has(id)) runCache.set(id, getJson(`/actions/runs/${id}`));
  return runCache.get(id);
};

const jobsCache = new Map();
const readJobs = (url) => {
  const id = runIdOf(url);
  if (!jobsCache.has(id)) jobsCache.set(id, getJson(`/actions/runs/${id}/jobs`));
  return jobsCache.get(id);
};

test('S10 AC1 a fresh clone runs before any install and installs with "pnpm install --frozen-lockfile"', () => {
  const run = runFreshCloneAcceptance();
  assert.ok(
    run.node.major !== null && run.node.major >= 20,
    `acceptance runtime must be Node.js 20 or newer, got ${run.node.version} (${run.node.binary})`,
  );
  assert.equal(run.nodeModulesBeforeInstall, false, 'a fresh clone must not contain node_modules before installing');
  assert.equal(run.beforeInstall.status, 0, `node bin/hello.js must run without any installed package\n${run.beforeInstall.stderr}`);
  assert.equal(run.beforeInstall.stdout, DEFAULT_STDOUT, `clean-environment stdout must be ${JSON.stringify(DEFAULT_STDOUT)}`);
  assert.equal(run.beforeInstall.stderr, '');
  assert.equal(
    run.install.status,
    0,
    `pnpm install --frozen-lockfile must exit 0 in the fresh clone\nstdout: ${run.install.stdout}\nstderr: ${run.install.stderr}`,
  );
});

test('S10 AC1 the fresh clone prints exactly "Hello, World!\\n" three times with exit 0 and empty stderr', () => {
  const { defaultRuns } = runFreshCloneAcceptance();
  assert.equal(defaultRuns.length, 3, 'the default scenario must run three consecutive times');
  defaultRuns.forEach((result, index) => {
    assert.equal(result.status, 0, `run ${index + 1}: exit code must be 0, got ${result.status}`);
    assert.equal(result.stdout, DEFAULT_STDOUT, `run ${index + 1}: stdout must be exactly ${JSON.stringify(DEFAULT_STDOUT)}, got ${JSON.stringify(result.stdout)}`);
    assert.equal(result.stderr, '', `run ${index + 1}: stderr must be empty, got ${JSON.stringify(result.stderr)}`);
  });
  for (const result of defaultRuns.slice(1)) {
    assert.equal(result.stdout, defaultRuns[0].stdout, 'three consecutive runs must produce identical stdout');
  }
});

test('S10 AC1 the fresh clone matches PRD US-02 for --name Alice, --name with a space and missing --name', () => {
  const { alice, wuMing, missing } = runFreshCloneAcceptance();
  assert.equal(alice.status, 0, '--name Alice: exit code must be 0');
  assert.equal(alice.stdout, 'Hello, Alice!\n', `--name Alice: stdout must be "Hello, Alice!\\n", got ${JSON.stringify(alice.stdout)}`);
  assert.equal(alice.stderr, '', '--name Alice: stderr must be empty');
  assert.equal(wuMing.status, 0, '--name "Wu Ming": exit code must be 0');
  assert.equal(wuMing.stdout, 'Hello, Wu Ming!\n', `--name "Wu Ming": stdout must be "Hello, Wu Ming!\\n", got ${JSON.stringify(wuMing.stdout)}`);
  assert.equal(wuMing.stderr, '', '--name "Wu Ming": stderr must be empty');
  assert.equal(missing.status, 1, 'missing --name value: exit code must be 1');
  assert.equal(missing.stdout, '', 'missing --name value: stdout must be empty');
  assert.equal(missing.stderr, USAGE_STDERR, `missing --name value: stderr must be exactly ${JSON.stringify(USAGE_STDERR)}`);
});

test('S10 AC2 the core suite reports zero failures and covers default output, "--name" value and "--name" missing value', () => {
  const result = runCoreSuite();
  const output = tapOutput(result);
  assert.equal(result.status, 0, `core suite must pass\n${output}`);
  const summary = summaryTriple(summaryFrom(output.split('\n'), TAP_SUMMARY), 'core suite');
  assert.equal(summary.fail, 0, `core suite failure count must be 0\n${output}`);
  assert.ok(summary.tests > 0, 'core suite must execute at least one case');
  assert.equal(summary.pass, summary.tests, `core suite pass count must equal tests count\n${output}`);
  const names = okCaseNames(output);
  for (const id of ['E2E-01', 'E2E-03', 'E2E-05']) {
    assert.ok(names.some((name) => name.includes(id)), `expected a passing CLI case named ${id}\n${output}`);
  }
  for (const id of ['UT-01', 'UT-05', 'UT-09']) {
    assert.ok(names.some((name) => name.includes(id)), `expected a passing unit case named ${id}\n${output}`);
  }
});

test('S10 AC3 the acceptance record documents the Node.js 20.x clean clone, install and four PRD scenarios', () => {
  const record = readRecord();
  assert.ok(!Number.isNaN(Date.parse(record.verifiedAt)), `verifiedAt must be an ISO-8601 timestamp, got ${JSON.stringify(record.verifiedAt)}`);
  const environment = record.environment ?? {};
  assert.match(
    String(environment.node),
    /^v?20\.\d+\.\d+$/,
    `clean-clone acceptance must run on Node.js 20.x, got ${JSON.stringify(environment.node)}`,
  );
  assert.equal(environment.pnpm, readPackageJson().packageManager.slice('pnpm@'.length), 'environment.pnpm must match packageManager');
  assert.ok(typeof environment.platform === 'string' && environment.platform.trim() !== '', 'environment.platform must be recorded');

  const clone = record.clone ?? {};
  assert.equal(clone.installCommand, 'pnpm install --frozen-lockfile');
  assert.equal(clone.installExitCode, 0);
  assert.match(String(clone.commitSha), /^[0-9a-f]{40}$/, `clone.commitSha must be a full commit sha, got ${JSON.stringify(clone.commitSha)}`);
  assert.match(String(clone.branch), BRANCHES, `clone.branch must be a project branch, got ${JSON.stringify(clone.branch)}`);
  assert.ok(typeof clone.source === 'string' && clone.source.includes('macos-hello'), 'clone.source must name the cloned repository');

  const scenarios = Array.isArray(record.scenarios) ? record.scenarios : [];
  assert.deepEqual(scenarios.map((scenario) => scenario.id), ['SC1', 'SC2', 'SC3', 'SC4'], 'the four PRD scenarios must be recorded in order');
  const [sc1, sc2, sc3, sc4] = scenarios;
  assert.equal(sc1.command, 'node bin/hello.js');
  assert.equal(sc1.stdout, DEFAULT_STDOUT);
  assert.equal(sc1.stderr, '');
  assert.equal(sc1.exitCode, 0);
  assert.ok(Number(sc1.runs) >= 3, `SC1 must record at least three consecutive runs, got ${sc1.runs}`);
  assert.equal(sc2.command, 'node bin/hello.js --name Alice');
  assert.equal(sc2.stdout, 'Hello, Alice!\n');
  assert.equal(sc2.stderr, '');
  assert.equal(sc2.exitCode, 0);
  assert.equal(sc3.kind, 'ci');
  assert.match(String(sc3.runUrl), RUN_URL, `SC3.runUrl must be a GitHub Actions run URL, got ${JSON.stringify(sc3.runUrl)}`);
  assert.equal(sc3.conclusion, 'success');
  assert.equal(sc4.kind, 'rerun');
  assert.deepEqual(sc4.commands, ['node bin/hello.js', 'node bin/hello.js --name Alice', 'pnpm test']);
  assert.equal(sc4.sameAsCi, true, 'SC4 must state the rerun matches the CI result');

  const run = runFreshCloneAcceptance();
  assert.equal(sc1.stdout, run.defaultRuns[0].stdout, 'SC1 stdout must match the fresh-clone rerun');
  assert.equal(sc1.exitCode, run.defaultRuns[0].status, 'SC1 exit code must match the fresh-clone rerun');
  assert.equal(sc2.stdout, run.alice.stdout, 'SC2 stdout must match the fresh-clone rerun');
  assert.equal(sc2.exitCode, run.alice.status, 'SC2 exit code must match the fresh-clone rerun');
});

test('S10 AC2 the acceptance record reports zero failures locally and in CI with matching summaries and case coverage', () => {
  const record = readRecord();
  const suite = record.testSuite ?? {};
  const local = suite.local ?? {};
  const ci = suite.ci ?? {};

  assert.equal(local.command, 'pnpm test');
  assert.equal(local.exitCode, 0, 'local pnpm test must exit 0');
  assert.equal(local.fail, 0, 'local failure count must be 0');
  assert.ok(Number.isInteger(local.tests) && local.tests > 0, `local.tests must be a positive integer, got ${JSON.stringify(local.tests)}`);
  assert.equal(local.pass, local.tests, 'local pass count must equal tests count');
  const localSummary = summaryTriple(summaryFrom(local.summaryLines ?? [], SPEC_SUMMARY), 'testSuite.local.summaryLines');
  assert.deepEqual(localSummary, { tests: local.tests, pass: local.pass, fail: local.fail }, 'local summary lines must match local counts');

  assert.equal(ci.jobName, 'test', 'CI evidence must come from the "test" job');
  assert.equal(ci.conclusion, 'success', 'CI test job must be green');
  assert.match(String(ci.runUrl), RUN_URL, `testSuite.ci.runUrl must be a GitHub Actions run URL, got ${JSON.stringify(ci.runUrl)}`);
  assert.equal(ci.fail, 0, 'CI failure count must be 0');
  assert.ok(
    Number.isInteger(ci.tests) && ci.tests > 0 && ci.tests <= local.tests,
    `CI case count must be between 1 and the local run size ${local.tests}, got ${JSON.stringify(ci.tests)}`,
  );
  assert.ok(
    Number.isInteger(ci.pass) && ci.pass <= ci.tests,
    `CI pass count must not exceed the CI case count, got ${JSON.stringify(ci.pass)}`,
  );
  const ciSummary = summaryTriple(summaryFrom(ci.summaryLines ?? [], SPEC_SUMMARY), 'testSuite.ci.summaryLines');
  assert.equal(ciSummary.fail, 0, 'the CI log summary must report zero failures');
  assert.equal(ciSummary.tests, ci.tests, 'CI summary lines must match the recorded CI case count');
  assert.equal(ciSummary.pass, ci.pass, 'CI summary lines must match the recorded CI pass count');
  if (ci.tests === local.tests) {
    assert.equal(ci.pass, local.pass, 'when the CI run covers the same suite, local and CI pass counts must match');
  }

  const expectedIds = {
    defaultOutput: ['E2E-01', 'E2E-02', 'E2E-04', 'UT-01', 'UT-02', 'UT-03'],
    nameValue: ['E2E-03', 'E2E-07', 'E2E-11', 'E2E-12', 'UT-05', 'UT-06', 'UT-07'],
    nameMissingValue: ['E2E-05', 'E2E-06', 'UT-08', 'UT-09'],
  };
  const passing = okCaseNames(tapOutput(runCoreSuite()));
  const coverage = suite.coverage ?? {};
  for (const [group, allowed] of Object.entries(expectedIds)) {
    const names = coverage[group];
    assert.ok(Array.isArray(names) && names.length > 0, `coverage.${group} must list at least one passing case`);
    const ids = names.flatMap((name) => String(name).match(CASE_ID) ?? []);
    assert.ok(
      ids.some((id) => allowed.includes(id)),
      `coverage.${group} must reference one of ${allowed.join('/')}, got ${JSON.stringify(names)}`,
    );
    for (const id of ids) {
      assert.ok(passing.some((name) => name.includes(id)), `coverage.${group} references ${id}, which is not a passing core case`);
    }
  }
});

test('S10 AC3 the acceptance record lists the five PRD success metrics with passing evidence', () => {
  const record = readRecord();
  const metrics = Array.isArray(record.metrics) ? record.metrics : [];
  assert.deepEqual(metrics.map((metric) => metric.id), ['M1', 'M2', 'M3', 'M4', 'M5'], 'all five PRD metrics must be recorded in order');
  const names = metrics.map((metric) => String(metric.name));
  assert.ok(names[0].includes('hello'), `M1 must describe the hello command, got ${JSON.stringify(names[0])}`);
  assert.ok(names[1].includes('--name'), `M2 must describe the --name flag, got ${JSON.stringify(names[1])}`);
  assert.ok(names[2].includes('测试'), `M3 must describe the test pass rate, got ${JSON.stringify(names[2])}`);
  assert.ok(names[3].includes('CI'), `M4 must describe the CI success rate, got ${JSON.stringify(names[3])}`);
  assert.ok(names[4].includes('依赖'), `M5 must describe runtime dependencies, got ${JSON.stringify(names[4])}`);
  for (const metric of metrics) {
    assert.equal(metric.status, 'pass', `${metric.id} must be marked pass, got ${JSON.stringify(metric.status)}`);
    assertEvidence(metric.evidence, `${metric.id}.evidence`);
  }

  const m3 = metrics[2];
  assert.equal(m3.fail, 0, 'M3 failure count must be 0');
  for (const group of ['defaultOutput', 'nameValue', 'nameMissingValue']) {
    assert.ok(
      Number.isInteger(m3.coverage?.[group]) && m3.coverage[group] >= 1,
      `M3 coverage.${group} must record at least one case, got ${JSON.stringify(m3.coverage?.[group])}`,
    );
  }

  const m4 = metrics[3];
  assert.equal(m4.successRate, 1, 'M4 success rate must be 100%');
  const runs = Array.isArray(m4.runs) ? m4.runs : [];
  assert.ok(runs.length >= 1 && runs.length <= 10, `M4 must list between 1 and 10 recent runs, got ${runs.length}`);
  for (const run of runs) {
    assert.match(String(run.url), RUN_URL, `M4 run url must be a GitHub Actions run URL, got ${JSON.stringify(run.url)}`);
    assert.equal(run.conclusion, 'success', `M4 run ${run.url} must be successful`);
  }

  const m5 = metrics[4];
  assert.equal(m5.dependencies, 0, 'M5 runtime dependency count must be 0');
  const listed = spawnSync('pnpm', ['list', '--prod', '--depth', '0', '--json'], { cwd: ROOT, encoding: 'utf8', env: CHILD_ENV });
  assert.equal(listed.status, 0, `pnpm list --prod must succeed: ${listed.error ?? listed.stderr}`);
  const entries = JSON.parse(listed.stdout).flatMap((project) => [
    ...Object.keys(project.dependencies ?? {}),
    ...Object.keys(project.optionalDependencies ?? {}),
  ]);
  assert.deepEqual(entries, [], 'production dependency entries must stay at zero');
});

test('S10 AC3 the recorded CI runs resolve to successful "CI" workflow runs with a green "test" job', { skip: LIVE_SKIP ?? undefined }, async () => {
  const record = readRecord();
  const urls = new Set();
  const sc3 = (record.scenarios ?? []).find((scenario) => scenario.id === 'SC3');
  if (sc3?.runUrl) urls.add(String(sc3.runUrl));
  const ciUrl = record.testSuite?.ci?.runUrl;
  assert.match(String(ciUrl), RUN_URL, 'testSuite.ci.runUrl must be recorded');
  urls.add(String(ciUrl));
  for (const run of record.metrics?.[3]?.runs ?? []) {
    if (run?.url) urls.add(String(run.url));
  }

  for (const url of urls) {
    const run = await readRun(url);
    assert.equal(run.conclusion, 'success', `${url} must be successful, got ${JSON.stringify(run.conclusion)}`);
    assert.equal(run.name, 'CI', `${url} must belong to the "CI" workflow, got ${JSON.stringify(run.name)}`);
    assert.equal(run.event, 'push', `${url} must be triggered by a push, got ${JSON.stringify(run.event)}`);
    assert.match(String(run.head_branch), BRANCHES, `${url} must run on a project branch, got ${JSON.stringify(run.head_branch)}`);
  }

  const jobs = await readJobs(String(ciUrl));
  const testJobs = (jobs.jobs ?? []).filter((job) => job.name === 'test');
  assert.ok(testJobs.length > 0, `CI run ${ciUrl} must contain a "test" job`);
  assert.ok(
    testJobs.some((job) => job.conclusion === 'success'),
    `CI run ${ciUrl} must contain a successful "test" job, got ${JSON.stringify(testJobs.map((job) => job.conclusion))}`,
  );

  for (const entry of record.metrics?.[3]?.runs ?? []) {
    const run = await readRun(String(entry.url));
    assert.ok(
      ['main', 'develop'].includes(run.head_branch),
      `M4 run ${entry.url} must be on main or develop, got ${JSON.stringify(run.head_branch)}`,
    );
    assert.equal(run.conclusion, 'success', `M4 run ${entry.url} must be successful`);
  }
});