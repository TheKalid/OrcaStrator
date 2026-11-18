import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { BaseAgent } from '../core/agent.js';
import { RequirementAnalysis, TestGenerationResult, ExecutionResult, FailureAnalysisResult, QAReport } from '../core/contracts.js';
import { newId, now } from '../core/util.js';

/**
 * Reporting & Optimization Agent
 * Produces QA reports per run and cross-run insights: recurring issues,
 * flaky tests, automation gaps and improvement recommendations.
 */
export class ReportingAgent extends BaseAgent {
  constructor() {
    super({
      id: 'reporting',
      name: 'Reporting & Optimization Agent',
      description: 'Generates QA reports, identifies recurring issues, detects automation gaps and recommends improvements.',
      tags: ['reporting', 'optimization'],
    });

    this.action(
      'generateReport',
      {
        input: z.object({
          runId: z.string(),
          analysis: RequirementAnalysis,
          generation: TestGenerationResult.nullable(),
          execution: ExecutionResult.nullable(),
          failureAnalysis: FailureAnalysisResult.nullable(),
          health: z.object({ healthy: z.boolean(), version: z.string().nullable(), environment: z.string() }).passthrough().nullable(),
        }),
        output: QAReport,
        description: 'QA report for one workflow run',
      },
      async (input, ctx) => {
        const report = buildReport(input, ctx.memory.global.get('failure.signatures', {}));
        if (ctx.llm.available) {
          try {
            report.summary = await ctx.llm.generateText({
              system: 'You are a QA lead. Write a 3-4 sentence executive summary of a test run for engineering managers. Be factual; no marketing language.',
              prompt: JSON.stringify({ verdict: report.verdict, metrics: report.metrics, defects: report.defects, automationGaps: report.automationGaps, recurringIssues: report.recurringIssues }),
            });
          } catch (err) {
            ctx.log.warn(`LLM summary failed, keeping template summary: ${err.message}`);
          }
        }
        report.markdown = toMarkdown(report, input);
        const dir = path.join(ctx.config.paths.workspace, 'runs', input.runId);
        fs.mkdirSync(dir, { recursive: true });
        report.markdownPath = path.join(dir, 'qa-report.md');
        fs.writeFileSync(report.markdownPath, report.markdown);
        fs.writeFileSync(path.join(dir, 'qa-report.json'), JSON.stringify({ ...report, markdown: undefined }, null, 2));

        ctx.memory.global.update('reports.index', (idx = []) => [{ reportId: report.reportId, runId: input.runId, ticketKey: report.ticketKey, verdict: report.verdict, passRate: report.metrics.passRate, at: report.generatedAt }, ...idx].slice(0, 200));
        ctx.trace([{ id: report.reportId, type: 'report', label: `QA report ${report.ticketKey}: ${report.verdict}`, data: { verdict: report.verdict, passRate: report.metrics.passRate, runId: input.runId } }], [{ from: report.ticketKey, to: report.reportId, rel: 'reported_in' }]);
        ctx.log.info(`Report ${report.reportId}: ${report.verdict} (pass rate ${(report.metrics.passRate * 100).toFixed(0)}%)`);
        return QAReport.parse(report);
      },
    );

    this.action(
      'insights',
      {
        input: z.object({}).default({}),
        output: z.object({
          recurringFailures: z.array(z.object({ signature: z.string(), testId: z.string(), ticketKey: z.string(), category: z.string(), count: z.number(), lastSeen: z.string(), rootCause: z.string() })),
          flakyTests: z.array(z.object({ testId: z.string(), history: z.array(z.string()) })),
          recommendations: z.array(z.string()),
        }),
        description: 'Cross-run optimization insights',
      },
      async (_input, ctx) => {
        const sigs = ctx.memory.global.get('failure.signatures', {});
        const history = ctx.memory.global.get('test.history', {});
        const recurringFailures = Object.entries(sigs)
          .filter(([, s]) => s.count > 1)
          .map(([signature, s]) => ({ signature, ...s }))
          .sort((a, b) => b.count - a.count);
        const flakyTests = Object.entries(history)
          .filter(([, h]) => h.includes('passed') && h.some((s) => s !== 'passed' && s !== 'skipped'))
          .map(([testId, h]) => ({ testId, history: h }));
        const recommendations = [];
        const autoIssues = recurringFailures.filter((r) => r.category === 'automation_issue');
        if (autoIssues.length) recommendations.push(`${autoIssues.length} recurring automation issue(s): align data-testid conventions between acceptance criteria and implementation.`);
        const defects = recurringFailures.filter((r) => r.category === 'product_defect');
        if (defects.length) recommendations.push(`${defects.length} product defect(s) keep reappearing: add regression unit tests close to the code that fails (${[...new Set(defects.map((d) => d.ticketKey))].join(', ')}).`);
        if (flakyTests.length) recommendations.push(`${flakyTests.length} flaky test(s) detected: quarantine and stabilize them (${flakyTests.map((f) => f.testId).join(', ')}).`);
        if (!recommendations.length) recommendations.push('No recurring problems detected across runs.');
        return { recurringFailures, flakyTests, recommendations };
      },
    );
  }
}

