import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { z } from 'zod';

/**
 * REST + Server-Sent Events API consumed by the dashboard.
 * Binds to localhost by default; set ORCA_API_TOKEN to require a bearer token.
 */
export function createApi(orca) {
  const app = express();
  const { config } = orca;
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });

  // Optional auth for every /api route (SSE passes ?token= because EventSource can't set headers).
  app.use('/api', (req, res, next) => {
    if (!config.server.apiToken) return next();
    const token = req.headers.authorization?.replace(/^Bearer /, '') || req.query.token;
    if (token === config.server.apiToken) return next();
    res.status(401).json({ error: 'Unauthorized' });
  });

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  // ----------------------------------------------------------------- system
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', name: 'ORCA', version: '0.1.0' }));

  app.get('/api/overview', wrap(async (_req, res) => {
    const runs = orca.store.list('runs');
    const finished = runs.filter((r) => r.finishedAt);
    const reports = orca.memory.get('global', 'reports.index', []);
    res.json({
      llm: orca.llm.describe(),
      integrations: {
        jira: orca.integrations.jira.mode,
        codeContext: orca.integrations.codeContext.mode,
        ci: orca.integrations.ci.mode,
        playwright: orca.integrations.playwright.mode,
        targetBaseUrl: orca.integrations.targetApp.baseUrl,
        environment: orca.integrations.environments.active,
        mcpServers: orca.tools.list().length,
      },
      runs: {
        total: runs.length,
        active: runs.filter((r) => ['queued', 'running', 'waiting_approval'].includes(r.status)).length,
        succeeded: runs.filter((r) => r.status === 'succeeded').length,
        failed: runs.filter((r) => r.status === 'failed').length,
        avgDurationMs: finished.length ? Math.round(finished.reduce((n, r) => n + (r.durationMs || 0), 0) / finished.length) : null,
      },
      approvalsPending: orca.approvals.list('pending').length,
      verdicts: reports.reduce((m, r) => ({ ...m, [r.verdict]: (m[r.verdict] || 0) + 1 }), {}),
      latestReports: reports.slice(0, 10),
      jiraMonitor: { enabled: orca.schedules.has('jira-monitor'), intervalMs: config.jira.pollIntervalMs, autoTrigger: config.jira.autoTrigger, triggerStatus: config.jira.triggerStatus },
    });
  }));

  // ----------------------------------------------------------------- agents
  app.get('/api/agents', (_req, res) => res.json(orca.listAgents()));

  // -------------------------------------------------------------- workflows
  app.get('/api/workflows', (_req, res) => res.json(orca.listWorkflows()));

  // ------------------------------------------------------------------- runs
  app.get('/api/runs', (req, res) => res.json(orca.listRuns({ limit: Number(req.query.limit) || 50, ticketKey: req.query.ticketKey })));

  app.get('/api/runs/:id', (req, res) => {
    const run = orca.getRun(req.params.id);
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(run);
  });

  app.post('/api/runs', wrap(async (req, res) => {
    const body = z.object({ workflowId: z.string().default('jira-to-qa-report'), input: z.record(z.string(), z.any()) }).parse(req.body);
    // Reject an unknown suite before a run is created.
    if (body.workflowId === 'test-suite' && !body.input.filter) await orca.integrations.testLibrary.grepFor(body.input.suite || 'all');
    const run = orca.startRun(body.workflowId, body.input, { trigger: 'api' });
    res.status(202).json({ id: run.id, status: run.status });
  }));

  /** Start the workflow for many tickets at once; the orchestrator runs them in parallel (bounded). */
  app.post('/api/runs/batch', wrap(async (req, res) => {
    const body = z.object({ ticketKeys: z.array(z.string()).optional(), status: z.string().optional(), environment: z.string().optional() }).parse(req.body || {});
    const keys = body.ticketKeys?.length ? body.ticketKeys : (await orca.integrations.jira.searchTickets({ statuses: [body.status || config.jira.triggerStatus] })).map((t) => t.key);
    const runs = keys.map((ticketKey) => orca.startRun('jira-to-qa-report', { ticketKey, environment: body.environment }, { trigger: 'batch' }));
    res.status(202).json(runs.map((r) => ({ id: r.id, ticketKey: r.label })));
  }));

  app.post('/api/runs/:id/cancel', wrap(async (req, res) => {
    orca.cancelRun(req.params.id);
    res.json({ ok: true });
  }));

  app.get('/api/runs/:id/logs', (req, res) => res.json(orca.store.get('run_logs', req.params.id) || []));

  app.get('/api/runs/:id/report', (req, res) => {
    const run = orca.getRun(req.params.id);
    const report = run?.outputs?.['qa-report'];
    if (!report) return res.status(404).json({ error: 'No report for this run' });
    res.json(report);
  });

  /** Generated test source files of a run (read-only, path-confined to the run workspace). */
  app.get('/api/runs/:id/files/:file', (req, res) => {
    const dir = path.join(config.paths.workspace, 'runs', path.basename(req.params.id), 'tests');
    const file = path.join(dir, path.basename(req.params.file));
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found' });
    res.type('text/plain').send(fs.readFileSync(file, 'utf8'));
  });

  // -------------------------------------------------------------- approvals
  app.get('/api/approvals', (req, res) => res.json(orca.approvals.list(req.query.status)));
  app.post('/api/approvals/:id', wrap(async (req, res) => {
    const body = z.object({ approved: z.boolean(), comment: z.string().max(2000).optional(), decidedBy: z.string().max(100).optional() }).parse(req.body);
    res.json(orca.approvals.decide(req.params.id, { approved: body.approved, comment: body.comment || null, decidedBy: body.decidedBy || 'dashboard-user' }));
  }));

  // ------------------------------------------------------------------- jira
  app.get('/api/jira/tickets', wrap(async (req, res) => {
    const tickets = await orca.integrations.jira.searchTickets({ statuses: req.query.status ? [req.query.status] : undefined, maxResults: 100 });
    const runs = orca.store.list('runs');
    res.json(
      tickets.map((t) => {
        const last = runs.filter((r) => r.input?.ticketKey === t.key).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return { ...t, lastRun: last ? { id: last.id, status: last.status, verdict: last.output?.verdict || null, at: last.createdAt } : null };
      }),
    );
  }));
  app.get('/api/jira/tickets/:key', wrap(async (req, res) => res.json(await orca.integrations.jira.getTicket(req.params.key))));
  app.post('/api/jira/poll', wrap(async (_req, res) => res.json(await orca.dispatch({ agentId: 'jira-monitor', action: 'poll', input: {}, retries: 0 }))));
  app.post('/api/jira/simulate', wrap(async (_req, res) => {
    if (!orca.integrations.jira.simulateActivity) return res.status(400).json({ error: 'Simulation is only available with JIRA_MODE=mock' });
    res.json(await orca.integrations.jira.simulateActivity());
  }));

  // ----------------------------------------------------- tests & deployments
  app.get('/api/executions', (_req, res) => {
    const executions = orca.store
      .list('runs')
      .filter((r) => r.outputs?.['execute-tests'])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((r) => ({ runId: r.id, ...r.outputs['execute-tests'] }));
    res.json(executions);
  });

  // ----------------------------------------------------------- test library
  /** Catalog of the Playwright test library, with each test's latest result from suite runs. */
  app.get('/api/test-library', wrap(async (_req, res) => {
    const catalog = await orca.integrations.testLibrary.catalog();
    const latest = new Map();
    const suiteRuns = orca.store
      .list('runs')
      .filter((r) => r.workflowId === 'test-suite' && r.outputs?.['execute-tests'])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const r of suiteRuns) {
      for (const t of r.outputs['execute-tests'].results) {
        const key = `${t.file}::${t.title}`;
        if (!latest.has(key)) latest.set(key, { status: t.status, at: r.outputs['execute-tests'].finishedAt, runId: r.id, error: t.error?.message?.split('\n')[0] || null });
      }
    }
    const lastSuiteRun = (name) => {
      const r = suiteRuns.find((x) => x.input?.suite === name && !x.input?.filter);
      return r ? { runId: r.id, at: r.outputs['execute-tests'].finishedAt, environment: r.input.environment, summary: r.outputs['execute-tests'].summary } : null;
    };
    res.json({
      ...catalog,
      dir: path.relative(config.paths.root, catalog.dir) || '.',
      suites: [{ name: 'all', tag: null, description: 'Every test in the library', count: catalog.tests.length }, ...catalog.suites].map((s) => ({ ...s, lastRun: lastSuiteRun(s.name) })),
      tests: catalog.tests.map((t) => ({ ...t, last: latest.get(`${t.file}::${t.title}`) || null })),
    });
  }));

  app.get('/api/test-library/source', (req, res) => {
    const file = String(req.query.file || '');
    if (!/\.spec\.(mjs|js|ts)$/.test(file)) return res.status(400).json({ error: 'Not a spec file' });
    try {
      res.type('text/plain').send(orca.integrations.testLibrary.read(file));
    } catch (err) {
      res.status(err.status || 404).json({ error: err.status ? err.message : 'File not found' });
    }
  });

  // ------------------------------------------------------------ environments
  /** Environments with masked variables. Secret values never leave the server. */
  app.get('/api/environments', (_req, res) => res.json(orca.integrations.environments.describe()));

  app.put('/api/environments/active', wrap(async (req, res) => {
    const { name } = z.object({ name: z.string() }).parse(req.body || {});
    orca.integrations.environments.setActive(name);
    orca.bus.publish('environment.changed', { name });
    orca.logger.info(`Active test environment set to ${name}`);
    res.json(orca.integrations.environments.describe());
  }));

  app.get('/api/deployments', wrap(async (_req, res) => {
    const [deployments, pipelines] = await Promise.all([orca.integrations.ci.listDeployments(), orca.integrations.ci.listPipelines({ limit: 20 })]);
    res.json({ deployments, pipelines });
  }));

  // ---------------------------------------------- investigations & insights
  app.get('/api/investigations', (_req, res) => {
    const items = orca.store
      .list('runs')
      .filter((r) => r.outputs?.['analyze-failures'])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .flatMap((r) => r.outputs['analyze-failures'].investigations.map((i) => ({ runId: r.id, ticketKey: r.input.ticketKey, executionId: r.outputs['analyze-failures'].executionId, at: r.finishedAt || r.createdAt, ...i })));
    res.json(items);
  });

  app.get('/api/insights', wrap(async (_req, res) => res.json(await orca.dispatch({ agentId: 'reporting', action: 'insights', input: {}, retries: 0 }))));

  // ----------------------------------------------------------- traceability
  app.get('/api/trace/:ticketKey', (req, res) => res.json({ graph: orca.trace.subgraph(req.params.ticketKey), matrix: orca.trace.matrix(req.params.ticketKey) }));

  // ------------------------------------------------------- memory & tools
  app.get('/api/memory', (req, res) => res.json(orca.memory.list(req.query.scope).map((e) => ({ ...e, value: truncate(e.value) }))));
  app.get('/api/tools', (_req, res) => res.json(orca.tools.list()));

  // ------------------------------------------------------------------ events
  app.get('/api/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
    const onLog = (entry) => send({ type: 'log', ts: entry.ts, payload: entry });
    orca.bus.on('event', send);
    orca.bus.on('log', onLog);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      orca.bus.off('event', send);
      orca.bus.off('log', onLog);
    });
  });

  // ------------------------------------------------------------- dashboard
  app.use(express.static(config.paths.public));

  app.use((err, _req, res, _next) => {
    if (err.name === 'ZodError') return res.status(400).json({ error: 'Invalid request', issues: err.issues });
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

function truncate(value) {
  const s = JSON.stringify(value);
  return s && s.length > 4000 ? `${s.slice(0, 4000)}… (${s.length} chars)` : value;
}
