import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubHeaders, probeGithub, resolveApiRoot, resolveRepository, resolveToken } from '../test-support/live-github.js';

const API_ROOT = resolveApiRoot();
const PROTECTED_REF = 'refs/heads/main';
const REQUIRED_CHECK_CONTEXT = 'test';
const USER_AGENT = 'macos-hello-ruleset-test';
const TOKEN = resolveToken();

let repository;
const repoSlug = () => (repository ??= resolveRepository());

// These cases assert live repository state, so an offline machine, a missing
// token or a rate limit must skip them with a readable reason instead of
// failing the whole suite. The probe still returns null when the API is usable.
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

let rulesetsRequest;
const readBranchRulesets = () => {
  rulesetsRequest ??= (async () => {
    const summaries = await getJson('/rulesets?per_page=100');
    assert.ok(Array.isArray(summaries), 'GET /rulesets must return an array');
    const details = [];
    for (const summary of summaries) {
      if (summary.target !== 'branch') continue;
      details.push(await getJson(`/rulesets/${summary.id}`));
    }
    return details;
  })();
  return rulesetsRequest;
};

const coversMain = (ruleset) => {
  const { include = [], exclude = [] } = ruleset.conditions?.ref_name ?? {};
  const included = include.includes(PROTECTED_REF) || include.includes('~ALL');
  const excluded = exclude.includes(PROTECTED_REF) || exclude.includes('~ALL');
  return included && !excluded;
};

const mainProtection = async () => {
  const rulesets = await readBranchRulesets();
  const active = rulesets.filter((ruleset) => ruleset.enforcement === 'active' && coversMain(ruleset));
  assert.ok(
    active.length > 0,
    `expected an active branch ruleset whose conditions include "${PROTECTED_REF}", got ${JSON.stringify(
      rulesets.map((ruleset) => ({ name: ruleset.name, enforcement: ruleset.enforcement, conditions: ruleset.conditions })),
    )}`,
  );
  const rules = active.flatMap((ruleset) => ruleset.rules ?? []);
  return { rulesets: active, rules };
};

const ruleTypes = (rules) => rules.map((rule) => rule.type);
const ruleOfType = (rules, type) => {
  const rule = rules.find((candidate) => candidate.type === type);
  assert.ok(rule, `main branch ruleset must include the "${type}" rule, got ${JSON.stringify(ruleTypes(rules))}`);
  return rule;
};

const requiredCheckContexts = (rules) =>
  (ruleOfType(rules, 'required_status_checks').parameters?.required_status_checks ?? []).map((check) => check.context);

test('S8 AC1 main branch ruleset blocks branch deletion and force pushes', { skip: LIVE_SKIP ?? undefined }, async () => {
  const { rules } = await mainProtection();
  const types = ruleTypes(rules);
  assert.ok(types.includes('deletion'), `main branch ruleset must block branch deletion, got rules ${JSON.stringify(types)}`);
  assert.ok(types.includes('non_fast_forward'), `main branch ruleset must block force pushes, got rules ${JSON.stringify(types)}`);
});

test('S8 AC1 main branch ruleset requires a pull request with the test status check', { skip: LIVE_SKIP ?? undefined }, async () => {
  const { rules } = await mainProtection();
  ruleOfType(rules, 'pull_request');
  const contexts = requiredCheckContexts(rules);
  assert.ok(
    contexts.includes(REQUIRED_CHECK_CONTEXT),
    `main branch ruleset must require the "${REQUIRED_CHECK_CONTEXT}" status check, got ${JSON.stringify(contexts)}`,
  );
});

test('S8 AC3 main branch ruleset requires no human approval', { skip: LIVE_SKIP ?? undefined }, async () => {
  const { rules } = await mainProtection();
  const { parameters = {} } = ruleOfType(rules, 'pull_request');
  assert.equal(
    parameters.required_approving_review_count,
    0,
    `ruleset must not require approving reviews, got ${parameters.required_approving_review_count}`,
  );
  assert.notEqual(parameters.require_code_owner_review, true, 'ruleset must not require code owner review');
  assert.notEqual(parameters.require_last_push_approval, true, 'ruleset must not require last push approval');
});

test('S8 AC2 a failing test check blocks merging because no actor may bypass the main ruleset', { skip: LIVE_SKIP ?? undefined }, async () => {
  const { rulesets, rules } = await mainProtection();
  const contexts = requiredCheckContexts(rules);
  assert.ok(
    contexts.includes(REQUIRED_CHECK_CONTEXT),
    `a failing "${REQUIRED_CHECK_CONTEXT}" check must block merge, got required checks ${JSON.stringify(contexts)}`,
  );
  const bypassActors = rulesets.flatMap((ruleset) => ruleset.bypass_actors ?? []);
  assert.deepEqual(
    bypassActors,
    [],
    `main branch ruleset must not grant bypass actors, otherwise a failing "${REQUIRED_CHECK_CONTEXT}" check could still be merged`,
  );
});