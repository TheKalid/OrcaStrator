import { html, raw, api, ago, dur, pct, clock, firstLine, pill, toast, openDrawer, closeDrawer, empty, errorBox, panel, markdown } from './lib.js';
import { renderDag } from './dag.js';

// ------------------------------------------------------------------ state
const state = {
  feed: [], // recent events for the overview feed
  workflows: null,
  runLogs: [], // live log lines for the open run
  pendingApprovals: 0,
  runDetailTab: 'logs',
  selectedFile: null,
};
const view = document.getElementById('view');
const titleEl = document.getElementById('page-title');
const topRight = document.getElementById('topbar-right');

// ----------------------------------------------------------------- router
const ROUTES = {
  overview: { title: 'Overview', render: renderOverview, live: /^(run\.|step\.|agent\.|approval\.|task\.)/ },
  jira: { title: 'Jira tickets', render: renderJira, live: /^(run\.(succeeded|failed|queued|cancelled)|jira\.change)/ },
  runs: { title: 'Workflows & runs', render: renderRuns, live: /^(run\.|step\.)/ },
  tests: { title: 'Test results', render: renderTests, live: /^run\.(succeeded|failed)/ },
  deployments: { title: 'Deployments', render: renderDeployments, live: /^run\.(succeeded|failed)/ },
  investigations: { title: 'Investigations', render: renderInvestigations, live: /^run\.(succeeded|failed)/ },
  approvals: { title: 'Approvals', render: renderApprovals, live: /^approval\./ },
  trace: { title: 'Traceability', render: renderTrace, live: /^trace\.updated/ },
  reports: { title: 'Reports', render: renderReports, live: /^run\.(succeeded|failed)/ },
};

function parseRoute() {
  const [name = 'overview', ...params] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  return { name: ROUTES[name] ? name : 'overview', params };
}

let renderSeq = 0;
async function renderRoute({ soft = false } = {}) {
  const { name, params } = parseRoute();
  const route = ROUTES[name];
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
  titleEl.textContent = route.title;
  document.title = `${route.title} · ORCA Console`;
  const seq = ++renderSeq;
  if (!soft) {
    view.innerHTML = String(html`<div class="empty">Loading…</div>`);
    topRight.innerHTML = '';
  }
  try {
    const out = await route.render(params, { soft });
    if (seq !== renderSeq || out === undefined) return;
    const scroll = soft ? captureScroll() : null;
    view.innerHTML = String(out);
    if (scroll) restoreScroll(scroll);
    afterRender();
  } catch (err) {
    if (seq === renderSeq) view.innerHTML = String(errorBox(err));
  }
}

function captureScroll() {
  return [...view.querySelectorAll('[data-keep-scroll]')].map((el) => [el.dataset.keepScroll, el.scrollTop, el.scrollHeight - el.scrollTop - el.clientHeight < 20]);
}
function restoreScroll(saved) {
  for (const [key, top, atBottom] of saved) {
    const el = view.querySelector(`[data-keep-scroll="${key}"]`);
    if (el) el.scrollTop = atBottom ? el.scrollHeight : top;
  }
}
function afterRender() {
  view.querySelectorAll('[data-keep-scroll="logs"]').forEach((el) => {
    if (!el.dataset.scrolled) {
      el.scrollTop = el.scrollHeight;
      el.dataset.scrolled = '1';
    }
  });
}

window.addEventListener('hashchange', () => {
  state.selectedFile = null;
  closeDrawer();
  document.getElementById('sidebar').classList.remove('open');
  renderRoute();
  view.focus({ preventScroll: true });
});

// ------------------------------------------------------------------- live
let refreshTimer = null;
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    // Don't clobber a half-written approval comment.
    const active = document.activeElement;
    if (active && (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT' || active.tagName === 'SELECT') && view.contains(active)) return;
    renderRoute({ soft: true });
  }, 350);
}

function connectEvents() {
  const conn = document.getElementById('conn');
  const es = new EventSource('/api/events');
  es.onopen = () => {
    conn.dataset.state = 'live';
    conn.textContent = 'live';
  };
  es.onerror = () => {
    conn.dataset.state = 'down';
    conn.textContent = 'reconnecting…';
  };
  es.onmessage = (msg) => {
    let ev;
    try {
      ev = JSON.parse(msg.data);
    } catch {
      return;
    }
    onEvent(ev);
  };
}

function onEvent(ev) {
  const { name, params } = parseRoute();
  if (ev.type === 'log') {
    const entry = ev.payload;
    if (entry.level === 'warn' || entry.level === 'error') pushFeed(ev);
    if (name === 'runs' && params[0] && entry.runId === params[0]) appendLiveLog(entry);
    return;
  }
  if (ev.type !== 'memory.updated' && ev.type !== 'task.started' && ev.type !== 'task.finished') pushFeed(ev);
  if (ev.type.startsWith('approval.')) refreshApprovalBadge();
  if (ev.type === 'approval.requested') toast(`Approval required: ${ev.payload.title}`);
  if (ev.type === 'run.succeeded' || ev.type === 'run.failed') toast(`${ev.payload.label}: run ${ev.payload.status}`, ev.type === 'run.failed' ? 'err' : 'ok');
  const route = ROUTES[name];
  if (route.live?.test(ev.type)) scheduleRefresh();
}

