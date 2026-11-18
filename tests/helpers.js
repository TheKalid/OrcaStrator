import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventBus } from '../src/core/event-bus.js';
import { JsonStore } from '../src/core/store.js';
import { Logger } from '../src/core/logger.js';
import { ContextStore } from '../src/core/context-store.js';
import { TraceabilityGraph } from '../src/core/traceability.js';
import { AgentMetrics } from '../src/core/metrics.js';
import { ApprovalService } from '../src/core/approvals.js';
import { AgentRegistry } from '../src/core/registry.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { LLMClient } from '../src/llm/provider.js';
import { MockProvider } from '../src/llm/mock-provider.js';
import { loadConfig } from '../src/config.js';

process.env.ORCA_QUIET = 'true';

/** Orchestrator with in-temp-dir persistence and no external integrations. */
export function testOrchestrator(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-test-'));
  const config = loadConfig({ paths: { data: dir, workspace: dir }, orchestrator: { defaultRetries: 0 }, ...overrides });
  const bus = new EventBus();
  const store = new JsonStore(dir);
  return new Orchestrator({
    config, registry: new AgentRegistry(), bus, store,
    memory: new ContextStore(store, bus), trace: new TraceabilityGraph(store, bus), metrics: new AgentMetrics(store, bus),
    approvals: new ApprovalService(store, bus), logger: new Logger({ bus }),
    llm: new LLMClient(new MockProvider()), integrations: {}, tools: { list: () => [] },
  });
}
