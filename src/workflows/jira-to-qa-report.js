import { z } from 'zod';

const productDefects = (ctx) => (ctx.steps['analyze-failures']?.investigations || []).filter((i) => i.category === 'product_defect' && i.proposedDefect);

/**
 * MVP workflow:
 * Jira Ticket → Requirement Analysis (∥ Environment Health) → Test Generation →
 * Playwright Execution → Failure Analysis (if failures) → QA Report →
 * File Defects in Jira (if product defects, after human approval)
 */
export const jiraToQaReport = {
  id: 'jira-to-qa-report',
  name: 'Jira ticket → QA report',
  description: 'Analyzes a Jira ticket, generates and runs Playwright tests, investigates failures and produces a QA report.',
  input: z.object({ ticketKey: z.string().regex(/^[A-Z][A-Z0-9]+-\d+$/, 'Expected a Jira key like SHOP-101'), environment: z.string().optional() }),
  label: (input) => input.ticketKey,
  steps: [
    {
      id: 'fetch-ticket',
      name: 'Fetch Jira ticket',
      agent: 'jira-monitor',
      action: 'getTicket',
      input: (ctx) => ({ ticketKey: ctx.input.ticketKey }),
      summarize: (t) => `${t.key} · ${t.status} · ${t.summary}`,
    },
    {
      id: 'prepare',
      name: 'Analyze & check environment',
      parallel: [
        {
          id: 'analyze-requirements',
          name: 'Requirement analysis',
          agent: 'requirement',
          action: 'analyze',
          input: (ctx) => ({ ticket: ctx.steps['fetch-ticket'] }),
          summarize: (a) => `${a.requirements.length} req · ${a.requirements.reduce((n, r) => n + r.acceptanceCriteria.length, 0)} AC · ${a.ambiguities.length} ambiguities`,
        },
        {
          id: 'check-environment',
          name: 'Environment health',
          agent: 'deployment-monitor',
          action: 'checkHealth',
          input: (ctx) => ({ environment: ctx.input.environment }),
          retries: 2,
          summarize: (h) => `${h.environment} ${h.healthy ? 'healthy' : 'unhealthy'} · v${h.version || '?'} · ${h.latencyMs}ms`,
        },
      ],
    },
    {
      id: 'generate-tests',
      name: 'Test generation',
      agent: 'test-generation',
      action: 'generate',
      when: (ctx) => ctx.steps['analyze-requirements'].requirements.some((r) => r.testable),
      whenLabel: 'ticket has testable acceptance criteria',
      input: (ctx) => ({ analysis: ctx.steps['analyze-requirements'], runId: ctx.run.id, environment: ctx.input.environment }),
      summarize: (g) => `${g.tests.length} tests · ${g.files.length} files · ${g.tests.reduce((n, t) => n + t.warnings.length, 0)} warnings`,
    },
    {
      id: 'execute-tests',
      name: 'Playwright execution',
      agent: 'deployment-monitor',
      action: 'runTests',
      when: (ctx) => ctx.steps['generate-tests']?.tests.length > 0 && ctx.steps['check-environment'].healthy,
      whenLabel: 'tests generated and environment healthy',
      input: (ctx) => ({ generation: ctx.steps['generate-tests'], environment: ctx.input.environment }),
      retries: 0,
      timeoutMs: 300000,
      summarize: (e) => `${e.summary.passed}/${e.summary.total} passed · ${e.summary.failed} failed · ${Math.round(e.durationMs / 100) / 10}s`,
    },
    {
      id: 'analyze-failures',
      name: 'Failure analysis',
      agent: 'failure-analysis',
      action: 'investigate',
      when: (ctx) => ctx.steps['execute-tests']?.summary.failed > 0,
      whenLabel: 'at least one test failed',
      input: (ctx) => ({ execution: ctx.steps['execute-tests'], generation: ctx.steps['generate-tests'] }),
      summarize: (f) => f.investigations.map((i) => `${i.testId}: ${i.category}`).join(' · '),
    },
    {
      id: 'qa-report',
      name: 'QA report',
      agent: 'reporting',
      action: 'generateReport',
      input: (ctx) => ({
        runId: ctx.run.id,
        analysis: ctx.steps['analyze-requirements'],
        generation: ctx.steps['generate-tests'] || null,
        execution: ctx.steps['execute-tests'] || null,
        failureAnalysis: ctx.steps['analyze-failures'] || null,
        health: ctx.steps['check-environment'] || null,
      }),
      summarize: (r) => `${r.verdict} · pass rate ${Math.round(r.metrics.passRate * 100)}%`,
    },
    {
      id: 'file-defects',
      name: 'File defects in Jira',
      agent: 'jira-monitor',
      action: 'createDefects',
      when: (ctx) => productDefects(ctx).length > 0,
      whenLabel: 'product defects identified',
      approval: {
        title: (ctx) => `Create ${productDefects(ctx).length} defect(s) in Jira for ${ctx.input.ticketKey}`,
        summary: (ctx) => productDefects(ctx).map((i) => `• [${i.proposedDefect.severity}] ${i.proposedDefect.summary}`).join('\n'),
      },
      input: (ctx) => ({
        ticketKey: ctx.input.ticketKey,
        defects: productDefects(ctx).map((i) => ({ testId: i.testId, executionId: ctx.steps['execute-tests'].executionId, ...i.proposedDefect })),
      }),
      continueOnError: true,
      retries: 0,
      summarize: (r) => r.created.map((c) => c.key).join(', '),
    },
  ],
  output: (ctx) => ({
    ticketKey: ctx.input.ticketKey,
    verdict: ctx.steps['qa-report']?.verdict,
    reportId: ctx.steps['qa-report']?.reportId,
    passRate: ctx.steps['qa-report']?.metrics.passRate,
    // Plain-language "why" for the verdict, shown next to it in the dashboard.
    reason: ctx.steps['qa-report']?.recommendations[0] || null,
    defectsCreated: ctx.steps['file-defects']?.created || [],
  }),
};