function pushFeed(ev) {
  state.feed.unshift(ev);
  state.feed.length = Math.min(state.feed.length, 150);
}

function appendLiveLog(entry) {
  const box = view.querySelector('[data-keep-scroll="logs"]');
  if (!box) return;
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
  box.querySelector('.empty')?.remove();
  box.insertAdjacentHTML('beforeend', String(logLine(entry)));
  if (atBottom) box.scrollTop = box.scrollHeight;
}

async function refreshApprovalBadge() {
  try {
    const pending = await api('/approvals?status=pending');
    state.pendingApprovals = pending.length;
    const badge = document.getElementById('approval-badge');
    badge.textContent = pending.length;
    badge.hidden = pending.length === 0;
  } catch {
    /* ignore */
  }
}

// --------------------------------------------------------------- actions
const ACTIONS = {
  async 'run-ticket'(el) {
    const ticketKey = el.dataset.key;
    el.disabled = true;
    const run = await api('/runs', { method: 'POST', body: { workflowId: 'jira-to-qa-report', input: { ticketKey } } });
    toast(`Started QA workflow for ${ticketKey}`, 'ok');
    location.hash = `#/runs/${run.id}`;
  },
  async 'run-batch'(el) {
    el.disabled = true;
    const runs = await api('/runs/batch', { method: 'POST', body: {} });
    toast(`Started ${runs.length} run(s) in parallel`, 'ok');
    location.hash = '#/runs';
  },
  async 'jira-poll'(el) {
    el.disabled = true;
    const res = await api('/jira/poll', { method: 'POST' });
    toast(`Scanned ${res.scanned} tickets · ${res.changes.length} change(s)`);
    el.disabled = false;
    renderRoute({ soft: true });
  },
  async 'jira-simulate'(el) {
    el.disabled = true;
    const res = await api('/jira/simulate', { method: 'POST' });
    toast(`Simulated: ${res.key} ${res.change}. Poll to detect it.`);
    el.disabled = false;
    renderRoute({ soft: true });
  },
  async 'ticket-detail'(el) {
    const t = await api(`/jira/tickets/${encodeURIComponent(el.dataset.key)}`);
    openDrawer(
      `${t.key} · ${t.summary}`,
      html`<div class="row">${pill(t.status === 'Ready for QA' ? 'running' : 'idle', t.status)} <span class="pill">${t.type}</span> <span class="pill">${t.priority}</span> ${t.labels.map((l) => html`<span class="pill">${l}</span>`)}</div>
        <div><div class="k">Assignee</div>${t.assignee || '—'} · updated ${ago(t.updated)}</div>
        <div><div class="k">Description</div><div class="prewrap">${t.description || '—'}</div></div>
        <div><div class="k">Acceptance criteria</div>${t.acceptanceCriteria ? html`<pre class="code">${t.acceptanceCriteria}</pre>` : html`<span class="muted">None provided</span>`}</div>
        <div><div class="k">Comments (${t.comments.length})</div>${t.comments.length ? t.comments.map((c) => html`<div class="small"><b>${c.author}</b> <span class="muted">${ago(c.created)}</span><div class="prewrap">${c.body}</div></div>`) : html`<span class="muted">No comments</span>`}</div>
        <div class="row"><button class="btn primary" data-action="run-ticket" data-key="${t.key}">Run QA workflow</button><a class="btn" href="#/trace/${encodeURIComponent(t.key)}">Traceability</a></div>`,
    );
  },
  async 'cancel-run'(el) {
    if (!confirm('Cancel this run?')) return;
    el.disabled = true;
    await api(`/runs/${el.dataset.id}/cancel`, { method: 'POST' });
    toast('Run cancelled');
  },
  async decide(el) {
    const id = el.dataset.id;
    const approved = el.dataset.approved === 'true';
    const comment = view.querySelector(`textarea[data-comment="${id}"]`)?.value || undefined;
    el.closest('.approval').querySelectorAll('button').forEach((b) => (b.disabled = true));
    await api(`/approvals/${id}`, { method: 'POST', body: { approved, comment } });
    toast(approved ? 'Approved — the workflow continues' : 'Rejected', approved ? 'ok' : '');
    renderRoute({ soft: true });
  },
  'run-tab'(el) {
    state.runDetailTab = el.dataset.tab;
    renderRoute({ soft: true });
  },
  'open-file'(el) {
    state.selectedFile = el.dataset.file;
    state.runDetailTab = 'files';
    renderRoute({ soft: true });
  },
};

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) {
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a,button')) location.hash = row.dataset.href;
    return;
  }
  e.preventDefault();
  try {
    await ACTIONS[el.dataset.action]?.(el);
  } catch (err) {
    toast(err.message, 'err');
    el.disabled = false;
  }
});
document.addEventListener('keydown', (e) => {
  const row = e.target.closest?.('tr[data-href]');
  if (row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    location.hash = row.dataset.href;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'trace-ticket') location.hash = `#/trace/${encodeURIComponent(e.target.value)}`;
  if (e.target.id === 'report-run') location.hash = `#/reports/${encodeURIComponent(e.target.value)}`;
});
document.getElementById('menu-open').addEventListener('click', () => document.getElementById('sidebar').classList.add('open'));
document.getElementById('menu-close').addEventListener('click', () => document.getElementById('sidebar').classList.remove('open'));

