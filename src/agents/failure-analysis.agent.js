import { z } from 'zod';
import { BaseAgent } from '../core/agent.js';
import { ExecutionResult, TestGenerationResult, FailureAnalysisResult, Investigation } from '../core/contracts.js';
import { hash } from '../core/util.js';

const SYSTEM = `You are a senior QA engineer performing root-cause analysis of automated test failures.
Classify each failure as product_defect, automation_issue, environment_issue, test_data_issue or unknown.
Ground every claim in the evidence provided (error, test code, application logs, source excerpts). Be concise and specific.
Never claim certainty you do not have: calibrate confidence between 0 and 1.`;

/**
 * Failure Analysis Agent
 * Investigates failed tests, correlates errors with application logs, test code
 * and source code, classifies the probable root cause and proposes actions.
 */
export class FailureAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      id: 'failure-analysis',
      name: 'Failure Analysis Agent',
      description: 'Investigates failures, correlates logs and results, identifies probable root causes and suggests corrective actions.',
      tags: ['analysis', 'rca'],
    });

    this.action(
      'investigate',
      { input: z.object({ execution: ExecutionResult, generation: TestGenerationResult }), output: FailureAnalysisResult, description: 'Root-cause analysis of failed tests' },
      async ({ execution, generation }, ctx) => {
        const failures = execution.results.filter((r) => r.status === 'failed' || r.status === 'timedOut');
        const logs = await ctx.integrations.targetApp.logs({ since: execution.startedAt });
        const knownIds = (await ctx.integrations.codeContext.findTestIds().catch(() => [])).map((k) => k.id);
        const signatures = ctx.memory.global.get('failure.signatures', {});

        let investigations = [];
        for (const f of failures) {
          const test = generation.tests.find((t) => t.id === f.testId);
          investigations.push(heuristicInvestigation({ failure: f, test, logs, knownIds, ticketKey: execution.ticketKey }));
        }

        let source = 'heuristic';
        if (ctx.llm.available && investigations.length) {
          try {
            investigations = await this.#refineWithLlm(investigations, failures, generation, logs, ctx);
            source = 'llm';
          } catch (err) {
            ctx.log.warn(`LLM analysis failed, keeping heuristic results: ${err.message}`);
          }
        }

        // Recurrence tracking in shared long-term memory.
        for (const inv of investigations) {
          const prev = signatures[inv.signature];
          const now = execution.finishedAt;
          signatures[inv.signature] = { count: (prev?.count || 0) + 1, firstSeen: prev?.firstSeen || now, lastSeen: now, testId: inv.testId, ticketKey: execution.ticketKey, category: inv.category, rootCause: inv.rootCause };
          inv.occurrences = signatures[inv.signature].count;
          inv.recurring = inv.occurrences > 1;
        }
        ctx.memory.global.set('failure.signatures', signatures);

        const result = { ticketKey: execution.ticketKey, executionId: execution.executionId, investigations, source };
        ctx.memory.run.set('investigations', result);
        ctx.trace(
          investigations.map((i) => ({ id: `inv:${execution.executionId}:${i.testId}`, type: 'investigation', label: `${i.category}: ${i.rootCause.slice(0, 80)}`, data: { category: i.category, confidence: i.confidence, recurring: i.recurring } })),
          investigations.map((i) => ({ from: `exec:${execution.executionId}:${i.testId}`, to: `inv:${execution.executionId}:${i.testId}`, rel: 'investigated_by' })),
        );
        const byCat = investigations.reduce((m, i) => ({ ...m, [i.category]: (m[i.category] || 0) + 1 }), {});
        ctx.log.info(`Investigated ${investigations.length} failure(s): ${JSON.stringify(byCat)}`);
        return result;
      },
    );
  }

  async #refineWithLlm(investigations, failures, generation, logs, ctx) {
    const Refined = z.object({
      investigations: z.array(
        z.object({
          testId: z.string(),
          category: Investigation.shape.category,
          confidence: z.number(),
          rootCause: z.string(),
          suggestedActions: z.array(z.string()),
          defectSummary: z.string().nullable(),
        }),
      ),
    });
    const out = await ctx.llm.generateObject({
      system: SYSTEM,
      prompt: JSON.stringify(
        {
          failures: failures.map((f) => ({ testId: f.testId, title: f.title, error: f.error?.message?.slice(0, 2000) })),
          testCode: Object.fromEntries(generation.tests.filter((t) => failures.some((f) => f.testId === t.id)).map((t) => [t.id, t.code])),
          applicationLogs: logs.slice(-80),
          heuristicHypotheses: investigations.map(({ testId, category, confidence, rootCause, evidence }) => ({ testId, category, confidence, rootCause, evidence })),
        },
        null,
        2,
      ),
      schema: Refined,
    });
    return investigations.map((inv) => {
      const r = out.investigations.find((x) => x.testId === inv.testId);
      if (!r) return inv;
      return Investigation.parse({
        ...inv,
        category: r.category,
        confidence: Math.max(0, Math.min(1, r.confidence)),
        rootCause: r.rootCause,
        suggestedActions: r.suggestedActions,
        proposedDefect: r.category === 'product_defect' ? { ...(inv.proposedDefect || { description: inv.evidence.join('\n'), severity: 'high' }), summary: r.defectSummary || inv.proposedDefect?.summary || r.rootCause } : null,
      });
    });
  }
}

