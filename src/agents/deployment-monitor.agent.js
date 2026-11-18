import path from 'node:path';
import { z } from 'zod';
import { BaseAgent } from '../core/agent.js';
import { TestGenerationResult, ExecutionResult } from '../core/contracts.js';
import { newId } from '../core/util.js';

const HealthReport = z.object({
  environment: z.string(),
  baseUrl: z.string(),
  healthy: z.boolean(),
  version: z.string().nullable(),
  latencyMs: z.number(),
  error: z.string().nullable(),
  recentPipelines: z.array(z.object({ id: z.string(), name: z.string(), commit: z.string().nullable().optional(), conclusion: z.string().nullable(), startedAt: z.string().nullable() })),
  failingPipelines: z.number(),
});

/**
 * Deployment & Monitoring Agent
 * Watches CI/CD pipelines and environment health, and executes test suites
 * against the deployed application.
 */
export class DeploymentMonitorAgent extends BaseAgent {
  constructor() {
    super({
      id: 'deployment-monitor',
      name: 'Deployment & Monitoring Agent',
      description: 'Monitors CI/CD pipelines, deployments, test executions and application failures.',
      tags: ['ci', 'execution', 'monitoring'],
      concurrency: 2,
    });

    this.action('checkHealth', { input: z.object({ environment: z.string().optional() }), output: HealthReport, description: 'Environment and pipeline health' }, async (input, ctx) => {
      const { environments, ci } = ctx.integrations;
      const environment = input.environment || environments.active;
      const targetApp = environments.target(environment);
      const [health, pipelines] = await Promise.all([targetApp.health(), ci.listPipelines({ limit: 5 }).catch(() => [])]);
      const report = {
        environment,
        baseUrl: targetApp.baseUrl,
        healthy: health.ok,
        version: health.version,
        latencyMs: health.latencyMs,
        error: health.error || null,
        recentPipelines: pipelines.map((p) => ({ id: p.id, name: p.name, commit: p.commit, conclusion: p.conclusion, startedAt: p.startedAt })),
        failingPipelines: pipelines.filter((p) => p.conclusion === 'failure').length,
      };
      ctx.memory.run.set('health', report);
      ctx.log[health.ok ? 'info' : 'warn'](`${environment} ${health.ok ? 'healthy' : 'UNHEALTHY'} v${health.version || '?'} (${health.latencyMs}ms)`);
      return report;
    });

    this.action(
      'runTests',
      { input: z.object({ generation: TestGenerationResult, environment: z.string().optional() }), output: ExecutionResult, description: 'Execute a generated suite with Playwright' },
      ({ generation, environment }, ctx) =>
        execute(ctx, { ticketKey: generation.ticketKey, suiteDir: generation.suiteDir, environment, count: `${generation.tests.length} test(s)`, pipeline: { name: `orca / qa-${generation.ticketKey}`, message: `ORCA acceptance tests for ${generation.ticketKey}` } }),
    );

    this.action(
      'runSuite',
      {
        input: z.object({ suite: z.string().default('all'), filter: z.string().optional(), environment: z.string().optional() }),
        output: ExecutionResult,
        description: 'Run a suite (smoke, regression…) or a single test from the test library',
      },
      async ({ suite, filter, environment }, ctx) => {
        const { testLibrary, playwright } = ctx.integrations;
        const grep = filter ? null : await testLibrary.grepFor(suite);
        if (filter) testLibrary.resolve(filter.replace(/:\d+$/, ''));
        const label = filter ? filter : suite === 'all' ? 'all tests' : `${suite} suite`;
        const executionId = newId('exec');
        return execute(ctx, {
          executionId,
          ticketKey: filter ? filter.split('/').pop().replace(/\.spec\.\w+(:\d+)?$/, '') : suite === 'all' ? 'all' : suite,
          suite: filter ? 'single' : suite,
          suiteDir: testLibrary.dir,
          outDir: path.join(ctx.config.paths.workspace, 'suites', executionId),
          grep,
          filter,
          environment,
          count: `${label}${grep ? ` (--grep ${grep})` : ''}`,
          pipeline: { name: `orca / ${filter ? 'test' : suite}`, message: `OrcaStrator ${label}` },
          playwright,
        });
      },
    );
  }
}

/** Runs Playwright, keeps flakiness history, records traceability and the CI pipeline. */
async function execute(ctx, { executionId = newId('exec'), ticketKey, suite, suiteDir, outDir, grep, filter, environment: env, count, pipeline }) {
  const { playwright, environments, ci } = ctx.integrations;
  const environment = env || environments.active;
  const targetApp = environments.target(environment);
  const variables = environments.variables(environment);
  ctx.log.info(`Running ${count} with ${playwright.mode} against ${environment} (${targetApp.baseUrl}) with ${Object.keys(variables).length} environment variable(s)`);
  const run = await playwright.run({ suiteDir, outDir, grep, filter, baseUrl: targetApp.baseUrl, variables, signal: ctx.signal, log: ctx.log });

  const summary = { total: run.results.length, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  const history = ctx.memory.global.get('test.history', {});
  for (const r of run.results) {
    if (r.status === 'passed') summary.passed++;
    else if (r.status === 'skipped') summary.skipped++;
    else summary.failed++;
    const h = (history[r.testId] = [...(history[r.testId] || []), r.status].slice(-10));
    if (h.includes('passed') && h.some((s) => s === 'failed' || s === 'timedOut')) summary.flaky++;
  }
  ctx.memory.global.set('test.history', history);

  const execution = {
    executionId,
    ticketKey,
    ...(suite ? { suite } : {}),
    environment,
    baseUrl: targetApp.baseUrl,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: Date.parse(run.finishedAt) - Date.parse(run.startedAt),
    mode: run.mode,
    summary,
    results: run.results,
    rawReportPath: run.rawReportPath,
  };
  ctx.memory.run.set('execution', execution);
  if (!suite) {
    ctx.trace(
      run.results.map((r) => ({ id: `exec:${executionId}:${r.testId}`, type: 'execution', label: `${r.testId} ${r.status}`, data: { status: r.status, durationMs: r.durationMs, executionId, at: run.finishedAt, error: r.error?.message?.split('\n')[0] } })),
      run.results.map((r) => ({ from: `test:${r.testId}`, to: `exec:${executionId}:${r.testId}`, rel: 'executed_as' })),
    );
  }
  await ci.recordPipeline?.({
    name: pipeline.name,
    branch: 'main',
    commit: null,
    message: pipeline.message,
    status: 'completed',
    conclusion: summary.failed ? 'failure' : 'success',
    startedAt: run.startedAt,
    durationSec: Math.round(execution.durationMs / 1000),
  });
  ctx.log.info(`Execution ${executionId}: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped`);
  return execution;
}