const setTopbar = (h) => {
  topRight.innerHTML = String(h);
};

// ------------------------------------------------------------------ views
async function renderOverview() {
  const [ov, agents, runs] = await Promise.all([api('/overview'), api('/agents'), api('/runs?limit=8')]);
  setTopbar(html`<button class="btn primary" data-action="run-batch">Run all “${ov.jiraMonitor.triggerStatus}”</button>`);
  const v = ov.verdicts || {};
  const kpis = [
    ['Total runs', ov.runs.total, `${ov.runs.succeeded} ok · ${ov.runs.failed} failed`],
    ['Active runs', ov.runs.active, ov.runs.avgDurationMs ? `avg ${dur(ov.runs.avgDurationMs)}` : 'no runs yet', ov.runs.active ? 'warn' : ''],
    ['Pending approvals', ov.approvalsPending, 'human in the loop', ov.approvalsPending ? 'warn' : ''],
    ['Ready for release', v.ready_for_release || 0, 'QA verdicts', 'ok'],
    ['Needs attention', v.needs_attention || 0, 'QA verdicts', v.needs_attention ? 'warn' : ''],
    ['Blocked', v.blocked || 0, 'QA verdicts', v.blocked ? 'err' : ''],
  ];
  const integ = ov.integrations;
  return html`
    <div class="grid kpis">${kpis.map(([l, val, hint, tone]) => html`<div class="kpi ${tone || ''}"><div class="label">${l}</div><div class="value">${val}</div><div class="hint">${hint}</div></div>`)}</div>
    <div class="panel"><div class="panel-body row small">
      <span class="muted">LLM</span> ${pill(ov.llm.available ? 'connected' : 'idle', `${ov.llm.provider}${ov.llm.model ? ` · ${ov.llm.model}` : ''}`)}
      <span class="muted">Jira</span> ${pill(integ.jira === 'mock' ? 'idle' : 'connected', integ.jira)}
      <span class="muted">Code</span> ${pill('idle', integ.codeContext)}
      <span class="muted">CI</span> ${pill('idle', integ.ci)}
      <span class="muted">Runner</span> ${pill(integ.playwright === 'playwright' ? 'connected' : 'warn', integ.playwright)}
      <span class="muted">MCP servers</span> <span class="pill">${integ.mcpServers}</span>
      <span class="muted">Jira monitor</span> ${pill(ov.jiraMonitor.enabled ? 'connected' : 'idle', ov.jiraMonitor.enabled ? `every ${dur(ov.jiraMonitor.intervalMs)}${ov.jiraMonitor.autoTrigger ? ' · auto-trigger' : ''}` : 'off')}
    </div></div>
    ${panel('Agents', html`<div class="grid agents">${agents.map(agentCard)}</div>`, { sub: `${agents.length} registered · live status` })}
    <div class="grid two">
      ${panel('Recent runs', runsTable(runs), { flush: true, actions: html`<a class="small" href="#/runs">All runs →</a>` })}
      ${panel('Live event feed', feedList(), { flush: true, sub: 'orchestrator events via SSE' })}
    </div>`;
}

function agentCard(a) {
  const m = a.metrics;
  return html`<div class="agent ${a.status}">
    <div class="top"><div><div class="name">${a.name}</div><div class="mono muted small">${a.id}</div></div>${pill(a.status)}</div>
    <div class="desc">${a.description}</div>
    <div class="stats">
      <div><b>${m.invocations}</b>tasks</div>
      <div><b>${pct(m.successRate)}</b>success</div>
      <div><b>${dur(m.avgDurationMs)}</b>avg time</div>
    </div>
    ${a.currentTask ? html`<div class="current">▶ ${a.currentTask.action} · ${a.currentTask.runId || 'ad-hoc'}</div>` : a.queued ? html`<div class="current">${a.queued} queued</div>` : ''}
    ${m.lastError && a.status === 'error' ? html`<div class="small err-text ellipsis" title="${m.lastError}">${m.lastError}</div>` : ''}
    <div class="small muted">${a.actions.map((x) => x.name + (x.sensitive ? ' 🔒' : '')).join(' · ')} · last ${ago(m.lastRunAt)}</div>
  </div>`;
}