export function buildReport({ analysis, generation, execution, failureAnalysis, health }, signatures = {}) {
  const acs = analysis.requirements.flatMap((r) => r.acceptanceCriteria);
  const tests = generation?.tests || [];
  const results = execution?.results || [];
  const invs = failureAnalysis?.investigations || [];
  const passed = results.filter((r) => r.status === 'passed').length;
  const failed = results.filter((r) => r.status === 'failed' || r.status === 'timedOut').length;
  const coveredAcs = new Set(results.filter((r) => r.status === 'passed' || r.status === 'failed' || r.status === 'timedOut').map((r) => r.testId));

  const automationGaps = [
    ...analysis.requirements.filter((r) => !r.testable).map((r) => `${r.id} "${r.title}" has no testable acceptance criteria.`),
    ...analysis.ambiguities.map((a) => `Ambiguity: ${a}`),
    ...tests.filter((t) => t.unsupportedSteps.length).map((t) => `${t.id}: steps not automatable yet → ${t.unsupportedSteps.join('; ')}`),
    ...tests.flatMap((t) => t.warnings.map((w) => `${t.id}: ${w}`)),
    ...acs.filter((ac) => !tests.some((t) => t.acceptanceCriterionId === ac.id)).map((ac) => `${ac.id} "${ac.title}" has no generated test.`),
  ];

  const recurringIssues = invs.filter((i) => i.recurring).map((i) => `${i.testId} failed ${i.occurrences}× with the same signature (${i.category}): ${i.rootCause}`);
  for (const [sig, s] of Object.entries(signatures)) {
    if (s.ticketKey === analysis.ticketKey && s.count > 1 && !invs.some((i) => i.signature === sig)) recurringIssues.push(`${s.testId} previously failed ${s.count}× (${s.category}), not reproduced in this run.`);
  }

  const defects = invs.map((i) => ({ testId: i.testId, category: i.category, summary: i.rootCause }));
  const productDefects = invs.filter((i) => i.category === 'product_defect');
  const envIssues = invs.filter((i) => i.category === 'environment_issue');

  const recommendations = [];
  if (health && !health.healthy) recommendations.push(`Environment ${health.environment} is unhealthy; fix it before trusting results.`);
  if (productDefects.length) recommendations.push(`Block the release of ${analysis.ticketKey}: ${productDefects.length} acceptance criterion/criteria fail due to product defects.`);
  invs.filter((i) => i.category === 'automation_issue').forEach((i) => recommendations.push(...i.suggestedActions.slice(0, 1)));
  if (envIssues.length) recommendations.push('Add an environment health gate before test execution.');
  if (analysis.ambiguities.length) recommendations.push(`Refine ${analysis.ticketKey} with the product owner to remove ${analysis.ambiguities.length} ambiguity(ies).`);
  if (!recommendations.length) recommendations.push('All acceptance criteria verified. Promote the generated tests to the regression suite.');

  const blocked = productDefects.length || envIssues.length || (health && !health.healthy);
  const attention = !execution || failed || automationGaps.length || results.some((r) => r.status === 'skipped');
  const verdict = blocked ? 'blocked' : attention ? 'needs_attention' : 'ready_for_release';
  const metrics = {
    requirements: analysis.requirements.length,
    acceptanceCriteria: acs.length,
    testsGenerated: tests.length,
    testsExecuted: results.filter((r) => r.status !== 'skipped').length,
    passed,
    failed,
    passRate: results.length ? round(passed / results.length) : 0,
    acCoverage: acs.length ? round(coveredAcs.size / acs.length) : 0,
  };
  const summary =
    `${analysis.ticketKey}: ${metrics.testsGenerated} test(s) generated from ${metrics.acceptanceCriteria} acceptance criteria; ` +
    `${passed} passed and ${failed} failed (${Math.round(metrics.passRate * 100)}% pass rate). ` +
    (productDefects.length ? `${productDefects.length} probable product defect(s) found. ` : '') +
    (invs.length - productDefects.length > 0 ? `${invs.length - productDefects.length} failure(s) attributed to automation or environment. ` : '') +
    `Verdict: ${verdict.replace(/_/g, ' ')}.`;

  return { reportId: newId('rpt'), ticketKey: analysis.ticketKey, generatedAt: now(), verdict, summary, metrics, defects, automationGaps, recurringIssues, recommendations, markdownPath: '', markdown: '' };
}

