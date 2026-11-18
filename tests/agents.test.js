import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heuristicAnalysis } from '../src/agents/requirement.agent.js';
import { compileCriterion } from '../src/agents/test-generation.agent.js';
import { heuristicInvestigation } from '../src/agents/failure-analysis.agent.js';
import { buildReport } from '../src/agents/reporting.agent.js';
import { redact } from '../src/core/logger.js';
import { adfToText, textToAdf } from '../src/integrations/jira/cloud-client.js';

const ticket = {
  key: 'SHOP-9', summary: 'Login', description: 'As a customer\nI want to log in\nSo that I can buy. It should be fast.',
  acceptanceCriteria: 'Scenario: ok\n  Given I am on the "login" page\n  When I fill "login-email" with "a@b.c"\n  And I click "login-submit"\n  Then I should see "Welcome"\n\nScenario: api\n  When I send a GET request to "/api/x"\n  Then the response status should be 200',
  status: 'Ready for QA', type: 'Story', priority: 'High', labels: [], assignee: null, comments: [], updated: '2026-01-01', url: null,
};

test('requirement agent parses user story, scenarios and ambiguities', () => {
  const a = heuristicAnalysis(ticket);
  assert.equal(a.userStory.asA, 'customer');
  const acs = a.requirements[0].acceptanceCriteria;
  assert.equal(acs.length, 2);
  assert.deepEqual(acs[0].when, ['I fill "login-email" with "a@b.c"', 'I click "login-submit"']);
  assert.equal(a.requirements[0].kind, 'mixed');
  assert.ok(a.ambiguities.some((x) => x.includes('"fast"')));
});

test('step compiler produces Playwright code and flags unknown selectors', () => {
  const a = heuristicAnalysis(ticket);
  const ui = compileCriterion(a.requirements[0].acceptanceCriteria[0], ['login-email', 'login-submit-btn']);
  assert.ok(ui.lines.includes(`await page.goto('/login');`));
  assert.ok(ui.lines.includes(`await page.getByTestId('login-email').fill('a@b.c');`));
  assert.equal(ui.warnings.length, 1);
  assert.match(ui.warnings[0], /login-submit.*similar: login-submit-btn/);
  const api = compileCriterion(a.requirements[0].acceptanceCriteria[1]);
  assert.equal(api.kind, 'api');
  assert.ok(api.lines.includes('expect(res.status()).toBe(200);'));
  const unknown = compileCriterion({ id: 'x', title: 't', given: [], when: ['I dance'], then: [] });
  assert.deepEqual(unknown.unsupported, ['I dance']);
});

test('failure analysis classifies product defects and automation issues', () => {
  const defect = heuristicInvestigation({
    failure: { testId: 'SHOP-9-AC1', title: 'total', status: 'failed', durationMs: 10, startedAt: null, error: { message: "Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByTestId('cart-total')\nExpected: \"$90.00\"\nReceived: \"$99.00\"" } },
    test: { code: "// When x\nawait page.goto('/cart');", warnings: [] },
    logs: [{ ts: '2026-01-01T00:00:00.000Z', level: 'warn', msg: '[pricing] bad rate' }],
    knownIds: [],
    ticketKey: 'SHOP-9',
  });
  assert.equal(defect.category, 'product_defect');
  assert.ok(defect.proposedDefect.summary.includes('expected "$90.00" but got "$99.00"'));

  const automation = heuristicInvestigation({
    failure: { testId: 'SHOP-9-AC2', title: 'reset', status: 'failed', durationMs: 10, startedAt: null, error: { message: "TimeoutError: locator.fill: Timeout 4000ms exceeded.\nCall log:\n  - waiting for getByTestId('reset-email')" } },
    test: { code: '', warnings: ['Selector data-testid="reset-email" was not found'] },
    logs: [],
    knownIds: ['reset-email-input'],
    ticketKey: 'SHOP-9',
  });
  assert.equal(automation.category, 'automation_issue');
  assert.ok(automation.suggestedActions[0].includes('reset-email-input'));
});

test('report verdict reflects defects and gaps', () => {
  const analysis = heuristicAnalysis(ticket);
  const base = { analysis, generation: { ticketKey: 'SHOP-9', suiteDir: '', files: [], tests: [], source: 'heuristic' }, health: { healthy: true, version: '1', environment: 'staging' } };
  const results = (s1, s2) => ({ executionId: 'e', results: [{ testId: 'SHOP-9-AC1', status: s1 }, { testId: 'SHOP-9-AC2', status: s2 }] });
  assert.equal(buildReport({ ...base, execution: results('passed', 'passed'), failureAnalysis: null }).verdict, 'needs_attention'); // ambiguity "fast"
  const blocked = buildReport({ ...base, execution: results('passed', 'failed'), failureAnalysis: { investigations: [{ testId: 'SHOP-9-AC2', category: 'product_defect', rootCause: 'x', suggestedActions: [], recurring: false }] } });
  assert.equal(blocked.verdict, 'blocked');
  assert.equal(blocked.metrics.passRate, 0.5);
});

test('secrets are redacted from logs', () => {
  assert.equal(redact('token=abc123'), 'token=[REDACTED]');
  assert.equal(redact('using sk-ant-api03-xyz'), 'using [REDACTED]');
  assert.ok(!redact(JSON.stringify({ apiToken: 'secret' })).includes('secret'));
});

test('Jira ADF conversion round-trips text', () => {
  assert.equal(adfToText(textToAdf('Line one\nLine two\n\nSecond paragraph')), 'Line one\nLine two\n\nSecond paragraph');
});