function feedList() {
  if (!state.feed.length) return empty('Waiting for events… start a run to see agents coordinate.');
  return html`<div class="feed" data-keep-scroll="feed">${state.feed.slice(0, 60).map((ev) => {
    const p = ev.payload || {};
    let text;
    if (ev.type === 'log') text = `${p.agentId || ''} ${p.message}`;
    else if (ev.type.startsWith('step.')) text = `${p.label} · ${p.step?.name || ''}${p.step?.summary ? ` — ${p.step.summary}` : ''}${p.step?.error ? ` — ${p.step.error}` : ''}`;
    else if (ev.type.startsWith('run.')) text = `${p.label} (${p.workflowId}) → ${p.status}`;
    else if (ev.type === 'agent.status') text = `${p.agentId} → ${p.status}${p.currentTask ? ` (${p.currentTask.action})` : ''}`;
    else if (ev.type.startsWith('approval.')) text = `${p.title} → ${p.status}`;
    else if (ev.type === 'jira.change') text = `${p.key} ${p.kind}${p.to ? ` → ${p.to}` : ''}`;
    else text = JSON.stringify(p).slice(0, 140);
    return html`<div class="feed-item"><span class="t">${clock(ev.ts)}</span><span><span class="ty">${ev.type === 'log' ? p.level : ev.type}</span>${text}</span></div>`;
  })}</div>`;
}

function runsTable(runs) {
  if (!runs.length) return empty('No runs yet. Start one from the Jira view.');
  return html`<div class="table-wrap"><table>
    <thead><tr><th>Ticket</th><th>Status</th><th>Verdict</th><th class="hide-sm">Trigger</th><th class="hide-sm">Duration</th><th>Started</th></tr></thead>
    <tbody>${runs.map((r) => html`<tr class="clickable" tabindex="0" data-href="#/runs/${r.id}">
      <td><a href="#/runs/${r.id}" class="mono">${r.label}</a></td>
      <td>${pill(r.status)}</td>
      <td>${r.output?.verdict ? pill(r.output.verdict) : html`<span class="muted">—</span>`}</td>
      <td class="hide-sm muted">${r.trigger}</td>
      <td class="hide-sm">${dur(r.durationMs)}</td>
      <td class="muted">${ago(r.createdAt)}</td></tr>`)}</tbody></table></div>`;
}

async function renderJira() {
  const tickets = await api('/jira/tickets');
  setTopbar(html`<button class="btn" data-action="jira-simulate">Simulate Jira activity</button><button class="btn" data-action="jira-poll">Poll Jira now</button><button class="btn primary" data-action="run-batch">Run all “Ready for QA”</button>`);
  const body = tickets.length
    ? html`<div class="table-wrap"><table>
      <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th class="hide-sm">Type</th><th class="hide-sm">Priority</th><th>Last run</th><th></th></tr></thead>
      <tbody>${tickets.map((t) => html`<tr>
        <td><button class="btn sm mono" data-action="ticket-detail" data-key="${t.key}" aria-label="${`Open ${t.key} details`}">${t.key}</button></td>
        <td class="ellipsis" title="${t.summary}">${t.summary}</td>
        <td>${pill(t.status === 'Ready for QA' ? 'running' : t.type === 'Bug' ? 'failed' : 'idle', t.status)}</td>
        <td class="hide-sm muted">${t.type}</td>
        <td class="hide-sm">${t.priority}</td>
        <td>${t.lastRun ? html`<a href="#/runs/${t.lastRun.id}">${t.lastRun.verdict ? pill(t.lastRun.verdict) : pill(t.lastRun.status)}</a> <span class="muted small">${ago(t.lastRun.at)}</span>` : html`<span class="muted">never</span>`}</td>
        <td>${t.type === 'Bug' ? '' : html`<button class="btn sm primary" data-action="run-ticket" data-key="${t.key}">Run QA</button>`}</td>
      </tr>`)}</tbody></table></div>`
    : empty('No tickets found.');
  return panel('Tickets', body, { flush: true, sub: `${tickets.length} tickets · monitored by the Jira Monitoring Agent` });
}

async function getWorkflows() {
  state.workflows ||= await api('/workflows');
  return state.workflows;
}

async function renderRuns(params) {
  if (params[0]) return renderRunDetail(params[0]);
  const [runs, workflows] = await Promise.all([api('/runs?limit=100'), getWorkflows()]);
  setTopbar(html`<a class="btn" href="#/jira">Start from a ticket</a>`);
  return html`${workflows.map((w) => panel(w.name, renderDag(w, null), { sub: w.description }))}
    ${panel('Runs', runsTable(runs), { flush: true, sub: `${runs.length} most recent` })}`;
}