const round = (n) => Math.round(n * 1000) / 1000;

function toMarkdown(r, { analysis, execution, failureAnalysis, health }) {
  const lines = [
    `# QA Report — ${r.ticketKey}`,
    '',
    `**Verdict:** ${r.verdict.replace(/_/g, ' ').toUpperCase()}  `,
    `**Generated:** ${r.generatedAt}  `,
    health ? `**Environment:** ${health.environment} (${health.healthy ? 'healthy' : 'unhealthy'}, version ${health.version || 'n/a'})` : '',
    '',
    '## Summary',
    r.summary,
    '',
    '## Metrics',
    '| Requirements | Acceptance criteria | Tests generated | Executed | Passed | Failed | Pass rate | AC coverage |',
    '|---|---|---|---|---|---|---|---|',
    `| ${r.metrics.requirements} | ${r.metrics.acceptanceCriteria} | ${r.metrics.testsGenerated} | ${r.metrics.testsExecuted} | ${r.metrics.passed} | ${r.metrics.failed} | ${(r.metrics.passRate * 100).toFixed(0)}% | ${(r.metrics.acCoverage * 100).toFixed(0)}% |`,
    '',
  ];
  if (analysis.userStory) lines.push('## User story', `As a ${analysis.userStory.asA}, I want ${analysis.userStory.iWant}${analysis.userStory.soThat ? `, so that ${analysis.userStory.soThat}` : ''}.`, '');
  if (execution) {
    lines.push('## Test results', '| Test | Title | Status | Duration |', '|---|---|---|---|');
    execution.results.forEach((t) => lines.push(`| ${t.testId} | ${t.title} | ${t.status} | ${t.durationMs} ms |`));
    lines.push('');
  }
  if (failureAnalysis?.investigations.length) {
    lines.push('## Failure investigations');
    for (const i of failureAnalysis.investigations) {
      lines.push(`### ${i.testId} — ${i.category.replace(/_/g, ' ')} (${Math.round(i.confidence * 100)}% confidence)`, `**Root cause:** ${i.rootCause}`, '', '**Evidence**', ...i.evidence.map((e) => `- ${e}`));
      if (i.correlatedLogs.length) lines.push('', '**Correlated logs**', '```', ...i.correlatedLogs, '```');
      lines.push('', '**Suggested actions**', ...i.suggestedActions.map((a) => `- ${a}`), '');
    }
  }
  if (r.automationGaps.length) lines.push('## Automation gaps', ...r.automationGaps.map((g) => `- ${g}`), '');
  if (r.recurringIssues.length) lines.push('## Recurring issues', ...r.recurringIssues.map((g) => `- ${g}`), '');
  lines.push('## Recommendations', ...r.recommendations.map((g) => `- ${g}`), '');
  return lines.filter((l) => l !== null).join('\n');
}