export function heuristicInvestigation({ failure, test, logs, knownIds, ticketKey }) {
  const msg = failure.error?.message || '';
  const firstLine = msg.split('\n').find((l) => l.trim()) || 'Unknown error';
  const expected = (msg.match(/^\s*Expected(?: [\w ]+)?:\s*(.+)$/m) || [])[1]?.trim();
  const received = (msg.match(/^\s*Received(?: [\w ]+)?:\s*(.+)$/m) || [])[1]?.trim();
  const locator = (msg.match(/getByTestId\('([^']+)'\)/) || [])[1];
  const evidence = [`Error: ${firstLine.trim()}`];
  if (expected !== undefined) evidence.push(`Expected: ${expected}`);
  if (received !== undefined) evidence.push(`Received: ${received}`);
  if (locator) evidence.push(`Locator: getByTestId('${locator}')`);
  (test?.warnings || []).forEach((w) => evidence.push(`Generator warning: ${w}`));

  const keywords = [locator, ...(test?.code.match(/'\/[a-z0-9/_-]+'/gi) || []).map((s) => s.replace(/'/g, '').split('/')[1])].filter(Boolean);
  // Only consider log lines emitted while this test was running (±500ms).
  const from = failure.startedAt ? Date.parse(failure.startedAt) - 500 : -Infinity;
  const to = failure.startedAt ? Date.parse(failure.startedAt) + failure.durationMs + 500 : Infinity;
  const correlatedLogs = logs
    .filter((l) => Date.parse(l.ts) >= from && Date.parse(l.ts) <= to)
    .filter((l) => l.level === 'warn' || l.level === 'error' || keywords.some((k) => l.msg.toLowerCase().includes(String(k).toLowerCase())))
    .map((l) => `${l.ts} ${l.level.toUpperCase()} ${l.msg}`)
    .slice(-8);

  let category = 'unknown';
  let confidence = 0.3;
  let rootCause = `Unclassified failure: ${firstLine.trim()}`;
  const actions = [];

  const elementMissing = /element\(s\) not found|waiting for getByTestId|locator resolved to 0|Timeout .* exceeded/i.test(msg) && (!received || /not found/i.test(received));
  if (/ECONNREFUSED|ERR_CONNECTION|net::ERR|getaddrinfo|socket hang up/i.test(msg)) {
    category = 'environment_issue';
    confidence = 0.9;
    rootCause = 'The application under test was unreachable during execution.';
    actions.push('Verify the target environment is deployed and healthy, then re-run the suite.', 'Add a pre-execution health gate to the pipeline.');
  } else if (elementMissing && locator) {
    const similar = knownIds.filter((k) => k.includes(locator) || locator.includes(k));
    const warned = (test?.warnings || []).some((w) => w.includes(`"${locator}"`));
    category = 'automation_issue';
    confidence = warned ? 0.9 : 0.55;
    rootCause = warned
      ? `Selector data-testid="${locator}" does not exist in the application; the test (or the acceptance criterion it came from) references the wrong element.`
      : `Element data-testid="${locator}" was not found on the page; it may have been renamed or not rendered.`;
    if (similar.length) {
      actions.push(`Use data-testid="${similar[0]}" which exists in the source, or align the acceptance criterion in ${ticketKey}.`);
      evidence.push(`Similar selectors in source: ${similar.join(', ')}`);
    }
    actions.push('Agree on stable data-testid naming between development and QA.');
    if (!warned) actions.push('Check whether the element is conditionally rendered (feature flag, permissions); if it should be visible this is a product defect.');
  } else if (expected !== undefined && received !== undefined) {
    category = 'product_defect';
    const logSupport = correlatedLogs.some((l) => / (WARN|ERROR) /.test(l));
    confidence = logSupport ? 0.88 : 0.75;
    rootCause = `The application returned ${received} where the acceptance criterion requires ${expected}.`;
    actions.push('Fix the application behavior to match the acceptance criterion.', 'Add a unit test covering this calculation/branch.');
    if (logSupport) evidence.push('Application logs around the failure contain warnings/errors (see correlated logs).');
  } else if (/Test timeout|exceeded while/i.test(msg)) {
    category = 'environment_issue';
    confidence = 0.45;
    rootCause = 'The test exceeded its timeout; the application may be slow or a navigation never completed.';
    actions.push('Check application latency and network conditions; consider raising the timeout only if justified.');
  }

  const signature = hash(`${category}|${failure.testId}|${expected ?? ''}|${received ?? ''}|${locator ?? ''}`);
  const severity = category === 'product_defect' ? (/total|price|payment|checkout|discount/i.test(`${failure.title} ${msg}`) ? 'critical' : 'high') : 'medium';

  return Investigation.parse({
    testId: failure.testId,
    title: failure.title,
    category,
    confidence,
    rootCause,
    evidence,
    correlatedLogs,
    suggestedActions: actions,
    signature,
    recurring: false,
    occurrences: 1,
    proposedDefect:
      category === 'product_defect'
        ? {
            summary: `${failure.title}: expected ${expected} but got ${received}`,
            severity,
            description: [
              `Acceptance test ${failure.testId} failed for ${ticketKey}.`,
              '',
              `Expected: ${expected}`,
              `Actual: ${received}`,
              '',
              'Steps (generated test):',
              ...(test?.code || '').split('\n').filter((l) => l.trim().startsWith('//')).map((l) => l.trim().replace(/^\/\/\s*/, '- ')),
              '',
              correlatedLogs.length ? `Application logs:\n${correlatedLogs.join('\n')}` : '',
            ].join('\n'),
          }
        : null,
  });
}
