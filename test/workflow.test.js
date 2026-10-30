import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW_URL = new URL('../.github/workflows/ci.yml', import.meta.url);
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const ZERO_DEP_STEP_NAME = 'Assert zero runtime dependencies';

/**
 * Minimal indentation-based YAML reader for the subset used by GitHub workflow files:
 * block mappings, block sequences, flow sequences/maps of scalars and literal block scalars.
 * @param {string} source YAML document
 * @returns {Record<string, unknown>} parsed mapping
 */
export function parseYaml(source) {
  const lines = source.split('\n');
  let pos = 0;

  const indentOf = (line) => line.length - line.trimStart().length;
  const isBlank = (line) => line.trim() === '' || line.trimStart().startsWith('#');
  const skipBlank = () => {
    while (pos < lines.length && isBlank(lines[pos])) pos += 1;
  };

  const parseScalar = (raw) => {
    const text = raw.trim();
    if (text.startsWith('[') && text.endsWith(']')) {
      const inner = text.slice(1, -1).trim();
      return inner === '' ? [] : inner.split(',').map((item) => parseScalar(item));
    }
    if (text.startsWith('{') && text.endsWith('}')) {
      const inner = text.slice(1, -1).trim();
      if (inner === '') return {};
      return Object.fromEntries(
        inner.split(',').map((pair) => {
          const separator = pair.indexOf(':');
          return [pair.slice(0, separator).trim(), parseScalar(pair.slice(separator + 1))];
        }),
      );
    }
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1);
    }
    if (text === 'true') return true;
    if (text === 'false') return false;
    if (text === 'null' || text === '~') return null;
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
    return text;
  };

  const parseBlockScalar = (parentIndent, style) => {
    const collected = [];
    let contentIndent = null;
    while (pos < lines.length) {
      const line = lines[pos];
      if (line.trim() === '') {
        collected.push('');
        pos += 1;
        continue;
      }
      if (indentOf(line) <= parentIndent) break;
      contentIndent ??= indentOf(line);
      collected.push(line.slice(contentIndent));
      pos += 1;
    }
    while (collected.length > 0 && collected[collected.length - 1] === '') collected.pop();
    return style.startsWith('>') ? collected.join(' ').replace(/\s+/g, ' ').trim() : collected.join('\n');
  };

  const parseMapping = (indent) => {
    const map = {};
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const line = lines[pos];
      const ind = indentOf(line);
      if (ind < indent) break;
      assert.equal(ind, indent, `workflow YAML must use consistent indentation near: ${line.trim()}`);
      const content = line.trim();
      if (content.startsWith('- ') || content === '-') break;
      const match = /^([A-Za-z0-9_.-]+):(?:[ ](.*))?$/.exec(content);
      assert.ok(match, `unsupported workflow YAML line: ${content}`);
      const [, key, inline = ''] = match;
      pos += 1;
      if (inline === '|' || inline === '|-' || inline === '>' || inline === '>-') {
        map[key] = parseBlockScalar(ind, inline);
        continue;
      }
      if (inline !== '') {
        map[key] = parseScalar(inline);
        continue;
      }
      skipBlank();
      if (pos < lines.length && indentOf(lines[pos]) > ind) {
        map[key] = parseBlock(indentOf(lines[pos]));
      } else if (pos < lines.length && indentOf(lines[pos]) === ind && lines[pos].trimStart().startsWith('- ')) {
        map[key] = parseSequence(ind);
      } else {
        map[key] = null;
      }
    }
    return map;
  };

  const parseSequence = (indent) => {
    const sequence = [];
    for (;;) {
      skipBlank();
      if (pos >= lines.length) break;
      const line = lines[pos];
      const ind = indentOf(line);
      if (ind !== indent) break;
      const content = line.trimStart();
      if (!content.startsWith('- ') && content !== '-') break;
      // Replace the dash with a space so the item body keeps its own indentation.
      lines[pos] = `${line.slice(0, ind)} ${line.slice(ind + 1)}`;
      skipBlank();
      if (pos >= lines.length) break;
      const itemIndent = indentOf(lines[pos]);
      const itemContent = lines[pos].trim();
      if (itemIndent > ind && /^[A-Za-z0-9_.-]+:(?:[ ]|$)/.test(itemContent)) {
        sequence.push(parseMapping(itemIndent));
      } else {
        sequence.push(parseScalar(itemContent));
        pos += 1;
      }
    }
    return sequence;
  };

  const parseBlock = (indent) => {
    const content = lines[pos].trimStart();
    return content.startsWith('- ') || content === '-' ? parseSequence(indent) : parseMapping(indent);
  };

  skipBlank();
  assert.ok(pos < lines.length, 'workflow YAML must not be empty');
  return parseBlock(indentOf(lines[pos]));
}

const readWorkflow = () => {
  assert.ok(existsSync(WORKFLOW_URL), `${WORKFLOW_PATH} must exist`);
  const source = readFileSync(WORKFLOW_URL, 'utf8');
  assert.ok(source.trim() !== '', `${WORKFLOW_PATH} must not be empty`);
  return parseYaml(source);
};