async function renderRunDetail(id) {
  const [run, workflows, logs] = await Promise.all([api(`/runs/${id}`), getWorkflows(), api(`/runs/${id}/logs`)]);
  const wf = workflows.find((w) => w.id === run.workflowId);
  const active = ['queued', 'running', 'waiting_approval'].includes(run.status);
  setTopbar(html`${active ? html`<button class="btn danger" data-action="cancel-run" data-id="${run.id}">Cancel run</button>` : ''}
    ${run.outputs?.['qa-report'] ? html`<a class="btn" href="#/reports/${run.id}">QA report</a>` : ''}
    <a class="btn" href="#/trace/${encodeURIComponent(run.input?.ticketKey || '')}">Traceability</a>`);
  titleEl.textContent = `Run · ${run.label}`;

  const header = html`<div class="panel"><div class="panel-body row between">
    <div class="row"><span class="mono">${run.id}</span>${pill(run.status)}${run.output?.verdict ? pill(run.output.verdict) : ''}</div>
    <div class="row small muted"><span>${run.workflowName}</span><span>trigger: ${run.trigger}</span><span>started ${ago(run.startedAt || run.createdAt)}</span><span>duration ${dur(run.durationMs ?? (run.startedAt ? Date.now() - Date.parse(run.startedAt) : null))}</span></div>
  </div>${run.error ? html`<div class="panel-body"><div class="error-box">${run.error.stepId ? `${run.error.stepId}: ` : ''}${run.error.message}</div></div>` : ''}</div>`;

  const steps = run.steps.filter((s) => s.kind === 'task' || s.kind === 'parallel');
  const timeline = html`<div class="timeline">${steps.map((s) => html`<div class="step ${s.parentId ? 'child' : ''}">
    <span class="dot ${s.status}" aria-hidden="true"></span>
    <div><div class="row"><b>${s.name}</b>${s.agent ? html`<span class="mono muted small">${s.agent}.${s.action}</span>` : html`<span class="muted small">parallel group</span>`}${pill(s.status)}${s.attempts > 1 ? html`<span class="pill warn">${s.attempts} attempts</span>` : ''}</div>
      ${s.summary ? html`<div class="small muted">${s.summary}</div>` : ''}
      ${s.error ? html`<div class="small err-text">${s.error}</div>` : ''}
      ${s.approval ? html`<div class="small">Approval ${s.approval.status} by ${s.approval.decidedBy || '—'}${s.approval.comment ? ` — “${s.approval.comment}”` : ''}</div>` : ''}
      ${s.status === 'waiting_approval' ? html`<div class="small"><a href="#/approvals">Review pending approval →</a></div>` : ''}</div>
    <div class="small muted">${s.startedAt && s.finishedAt ? dur(Date.parse(s.finishedAt) - Date.parse(s.startedAt)) : s.status === 'running' ? 'running…' : ''}</div>
  </div>`)}</div>`;

  const files = run.outputs?.['generate-tests']?.files || [];
  const tab = state.runDetailTab;
  let tabBody;
  if (tab === 'files') {
    const file = state.selectedFile && files.includes(state.selectedFile) ? state.selectedFile : files[0];
    let code = '';
    if (file) {
      try {
        code = await api(`/runs/${run.id}/files/${encodeURIComponent(file)}`);
      } catch (err) {
        code = `// ${err.message}`;
      }
    }
    tabBody = files.length
      ? html`<div class="panel-body stack"><div class="row">${files.map((f) => html`<button class="btn sm ${f === file ? 'primary' : ''}" data-action="open-file" data-file="${f}">${f}</button>`)}</div><pre class="code">${code}</pre></div>`
      : empty('No generated test files for this run.');
  } else if (tab === 'output') {
    tabBody = html`<div class="panel-body"><pre class="code">${JSON.stringify({ input: run.input, output: run.output }, null, 2)}</pre></div>`;
  } else {
    tabBody = html`<div class="logs" data-keep-scroll="logs">${logs.length ? logs.map(logLine) : empty('No logs yet.')}</div>`;
  }

  return html`${header}
    ${wf ? panel('Workflow', renderDag(wf, run), { flush: true, sub: 'live step status · hover nodes for details' }) : ''}
    <div class="grid two">
      ${panel('Steps', timeline, { flush: true })}
      <section class="panel">
        <div class="tabs" role="tablist">
          ${[['logs', `Logs (${logs.length})`], ['files', `Generated tests (${files.length})`], ['output', 'Input / output']].map(([k, l]) => html`<button role="tab" aria-selected="${String(tab === k)}" class="${tab === k ? 'active' : ''}" data-action="run-tab" data-tab="${k}">${l}</button>`)}
        </div>
        ${tabBody}
      </section>
    </div>`;
}

function logLine(e) {
  return html`<div class="log-line ${e.level}"><span class="muted">${clock(e.ts)}</span> <span class="lv">${e.level.toUpperCase()}</span> ${e.agentId ? html`<span class="who">${e.agentId}</span> ` : ''}${e.stepId ? html`<span class="muted">[${e.stepId}]</span> ` : ''}${e.message}</div>`;
}

