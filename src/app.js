import { loadConfig } from './config.js';
import { EventBus } from './core/event-bus.js';
import { JsonStore } from './core/store.js';
import { Logger } from './core/logger.js';
import { ContextStore } from './core/context-store.js';
import { TraceabilityGraph } from './core/traceability.js';
import { AgentMetrics } from './core/metrics.js';
import { ApprovalService } from './core/approvals.js';
import { AgentRegistry } from './core/registry.js';
import { Orchestrator } from './core/orchestrator.js';
import { createLLM } from './llm/provider.js';
import { createIntegrations } from './integrations/index.js';
import { McpToolHub } from './integrations/mcp.js';
import { createDefaultAgents } from './agents/index.js';
import { jiraToQaReport } from './workflows/jira-to-qa-report.js';
import { testSuite } from './workflows/test-suite.js';

/** Composition root: wires every component together. */
export async function createOrca(overrides = {}) {
  const config = loadConfig(overrides);
  const bus = new EventBus();
  const store = new JsonStore(config.paths.data);
  const logger = new Logger({ bus });
  // Keep an execution log per run for later inspection.
  bus.on('log', (entry) => {
    if (!entry.runId) return;
    const lines = store.get('run_logs', entry.runId) || [];
    lines.push(entry);
    store.set('run_logs', entry.runId, lines.slice(-1000));
  });
  const memory = new ContextStore(store, bus);
  const trace = new TraceabilityGraph(store, bus);
  const metrics = new AgentMetrics(store, bus);
  const approvals = new ApprovalService(store, bus);
  approvals.expireOrphans();
  markInterruptedRuns(store);

  const tools = new McpToolHub({ configFile: config.mcp.configFile, logger: logger.child({ component: 'mcp' }) });
  await tools.connectAll();

  const orchestrator = new Orchestrator({
    config, registry: new AgentRegistry(), bus, store, memory, trace, metrics, approvals, logger,
    llm: createLLM(config),
    integrations: createIntegrations(config, { store }),
    tools,
  });
  for (const agent of createDefaultAgents()) await orchestrator.registerAgent(agent);
  orchestrator.registerWorkflow(jiraToQaReport);
  orchestrator.registerWorkflow(testSuite);
  return orchestrator;
}

/** Runs left "running" by a crashed/stopped process are marked as failed on startup. */
function markInterruptedRuns(store) {
  for (const run of store.list('runs')) {
    if (['queued', 'running', 'waiting_approval'].includes(run.status)) {
      store.set('runs', run.id, { ...run, status: 'failed', error: { message: 'Interrupted: orchestrator restarted' }, finishedAt: run.finishedAt || new Date().toISOString() });
    }
  }
}

/** Jira monitoring loop: polls Jira and optionally auto-starts the QA workflow. */
export function startJiraMonitoring(orca) {
  const { jira } = orca.config;
  return orca.schedule('jira-monitor', jira.pollIntervalMs, async () => {
    const { changes } = await orca.dispatch({ agentId: 'jira-monitor', action: 'poll', input: {}, retries: 0 });
    if (!jira.autoTrigger) return;
    for (const c of changes) {
      if ((c.kind === 'status_changed' || c.kind === 'new') && c.to === jira.triggerStatus) {
        orca.logger.info(`Auto-triggering QA workflow for ${c.key} (${c.kind} → ${c.to})`);
        orca.startRun('jira-to-qa-report', { ticketKey: c.key }, { trigger: 'jira' });
      }
    }
  });
}