const readPackageJson = () => JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const testJob = (workflow) => {
  const jobs = workflow.jobs;
  assert.ok(jobs && typeof jobs === 'object' && !Array.isArray(jobs), 'workflow must declare a jobs mapping');
  const job = jobs.test;
  assert.ok(job, 'workflow must define a job with id "test"');
  assert.ok(Array.isArray(job.steps), 'test job must declare a steps sequence');
  return job;
};

const runOf = (step) => (typeof step?.run === 'string' ? step.run.trim() : null);
const nameOf = (step) => (typeof step?.name === 'string' ? step.name.trim() : null);

const requireStep = (job, predicate, message) => {
  const step = job.steps.find(predicate);
  assert.ok(step, message);
  return step;
};

const zeroDependencyStep = (job) =>
  requireStep(job, (step) => nameOf(step) === ZERO_DEP_STEP_NAME, `test job must contain a step named "${ZERO_DEP_STEP_NAME}"`);

test('S7 AC1 ci.yml is named CI and triggers on push and pull_request', () => {
  const workflow = readWorkflow();
  assert.equal(workflow.name, 'CI');

  const on = workflow.on;
  const triggers = Array.isArray(on)
    ? on
    : typeof on === 'string'
      ? [on]
      : on && typeof on === 'object'
        ? Object.keys(on)
        : [];
  assert.ok(triggers.includes('push'), `workflow must trigger on push, got ${JSON.stringify(on)}`);
  assert.ok(triggers.includes('pull_request'), `workflow must trigger on pull_request, got ${JSON.stringify(on)}`);

  const pushConfig = on && typeof on === 'object' && !Array.isArray(on) ? on.push : null;
  if (pushConfig && pushConfig.branches) {
    assert.ok(
      pushConfig.branches.includes('develop'),
      `push trigger must include develop, got ${JSON.stringify(pushConfig.branches)}`,
    );
  }
});

test('S7 AC1 test job runs pnpm install --frozen-lockfile then pnpm test on Node.js 20.x', () => {
  const job = testJob(readWorkflow());
  assert.equal(nameOf(job), 'test', 'test job must expose the status check context "test"');

  const nodeStep = requireStep(
    job,
    (step) => typeof step.uses === 'string' && step.uses.startsWith('actions/setup-node@'),
    'test job must use actions/setup-node',
  );
  const nodeVersion = String(nodeStep.with?.['node-version'] ?? '');
  assert.match(nodeVersion, /^20(?:\.x)?$/, `setup-node must pin Node.js 20.x, got ${JSON.stringify(nodeVersion)}`);

  const installIndex = job.steps.findIndex((step) => runOf(step) === 'pnpm install --frozen-lockfile');
  const testIndex = job.steps.findIndex((step) => /(^|\s)pnpm test(?:\s|$)/.test(String(step.run ?? '')));
  assert.ok(installIndex >= 0, 'test job must run "pnpm install --frozen-lockfile"');
  assert.ok(testIndex >= 0, 'test job must run "pnpm test"');
  assert.ok(installIndex < testIndex, 'dependencies must be installed before tests run');
});

test('S7 AC1 test job provisions the pnpm version pinned by packageManager', () => {
  const job = testJob(readWorkflow());
  const { packageManager } = readPackageJson();
  assert.match(String(packageManager), /^pnpm@\d+\.\d+\.\d+$/, 'package.json must pin an exact pnpm version');

  const pnpmStep = requireStep(
    job,
    (step) => typeof step.uses === 'string' && step.uses.startsWith('pnpm/action-setup@'),
    'test job must use pnpm/action-setup',
  );
  assert.equal(String(pnpmStep.with?.version), packageManager.slice('pnpm@'.length));
});

test('S7 AC2 zero dependency step prints "runtime dependencies: 0"', () => {
  const step = zeroDependencyStep(testJob(readWorkflow()));
  const script = runOf(step);
  assert.ok(script, 'the zero dependency step must run a shell script');

  const { status, stdout, stderr } = spawnSync('bash', ['-e', '-c', script], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(status, 0, `zero dependency step must succeed\nstdout: ${stdout}\nstderr: ${stderr}`);
  assert.match(stdout, /^runtime dependencies: 0$/m, `step must log "runtime dependencies: 0", got ${JSON.stringify(stdout)}`);
});

test('S7 AC2 zero dependency step fails when package.json declares a runtime dependency', () => {
  const step = zeroDependencyStep(testJob(readWorkflow()));
  const directory = mkdtempSync(join(tmpdir(), 'zero-deps-'));
  try {
    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'fixture', dependencies: { 'example-runtime-dependency': '1.0.0' } }),
    );
    const { status } = spawnSync('bash', ['-e', '-c', runOf(step)], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(status, 0, 'the assertion must exit non-zero when a runtime dependency exists');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('S7 AC3 workflow permissions are limited to contents: read', () => {
  const workflow = readWorkflow();
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  const job = testJob(workflow);
  if (job.permissions !== undefined && job.permissions !== null) {
    assert.deepEqual(job.permissions, { contents: 'read' }, 'job permissions must not exceed contents: read');
  }
});

test('S7 AC3 test job is a single ubuntu-latest job capped at 10 minutes', () => {
  const job = testJob(readWorkflow());
  assert.equal(job['runs-on'], 'ubuntu-latest');
  assert.equal(job['timeout-minutes'], 10, 'test job must set timeout-minutes to 10');
});