async function renderTests() {
  const executions = await api('/executions');
  if (!executions.length) return panel('Executions', empty('No test executions yet.'));
  const total = executions.reduce((a, e) => ({ p: a.p + e.summary.passed, f: a.f + e.summary.failed, s: a.s + e.summary.skipped }), { p: 0, f: 0, s: 0 });
  return html`<div class="grid kpis">
      <div class="kpi"><div class="label">Executions</div><div class="value">${executions.length}</div></div>
      <div class="kpi ok"><div class="label">Passed</div><div class="value">${total.p}</div></div>
      <div class="kpi ${total.f ? 'err' : ''}"><div class="label">Failed</div><div class="value">${total.f}</div></div>
      <div class="kpi"><div class="label">Pass rate</div><div class="value">${pct(total.p / Math.max(1, total.p + total.f + total.s))}</div></div>
    </div>
    ${executions.map((e) => panel(
      html`<span class="mono">${e.ticketKey}</span> · ${e.environment}`,
      html`<div class="panel-body row between"><div class="row small">${summaryBar(e.summary)}<span>${e.summary.passed}/${e.summary.total} passed</span>${e.summary.failed ? html`<span class="err-text">${e.summary.failed} failed</span>` : ''}${e.summary.flaky ? html`<span class="pill warn">${e.summary.flaky} flaky</span>` : ''}</div>
        <div class="small muted">${e.mode} · ${dur(e.durationMs)} · ${ago(e.finishedAt)} · <a href="#/runs/${e.runId}">run</a></div></div>
      <div class="table-wrap"><table><thead><tr><th>Test</th><th>Title</th><th>Status</th><th class="num">Duration</th><th>Error</th></tr></thead><tbody>
        ${e.results.map((r) => html`<tr><td class="mono">${r.testId}</td><td>${r.title}</td><td>${pill(r.status)}</td><td class="num">${dur(r.durationMs)}</td><td class="small err-text ellipsis" title="${r.error?.message || ''}">${firstLine(r.error?.message)}</td></tr>`)}
      </tbody></table></div>`,
      { flush: true, sub: e.executionId },
    ))}`;
}

