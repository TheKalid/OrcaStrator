import { TraceNode, TraceEdge } from './contracts.js';

/**
 * Traceability graph: Jira ticket -> requirements -> acceptance criteria ->
 * generated tests -> executions -> investigations -> defects / reports.
 */
export class TraceabilityGraph {
  constructor(store, bus) {
    this.store = store;
    this.bus = bus;
  }
  addNode(node, runId) {
    const n = TraceNode.parse(node);
    const existing = this.store.get('trace_nodes', n.id);
    const runs = new Set([...(existing?.runs || []), ...(runId ? [runId] : [])]);
    this.store.set('trace_nodes', n.id, { ...existing, ...n, data: { ...existing?.data, ...n.data }, runs: [...runs] });
  }
  addEdge(edge, runId) {
    const e = TraceEdge.parse(edge);
    const id = `${e.from}|${e.rel}|${e.to}`;
    const existing = this.store.get('trace_edges', id);
    const runs = new Set([...(existing?.runs || []), ...(runId ? [runId] : [])]);
    this.store.set('trace_edges', id, { ...e, id, runs: [...runs] });
  }
  record({ nodes = [], edges = [] } = {}, runId) {
    nodes.forEach((n) => this.addNode(n, runId));
    edges.forEach((e) => this.addEdge(e, runId));
    if (nodes.length || edges.length) this.bus?.publish('trace.updated', { runId, nodes: nodes.length, edges: edges.length });
  }
  /** Subgraph reachable (both directions) from a root node id, e.g. a ticket key. */
  subgraph(rootId) {
    const nodes = this.store.entries('trace_nodes');
    const edges = this.store.list('trace_edges');
    const seen = new Set([rootId]);
    const queue = [rootId];
    while (queue.length) {
      const id = queue.shift();
      for (const e of edges) {
        const next = e.from === id ? e.to : e.to === id && nodes[e.from]?.type !== 'ticket' ? e.from : null;
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    return {
      nodes: [...seen].map((id) => nodes[id]).filter(Boolean),
      edges: edges.filter((e) => seen.has(e.from) && seen.has(e.to)),
    };
  }
  forRun(runId) {
    return {
      nodes: this.store.list('trace_nodes').filter((n) => n.runs?.includes(runId)),
      edges: this.store.list('trace_edges').filter((e) => e.runs?.includes(runId)),
    };
  }
  /** Flattened matrix for the dashboard: one row per acceptance criterion. */
  matrix(ticketKey) {
    const g = this.subgraph(ticketKey);
    const byId = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    const out = (id, rel) => g.edges.filter((e) => e.from === id && (!rel || e.rel === rel)).map((e) => byId[e.to]).filter(Boolean);
    const rows = [];
    for (const req of out(ticketKey, 'derives')) {
      for (const ac of out(req.id, 'specifies')) {
        const tests = out(ac.id, 'verified_by');
        if (!tests.length) rows.push({ requirement: req, criterion: ac, test: null, execution: null, defects: [] });
        for (const test of tests) {
          const executions = out(test.id, 'executed_as');
          const execution = executions.sort((a, b) => String(b.data?.at).localeCompare(String(a.data?.at)))[0] || null;
          const defects = execution ? out(execution.id, 'investigated_by').flatMap((inv) => [inv, ...out(inv.id, 'reported_as')]) : [];
          rows.push({ requirement: req, criterion: ac, test, execution, defects });
        }
      }
    }
    return rows;
  }
}
