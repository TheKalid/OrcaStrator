import { z } from 'zod';

/**
 * Runs part of the test library on demand: a suite such as smoke or
 * regression (selected by tag), everything, or one test case.
 * Environment health is checked first so a down environment is not reported
 * as failing tests.
 */
export const testSuite = {
  id: 'test-suite',
  name: 'Run a test suite',
  description: 'Runs a suite (smoke, regression…), all tests or a single test case from the test library against the selected environment.',
  input: z.object({
    suite: z.string().regex(/^[@\w-]+$/, 'Expected a suite name like smoke').default('all'),
    filter: z.string().max(300).optional(),
    environment: z.string().optional(),
  }),
  label: (input) => (input.filter ? `test ${input.filter}` : input.suite === 'all' ? 'all tests' : `${input.suite} suite`),
  steps: [
    {
      id: 'check-environment',
      name: 'Environment health',
      agent: 'deployment-monitor',
      action: 'checkHealth',
      input: (ctx) => ({ environment: ctx.input.environment }),
      retries: 2,
      summarize: (h) => `${h.environment} ${h.healthy ? 'healthy' : 'unhealthy'} · v${h.version || '?'} · ${h.latencyMs}ms`,
    },
    {
      id: 'execute-tests',
      name: 'Playwright execution',
      agent: 'deployment-monitor',
      action: 'runSuite',
      when: (ctx) => ctx.steps['check-environment'].healthy,
      whenLabel: 'environment healthy',
      input: (ctx) => ({ suite: ctx.input.suite, filter: ctx.input.filter, environment: ctx.input.environment }),
      retries: 0,
      timeoutMs: 600000,
      summarize: (e) => `${e.summary.passed}/${e.summary.total} passed · ${e.summary.failed} failed · ${Math.round(e.durationMs / 100) / 10}s`,
    },
  ],
  output: (ctx) => {
    const e = ctx.steps['execute-tests'];
    if (!e) return { verdict: 'not_run', reason: 'The environment is unhealthy, so no tests were run.' };
    const s = e.summary;
    return {
      verdict: s.failed ? 'failed' : s.total ? 'passed' : 'not_run',
      suite: ctx.input.suite,
      executionId: e.executionId,
      reason: s.total ? `${s.passed} of ${s.total} passed${s.failed ? `, ${s.failed} failed` : ''}${s.skipped ? `, ${s.skipped} skipped` : ''}.` : 'No test matched this suite.',
      passRate: s.total ? s.passed / s.total : null,
    };
  },
};