function summaryBar(s) {
  const t = Math.max(1, s.total);
  return html`<div class="bar" role="img" aria-label="${`${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped`}" style="width:140px"><span class="p" style="width:${(s.passed / t) * 100}%"></span><span class="f" style="width:${(s.failed / t) * 100}%"></span><span class="s" style="width:${(s.skipped / t) * 100}%"></span></div>`;
}

async function renderDeployments() {
  const { deployments, pipelines } = await api('/deployments');
  return html`<div class="grid cards">${deployments.map((d) => html`<div class="panel"><div class="panel-head"><h2>${d.environment}</h2>${pill(d.status)}</div>
      <div class="panel-body stack small">
        <div class="row between"><span class="muted">Version</span><span class="mono">${d.version}</span></div>
        <div class="row between"><span class="muted">Commit</span><span class="mono">${d.commit || '—'}</span></div>
        <div class="row between"><span class="muted">Latency</span><span>${d.latencyMs != null ? `${d.latencyMs} ms` : '—'}</span></div>
        <div class="row between"><span class="muted">Deployed</span><span>${ago(d.deployedAt)}</span></div>
        <div class="row between"><span class="muted">URL</span><span class="mono">${d.baseUrl || d.url || '—'}</span></div>
        ${d.error ? html`<div class="err-text">${d.error}</div>` : ''}
      </div></div>`)}</div>
    ${panel('CI/CD pipelines', pipelines.length ? html`<div class="table-wrap"><table><thead><tr><th>Pipeline</th><th>Result</th><th class="hide-sm">Branch</th><th class="hide-sm">Commit</th><th>Message</th><th class="num">Duration</th><th>Started</th></tr></thead><tbody>
      ${pipelines.map((p) => html`<tr><td>${p.name}</td><td>${pill(p.conclusion || p.status)}</td><td class="hide-sm mono small">${p.branch}</td><td class="hide-sm mono small">${p.commit || '—'}</td><td class="ellipsis" title="${p.message || ''}">${p.message || ''}</td><td class="num">${p.durationSec != null ? dur(p.durationSec * 1000) : '—'}</td><td class="muted">${ago(p.startedAt)}</td></tr>`)}
    </tbody></table></div>` : empty('No pipelines.'), { flush: true, sub: 'monitored by the Deployment & Monitoring Agent' })}`;
}

async function renderInvestigations() {
  const [items, insights] = await Promise.all([api('/investigations'), api('/insights')]);
  const invHtml = items.length
    ? items.map((i) => html`<div class="inv">
        <div class="row between"><div class="row"><span class="mono">${i.testId}</span>${pill(i.category)}${i.recurring ? html`<span class="pill warn">recurring ×${i.occurrences}</span>` : ''}<span class="muted small">${i.title}</span></div>
          <div class="row small"><span class="muted">confidence</span><div class="meter" role="img" aria-label="${`confidence ${pct(i.confidence)}`}"><span style="width:${i.confidence * 100}%"></span></div><span>${pct(i.confidence)}</span></div></div>
        <div><b>Root cause:</b> ${i.rootCause}</div>
        <div class="cols">
          <div><div class="k">Evidence</div><ul class="small">${i.evidence.map((e) => html`<li>${e}</li>`)}</ul></div>
          <div><div class="k">Suggested actions</div><ul class="small">${i.suggestedActions.map((a) => html`<li>${a}</li>`)}</ul></div>
        </div>
        ${i.correlatedLogs.length ? html`<div><div class="k">Correlated application logs</div><pre class="code">${i.correlatedLogs.join('\n')}</pre></div>` : ''}
        ${i.proposedDefect ? html`<div class="small"><span class="k">Proposed defect</span> [${i.proposedDefect.severity}] ${i.proposedDefect.summary}</div>` : ''}
        <div class="small muted">${i.ticketKey} · ${ago(i.at)} · <a href="#/runs/${i.runId}">run</a></div>
      </div>`)
    : empty('No failures investigated yet.');
  return html`${panel('Optimization insights', html`<div class="stack">
      <ul>${insights.recommendations.map((r) => html`<li>${r}</li>`)}</ul>
      ${insights.recurringFailures.length ? html`<div class="table-wrap"><table><thead><tr><th>Test</th><th>Category</th><th class="num">Count</th><th>Root cause</th><th>Last seen</th></tr></thead><tbody>${insights.recurringFailures.map((r) => html`<tr><td class="mono">${r.testId}</td><td>${pill(r.category)}</td><td class="num">${r.count}</td><td class="ellipsis" title="${r.rootCause}">${r.rootCause}</td><td class="muted">${ago(r.lastSeen)}</td></tr>`)}</tbody></table></div>` : ''}
      ${insights.flakyTests.length ? html`<div class="small"><b>Flaky tests:</b> ${insights.flakyTests.map((f) => html`<span class="mono">${f.testId}</span> (${f.history.join(' → ')}) `)}</div>` : ''}
    </div>`, { sub: 'Reporting & Optimization Agent · cross-run memory' })}
    ${panel('Failure investigations', invHtml, { flush: true, sub: `${items.length} investigation(s) by the Failure Analysis Agent` })}`;
}

async function renderApprovals() {
  const all = await api('/approvals');
  const pending = all.filter((a) => a.status === 'pending');
  const history = all.filter((a) => a.status !== 'pending');
  const pendingHtml = pending.length
    ? pending.map((a) => html`<div class="approval">
        <div class="row between"><div class="row"><b>${a.title}</b>${pill('pending', 'awaiting decision')}</div><span class="small muted">${ago(a.createdAt)} · <a href="#/runs/${a.runId}">run</a></span></div>
        <div class="small muted mono">${a.agentId}.${a.action} · step ${a.stepId}</div>
        ${a.summary ? html`<pre class="code">${a.summary}</pre>` : ''}
        <details><summary class="small">Payload sent to the agent</summary><pre class="code">${JSON.stringify(a.payload, null, 2)}</pre></details>
        <label class="small muted" for="${`c-${a.id}`}">Comment (optional)</label>
        <textarea id="${`c-${a.id}`}" data-comment="${a.id}" placeholder="Reason for the decision"></textarea>
        <div class="row"><button class="btn ok" data-action="decide" data-id="${a.id}" data-approved="true">Approve</button><button class="btn danger" data-action="decide" data-id="${a.id}" data-approved="false">Reject</button></div>
      </div>`)
    : empty('Nothing waiting for approval. Sensitive actions (like filing Jira defects) will appear here.');
  return html`${panel('Pending approvals', pendingHtml, { flush: true, sub: 'sensitive operations gated by a human' })}
    ${panel('History', history.length ? html`<div class="table-wrap"><table><thead><tr><th>Request</th><th>Decision</th><th class="hide-sm">By</th><th>Comment</th><th>When</th></tr></thead><tbody>${history.map((a) => html`<tr><td>${a.title}</td><td>${pill(a.status)}</td><td class="hide-sm muted">${a.decidedBy}</td><td class="small">${a.comment || ''}</td><td class="muted">${ago(a.decidedAt)}</td></tr>`)}</tbody></table></div>` : empty('No decisions yet.'), { flush: true })}`;
}

const TRACE_LABELS = { requirement: 'Requirements', acceptance_criterion: 'Acceptance criteria', test: 'Tests', execution: 'Executions', investigation: 'Investigations', defect: 'Defects', report: 'Reports' };

async function renderTrace(params) {
  const tickets = (await api('/jira/tickets')).filter((t) => t.type !== 'Bug');
  const key = params[0] || tickets.find((t) => t.lastRun)?.key || tickets[0]?.key;
  setTopbar(html`<label class="small muted" for="trace-ticket">Ticket</label><select id="trace-ticket">${tickets.map((t) => html`<option value="${t.key}" ${t.key === key ? raw('selected') : ''}>${t.key} · ${t.summary}</option>`)}</select>`);
  if (!key) return panel('Traceability', empty('No tickets.'));
  const { matrix, graph } = await api(`/trace/${encodeURIComponent(key)}`);
  const counts = graph.nodes.reduce((m, n) => ({ ...m, [n.type]: (m[n.type] || 0) + 1 }), {});
  const body = matrix.length
    ? html`<div class="table-wrap"><table><thead><tr><th>Requirement</th><th>Acceptance criterion</th><th>Test</th><th>Latest execution</th><th>Investigation / defect</th></tr></thead><tbody>
      ${matrix.map((r) => html`<tr>
        <td><span class="mono small">${r.requirement.id}</span><div class="small muted">${r.requirement.label}</div></td>
        <td><span class="mono small">${r.criterion.id}</span><div class="small">${r.criterion.label}</div></td>
        <td>${r.test ? html`<span class="mono small">${r.test.id.replace(/^test:/, '')}</span><div class="small muted">${r.test.data?.file || ''}</div>${(r.test.data?.warnings || []).length ? html`<span class="pill warn">${r.test.data.warnings.length} warning(s)</span>` : ''}` : html`<span class="pill err">no test</span>`}</td>
        <td>${r.execution ? html`${pill(r.execution.data?.status)}<div class="small muted">${ago(r.execution.data?.at)}</div>` : html`<span class="muted">not executed</span>`}</td>
        <td>${r.defects.length ? r.defects.map((d) => html`<div class="small">${d.type === 'defect' ? html`<span class="pill err">${d.id}</span> ` : pill(d.data?.category)} ${d.type === 'defect' ? d.label.replace(d.id, '').trim() : ''}</div>`) : html`<span class="muted">—</span>`}</td>
      </tr>`)}</tbody></table></div>`
    : empty(`No trace yet for ${key}. Run the QA workflow for this ticket first.`);
  return html`<div class="grid kpis">${['requirement', 'acceptance_criterion', 'test', 'execution', 'investigation', 'defect', 'report'].map((t) => html`<div class="kpi"><div class="label">${TRACE_LABELS[t]}</div><div class="value">${counts[t] || 0}</div></div>`)}</div>
    ${panel(`Traceability matrix · ${key}`, body, { flush: true, sub: 'Jira requirement → acceptance criteria → generated tests → executions → investigations & defects' })}`;
}

async function renderReports(params) {
  const runs = (await api('/runs?limit=100')).filter((r) => r.output?.reportId);
  const id = params[0] || runs[0]?.id;
  setTopbar(runs.length ? html`<label class="small muted" for="report-run">Run</label><select id="report-run">${runs.map((r) => html`<option value="${r.id}" ${r.id === id ? raw('selected') : ''}>${r.label} · ${r.output.verdict} · ${ago(r.createdAt)}</option>`)}</select>` : '');
  if (!id) return panel('Reports', empty('No QA reports yet.'));
  const report = await api(`/runs/${id}/report`);
  const m = report.metrics;
  return html`<div class="grid kpis">
      <div class="kpi ${report.verdict === 'ready_for_release' ? 'ok' : report.verdict === 'blocked' ? 'err' : 'warn'}"><div class="label">Verdict</div><div class="value" style="font-size:17px">${report.verdict.replace(/_/g, ' ')}</div></div>
      <div class="kpi"><div class="label">Pass rate</div><div class="value">${pct(m.passRate)}</div><div class="hint">${m.passed} passed · ${m.failed} failed</div></div>
      <div class="kpi"><div class="label">AC coverage</div><div class="value">${pct(m.acCoverage)}</div><div class="hint">${m.acceptanceCriteria} criteria</div></div>
      <div class="kpi"><div class="label">Tests generated</div><div class="value">${m.testsGenerated}</div><div class="hint">${m.testsExecuted} executed</div></div>
      <div class="kpi"><div class="label">Automation gaps</div><div class="value">${report.automationGaps.length}</div></div>
    </div>
    ${panel(`QA report · ${report.ticketKey}`, html`<div class="md">${markdown(report.markdown)}</div>`, { sub: `${report.reportId} · ${ago(report.generatedAt)} · ${report.markdownPath}`, actions: html`<a class="small" href="#/runs/${id}">Open run →</a>` })}`;
}

// ------------------------------------------------------------------ start
connectEvents();
refreshApprovalBadge();
if (!location.hash) location.hash = '#/overview';
else renderRoute();
// Keep relative times and running durations fresh.
setInterval(() => {
  const { name, params } = parseRoute();
  if (name === 'overview' || (name === 'runs' && params[0])) scheduleRefresh();
}, 15000);
