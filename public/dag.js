import { html, raw, esc } from './lib.js';

const COLORS = {
  pending: ['var(--muted)', 'var(--panel-2)'],
  running: ['var(--info)', 'var(--info-bg)'],
  succeeded: ['var(--ok)', 'var(--ok-bg)'],
  failed: ['var(--err)', 'var(--err-bg)'],
  skipped: ['var(--muted)', 'var(--panel)'],
  waiting_approval: ['var(--warn)', 'var(--warn-bg)'],
  rejected: ['var(--purple)', 'var(--purple-bg)'],
  terminal: ['var(--border-2)', 'var(--panel-2)'],
};

const W = 200;
const H = 66;
const GAP_X = 46;
const GAP_Y = 14;
const PAD = 8;

/** Render a workflow graph as SVG, layered left→right by longest path; parallel branches stack vertically. */
export function renderDag(workflow, run) {
  const nodes = workflow.nodes;
  const edges = workflow.edges;
  const layer = { __start: 0 };
  // Longest-path layering (graph is a DAG, small: relax repeatedly).
  for (let k = 0; k < nodes.length; k++) {
    for (const e of edges) {
      if (layer[e.from] !== undefined) layer[e.to] = Math.max(layer[e.to] ?? 0, layer[e.from] + 1);
    }
  }
  const cols = [];
  for (const n of nodes) (cols[layer[n.id] ?? 0] ||= []).push(n);
  const maxRows = Math.max(...cols.map((c) => c.length));
  const height = maxRows * H + (maxRows - 1) * GAP_Y + PAD * 2;
  const pos = {};
  cols.forEach((col, ci) => {
    const colH = col.length * H + (col.length - 1) * GAP_Y;
    const y0 = (height - colH) / 2;
    col.forEach((n, ri) => {
      const w = n.kind === 'terminal' ? 70 : W;
      const x = PAD + cols.slice(0, ci).reduce((acc, c) => acc + (c[0].kind === 'terminal' ? 70 : W) + GAP_X, 0);
      pos[n.id] = { x, y: y0 + ri * (H + GAP_Y), w };
    });
  });
  const width = Math.max(...Object.values(pos).map((p) => p.x + p.w)) + PAD;
  const stepOf = (id) => run?.steps?.find((s) => s.id === id);

  const edgeSvg = edges
    .map((e) => {
      const a = pos[e.from];
      const b = pos[e.to];
      if (!a || !b) return '';
      const x1 = a.x + a.w;
      const y1 = a.y + H / 2;
      const x2 = b.x;
      const y2 = b.y + H / 2;
      const mx = (x1 + x2) / 2;
      return `<path class="edge" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2 - 4},${y2}" marker-end="url(#arrow)"/>`;
    })
    .join('');

  const nodeSvg = nodes
    .map((n) => {
      const p = pos[n.id];
      if (n.kind === 'terminal') {
        const st = n.id === '__end' && run ? (run.status === 'succeeded' ? 'succeeded' : run.status === 'failed' ? 'failed' : 'terminal') : n.id === '__start' && run ? 'succeeded' : 'terminal';
        const [stroke, fill] = COLORS[st];
        return `<g class="node"><rect x="${p.x}" y="${p.y + H / 2 - 16}" width="${p.w}" height="32" rx="8" fill="${fill}" stroke="${stroke}"/><text class="t1" x="${p.x + p.w / 2}" y="${p.y + H / 2 + 4}" text-anchor="middle">${esc(n.name)}</text></g>`;
      }
      const step = stepOf(n.id);
      const status = step?.status || 'pending';
      const [stroke, fill] = COLORS[status] || COLORS.pending;
      const badges = [n.conditional ? 'if' : '', n.approval ? 'approval' : ''].filter(Boolean).join(' · ');
      const detail = step?.error || step?.summary || (step ? status.replace(/_/g, ' ') : n.condition ? `when ${n.condition}` : '');
      const title = `${n.name} (${n.agent}.${n.action})\nstatus: ${status}${detail ? `\n${detail}` : ''}`;
      return `<g class="node"><title>${esc(title)}</title>
        <rect x="${p.x}" y="${p.y}" width="${p.w}" height="${H}" rx="8" fill="${fill}" stroke="${stroke}" ${status === 'skipped' ? 'stroke-dasharray="4 3"' : ''}/>
        <text class="t1" x="${p.x + 10}" y="${p.y + 19}">${esc(trunc(n.name, 24))}</text>
        <text class="t2" x="${p.x + 10}" y="${p.y + 35}">${esc(trunc(n.agent, 18))}${badges ? ` · ${esc(badges)}` : ''}</text>
        <text class="t3" x="${p.x + 10}" y="${p.y + 53}">${esc(trunc(detail, 32))}</text>
        <circle cx="${p.x + p.w - 12}" cy="${p.y + 14}" r="4" fill="${stroke}"/></g>`;
    })
    .join('');

  return html`<div class="dag-wrap"><svg class="dag" role="img" aria-label="${`Workflow graph ${workflow.name}`}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--border-2)"/></marker></defs>
    ${raw(edgeSvg)}${raw(nodeSvg)}
  </svg></div>`;
}

const trunc = (s, n) => {
  s = String(s || '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
};
