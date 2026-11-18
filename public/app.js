import { html, raw, api, ago, dur, pct, clock, firstLine, pill, toast, openDrawer, closeDrawer, empty, errorBox, panel, markdown } from './lib.js';
import { renderDag } from './dag.js';
import { icon, NAV_ICON, AGENT_ICON } from './icons.js';
import { donut, columns, hbars, meterRow } from './charts.js';

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
  overview: { title: 'Overview', render: renderOverview, live: /^(run\.|step\.|agent\.status|approval\.|jira\.change)/ },
  jira: { title: 'Jira tickets', render: renderJira, live: /^(run\.(succeeded|failed|queued|cancelled)|jira\.change)/ },
  runs: { title: 'Runs', render: renderRuns, live: /^(run\.|step\.)/ },
  tests: { title: 'Test results', render: renderTests, live: /^run\.(succeeded|failed)/ },
  deployments: { title: 'Environments & CI', render: renderDeployments, live: /^run\.(succeeded|failed)/ },
  investigations: { title: 'Failure analysis', render: renderInvestigations, live: /^run\.(succeeded|failed)/ },
  approvals: { title: 'Approvals', render: renderApprovals, live: /^approval\./ },
  trace: { title: 'Traceability', render: renderTrace, live: /^trace\.updated/ },
  reports: { title: 'QA reports', render: renderReports, live: /^run\.(succeeded|failed)/ },
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
  document.title = `${route.title} · OrcaStrator`;
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
  if (ev.type === 'run.succeeded' || ev.type === 'run.failed') toast(`${ev.payload.label}: QA run ${ev.type === 'run.failed' ? 'crashed' : 'finished'}`, ev.type === 'run.failed' ? 'err' : 'ok');
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
/** One plain-language outcome per run, so status and verdict never disagree. */
const VERDICT = {
  ready_for_release: { tone: 'ok', label: 'Ready to release' },
  needs_attention: { tone: 'warn', label: 'Needs attention' },
  blocked: { tone: 'err', label: 'Blocked' },
};
function outcome(run) {
  if (!run) return { tone: '', label: 'Not tested yet', reason: '' };
  const reason = run.output?.reason || stepSummary(run, 'execute-tests') || stepSummary(run, 'analyze-requirements') || '';
  switch (run.status) {
    case 'queued':
    case 'running':
      return { tone: 'info', label: 'Testing…', reason: currentStepName(run), live: true };
    case 'waiting_approval':
      return { tone: 'warn', label: 'Waiting for your approval', reason: 'Defects are ready to be filed in Jira.' };
    case 'failed':
      return { tone: 'err', label: 'Run crashed', reason: run.error?.message || '' };
    case 'cancelled':
      return { tone: '', label: 'Cancelled', reason: '' };
    default:
      return { ...(VERDICT[run.output?.verdict] || { tone: '', label: 'Finished' }), reason };
  }
}
const stepSummary = (run, id) => {
  const s = run.steps?.find((x) => x.id === id);
  return s && s.status === 'succeeded' ? s.summary || '' : '';
};
function currentStepName(run) {
  const s = run.steps?.find((x) => x.kind === 'task' && x.status === 'running');
  return s ? `${s.name}…` : 'Queued';
}
const OUTCOME_ICON = { 'Ready to release': 'check', 'Needs attention': 'alert', Blocked: 'ban', 'Testing…': 'spinner', 'Waiting for your approval': 'user', 'Run crashed': 'crash', Cancelled: 'minus', 'Not tested yet': 'dashed', Finished: 'check' };
function outcomePill(o, { lg = false } = {}) {
  return html`<span class="pill has-ic ${o.tone}${lg ? ' lg' : ''}${o.live ? ' live' : ''}">${icon(OUTCOME_ICON[o.label] || 'dashed', { size: lg ? 15 : 13, cls: o.live ? 'spin' : '' })}${o.label}</span>`;
}
function outcomeBadge(run) {
  return outcomePill(outcome(run));
}

/** The workflow as seven stages a person recognises. */
const STAGES = [
  ['Ticket', ['fetch-ticket'], 'ticket'],
  ['Analyze', ['analyze-requirements'], 'analyze'],
  ['Write tests', ['generate-tests'], 'code'],
  ['Run tests', ['check-environment', 'execute-tests'], 'play'],
  ['Diagnose', ['analyze-failures'], 'pulse'],
  ['Report', ['qa-report'], 'chart'],
  ['File bugs', ['file-defects'], 'bug'],
];
const STAGE_TEXT = { done: 'done', running: 'in progress', waiting: 'waiting for you', failed: 'failed', skipped: 'not needed', pending: 'not started' };
function stageState(run, ids) {
  const steps = (run?.steps || []).filter((s) => ids.includes(s.id));
  if (!steps.length) return { state: 'pending', detail: '' };
  const has = (st) => steps.some((s) => s.status === st);
  const detail = steps.map((s) => s.error || s.summary).filter(Boolean).join(' · ');
  if (has('failed')) return { state: 'failed', detail };
  if (has('waiting_approval')) return { state: 'waiting', detail };
  if (has('running')) return { state: 'running', detail };
  if (has('rejected')) return { state: 'skipped', detail: 'rejected by reviewer' };
  if (steps.every((s) => s.status === 'skipped')) return { state: 'skipped', detail: '' };
  if (steps.every((s) => s.status === 'succeeded' || s.status === 'skipped')) return { state: 'done', detail };
  return { state: 'pending', detail };
}
function stageStrip(run, { labels = false } = {}) {
  return html`<ol class="stages${labels ? ' labelled' : ''}">${STAGES.map(([name, ids, ic]) => {
    const { state, detail } = stageState(run, ids);
    const tip = `${name}: ${STAGE_TEXT[state]}${detail ? ` — ${detail}` : ''}`;
    return html`<li class="stage ${state}" title="${tip}"><span class="seg"></span>${labels ? html`<span class="stage-name">${icon(ic, { size: 13 })}${name}</span>` : html`<span class="sr">${tip}</span>`}</li>`;
  })}</ol>`;
}
function stageLegend() {
  return html`<div class="legend small">${['done', 'running', 'waiting', 'failed', 'skipped', 'pending'].map((s) => html`<span><i class="stage-key ${s}"></i>${STAGE_TEXT[s]}</span>`)}</div>`;
}

async function renderOverview() {
  const [ov, agents, tickets, runs, approvals, executions] = await Promise.all([api('/overview'), api('/agents'), api('/jira/tickets'), api('/runs?limit=100'), api('/approvals?status=pending'), api('/executions')]);
  setTopbar(html`<button class="btn primary" data-action="run-batch">${icon('play', { size: 14 })}Test all “${ov.jiraMonitor.triggerStatus}” tickets</button>`);

  // Latest run per ticket (runs are newest first).
  const latest = new Map();
  for (const r of runs) if (r.input?.ticketKey && !latest.has(r.input.ticketKey)) latest.set(r.input.ticketKey, r);
  const stories = tickets.filter((t) => t.type !== 'Bug');

  const todo = [];
  for (const a of approvals) todo.push(html`<li class="todo warn"><span class="todo-ic">${icon('user', { size: 16 })}</span><div><b>${a.title}</b><div class="small muted">${firstLine(a.summary)}</div></div><a class="btn sm primary" href="#/approvals">Review</a></li>`);
  for (const t of stories) {
    const r = latest.get(t.key);
    if (!r || r.status === 'waiting_approval') continue;
    const o = outcome(r);
    if (o.tone !== 'err' && o.tone !== 'warn') continue;
    todo.push(html`<li class="todo ${o.tone}"><span class="todo-ic">${icon(OUTCOME_ICON[o.label], { size: 16 })}</span><div><b><span class="mono">${t.key}</span> ${o.label.toLowerCase()}</b><div class="small muted">${o.reason}</div></div><a class="btn sm" href="#/runs/${r.id}">Open</a></li>`);
  }

  const counts = stories.reduce((m, t) => {
    const k = outcome(latest.get(t.key)).label;
    return { ...m, [k]: (m[k] || 0) + 1 };
  }, {});
  const countLine = Object.entries(counts).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(' · ');

  const board = stories.length
    ? html`<div class="board">${stories.map((t) => {
        const r = latest.get(t.key);
        const o = outcome(r);
        return html`<div class="board-row">
          <div class="board-ticket"><button class="link mono" data-action="ticket-detail" data-key="${t.key}">${t.key}</button><span class="small muted clamp" title="${t.summary}">${t.summary}</span></div>
          ${stageStrip(r)}
          <div class="board-outcome">${outcomePill(o)}${o.reason ? html`<span class="small muted clamp" title="${o.reason}">${o.reason}</span>` : ''}</div>
          <div class="board-act">${r ? html`<a class="btn sm" href="#/runs/${r.id}">Details</a>` : html`<button class="btn sm primary" data-action="run-ticket" data-key="${t.key}">Run QA</button>`}</div>
        </div>`;
      })}</div>`
    : empty('No tickets yet. Connect Jira or use the mock fixtures.');

  const integ = ov.integrations;
  const order = ['Ready to release', 'Needs attention', 'Blocked', 'Waiting for your approval', 'Testing…', 'Run crashed', 'Cancelled', 'Not tested yet'];
  const toneOf = { 'Ready to release': 'ok', 'Needs attention': 'warn', Blocked: 'err', 'Waiting for your approval': 'purple', 'Testing…': 'info', 'Run crashed': 'err', Cancelled: 'muted', 'Not tested yet': 'muted' };
  const segments = order.filter((l) => counts[l]).map((l) => ({ label: l.toLowerCase(), value: counts[l], tone: toneOf[l] }));
  const recent = executions.slice(0, 14).reverse();
  const health = html`<section class="panel">
    <div class="panel-head"><div><h2>QA health</h2><div class="sub">Where every ticket stands, and how the latest test runs went</div></div></div>
    <div class="panel-body health">
      <figure class="chart"><figcaption class="small muted">Tickets by outcome</figcaption>${segments.length ? donut(segments, { caption: 'tickets' }) : empty('No tickets yet.')}</figure>
      <figure class="chart grow"><figcaption class="small muted">Tests per run, last ${recent.length} (oldest left)</figcaption>
        ${recent.length ? columns(recent.map((e) => ({ label: e.ticketKey.replace(/^[A-Z]+-/, ''), title: `${e.ticketKey} · ${ago(e.finishedAt)}`, href: `#/runs/${e.runId}`, parts: [{ value: e.summary.passed, tone: 'ok', label: 'passed' }, { value: e.summary.failed, tone: 'err', label: 'failed' }, { value: e.summary.skipped, tone: 'muted', label: 'skipped' }] }))) : empty('No test runs yet.')}
        <div class="legend small"><span><i class="sw tone-ok"></i>passed</span><span><i class="sw tone-err"></i>failed</span><span><i class="sw tone-muted"></i>skipped</span></div>
      </figure>
    </div>
  </section>`;
  const conns = [
    ['ticket', 'Jira', integ.jira, integ.jira !== 'off'],
    ['cpu', 'LLM', ov.llm.available ? ov.llm.model || ov.llm.provider : 'off (rule-based)', ov.llm.available],
    ['code', 'Code', integ.codeContext, true],
    ['branch', 'CI', integ.ci, true],
    ['flask', 'Test runner', integ.playwright, true],
    ['plug', 'MCP servers', String(integ.mcpServers), integ.mcpServers > 0],
    ['refresh', 'Jira polling', ov.jiraMonitor.enabled ? `every ${dur(ov.jiraMonitor.intervalMs)}` : 'off', ov.jiraMonitor.enabled],
  ];
  return html`
    <section class="panel attention">
      <div class="panel-head"><h2>${todo.length ? `Needs your action (${todo.length})` : 'Nothing needs you right now'}</h2></div>
      ${todo.length ? html`<ul class="todos">${todo}</ul>` : html`<div class="panel-body small muted">No pending approvals and no blocked tickets. Start a run from the board below.</div>`}
    </section>
    ${health}
    ${panel('Tickets through the QA pipeline', html`<div class="board-head small muted"><span>Ticket</span><span class="stage-heads">${STAGES.map(([n, , ic]) => html`<span title="${n}">${icon(ic, { size: 14 })}<span class="stage-head-name">${n}</span></span>`)}</span><span>Outcome</span><span></span></div>${board}<div class="panel-foot">${stageLegend()}</div>`, { flush: true, sub: countLine || 'Each bar is one stage of the latest run. Hover a bar for details.' })}
    <div class="grid two">
      ${panel('Agents', agentList(agents), { flush: true, sub: `${agents.filter((a) => a.status === 'busy').length} working · ${agents.length} total` })}
      ${panel('Activity', feedList(), { flush: true, sub: 'Live, newest first' })}
    </div>
    <ul class="connections" aria-label="Connections">${conns.map(([ic, name, val, on]) => html`<li class="${on ? 'on' : 'off'}">${icon(ic, { size: 14 })}<span class="muted">${name}</span><b>${val}</b></li>`)}</ul>`;
}

function agentList(agents) {
  const most = Math.max(1, ...agents.map((a) => a.metrics.invocations));
  return html`<ul class="agents">${agents.map((a) => {
    const m = a.metrics;
    const doing = a.currentTask ? `Working: ${a.currentTask.action}${a.currentTask.runId ? '' : ' (ad hoc)'}` : a.queued ? `${a.queued} queued` : a.status === 'error' ? 'Last task failed' : m.lastRunAt ? `Idle · last task ${ago(m.lastRunAt)}` : 'Idle · not used yet';
    return html`<li class="agent-row ${a.status}" title="${a.description}">
      <span class="agent-ic">${icon(AGENT_ICON[a.id] || 'cpu', { size: 16 })}<span class="dot ${a.status === 'busy' ? 'running' : a.status === 'error' ? 'failed' : 'idle'}" aria-hidden="true"></span></span>
      <div><div class="name">${a.name.replace(/ Agent$/, '')}</div><div class="small muted">${doing}</div></div>
      <div class="agent-load"><span class="small muted num">${m.invocations} tasks · ${pct(m.successRate)} ok</span><span class="hb-track" aria-hidden="true"><span class="tone-bg-${m.failed ? 'warn' : 'info'}" style="width:${(m.invocations / most) * 100}%"></span></span></div>
    </li>`;
  })}</ul>`;
}

const STEP_VERB = { 'step.completed': 'finished', 'step.failed': 'failed', 'step.waiting_approval': 'is waiting for approval', 'step.rejected': 'was rejected', 'step.skipped': 'was skipped' };
function describeEvent(ev) {
  const p = ev.payload || {};
  if (ev.type === 'log') return { tone: p.level === 'error' ? 'err' : 'warn', text: `${p.agentId ? `${p.agentId}: ` : ''}${p.message}` };
  if (ev.type === 'run.started') return { tone: 'info', text: `${p.label}: QA run started` };
  if (ev.type === 'run.succeeded') return { tone: 'ok', text: `${p.label}: QA run finished` };
  if (ev.type === 'run.failed') return { tone: 'err', text: `${p.label}: QA run crashed` };
  if (ev.type === 'run.cancelled') return { tone: '', text: `${p.label}: run cancelled` };
  if (STEP_VERB[ev.type] && p.step?.kind !== 'parallel') {
    const extra = p.step?.error || p.step?.summary;
    return { tone: ev.type === 'step.failed' ? 'err' : ev.type === 'step.waiting_approval' ? 'warn' : '', text: `${p.label}: ${p.step?.name || p.step?.id} ${STEP_VERB[ev.type]}${extra ? ` — ${extra}` : ''}` };
  }
  if (ev.type === 'approval.requested') return { tone: 'warn', text: `Approval needed: ${p.title}` };
  if (ev.type === 'approval.decided') return { tone: p.status === 'approved' ? 'ok' : '', text: `${p.title}: ${p.status}` };
  if (ev.type === 'jira.change') return { tone: 'info', text: `Jira: ${p.key} ${p.kind}${p.to ? ` → ${p.to}` : ''}` };
  return null;
}

function feedIcon(ev, d) {
  if (ev.type.startsWith('approval.')) return 'user';
  if (ev.type === 'jira.change') return 'ticket';
  if (ev.type === 'run.started') return 'play';
  if (d.tone === 'err') return 'crash';
  if (d.tone === 'warn') return 'alert';
  if (d.tone === 'ok') return 'check';
  return 'pulse';
}
function feedList() {
  const items = state.feed.map((ev) => [ev, describeEvent(ev)]).filter(([, d]) => d).slice(0, 40);
  if (!items.length) return empty('Quiet for now. Activity appears here as agents work.');
  return html`<ul class="feed" data-keep-scroll="feed">${items.map(([ev, d]) => html`<li class="feed-item ${d.tone}"><span class="t">${clock(ev.ts)}</span>${icon(feedIcon(ev, d), { size: 14 })}<span>${d.text}</span></li>`)}</ul>`;
}

function runsTable(runs) {
  if (!runs.length) return empty('No runs yet. Start one from the overview or the Jira view.');
  return html`<div class="table-wrap"><table>
    <thead><tr><th>Ticket</th><th>Outcome</th><th class="hide-md">Why</th><th class="hide-sm">Trigger</th><th class="hide-sm num">Duration</th><th>Started</th></tr></thead>
    <tbody>${runs.map((r) => {
      const o = outcome(r);
      return html`<tr class="clickable" tabindex="0" data-href="#/runs/${r.id}">
      <td><a href="#/runs/${r.id}" class="mono">${r.label}</a></td>
      <td>${outcomeBadge(r)}</td>
      <td class="hide-md small muted wrap">${o.reason}</td>
      <td class="hide-sm muted">${r.trigger}</td>
      <td class="hide-sm num">${dur(r.durationMs)}</td>
      <td class="muted nowrap">${ago(r.createdAt)}</td></tr>`;
    })}</tbody></table></div>`;
}

async function renderJira() {
  const tickets = await api('/jira/tickets');
  setTopbar(html`<button class="btn" data-action="jira-simulate">Simulate Jira activity</button><button class="btn" data-action="jira-poll">Check Jira now</button><button class="btn primary" data-action="run-batch">Test all “Ready for QA”</button>`);
  const body = tickets.length
    ? html`<div class="table-wrap"><table>
      <thead><tr><th>Key</th><th>Summary</th><th class="hide-sm">Jira status</th><th class="hide-md">Type</th><th class="hide-md">Priority</th><th>Last QA outcome</th><th></th></tr></thead>
      <tbody>${tickets.map((t) => {
        const o = t.lastRun ? outcome({ status: t.lastRun.status, output: { verdict: t.lastRun.verdict } }) : null;
        return html`<tr>
        <td><button class="link mono" data-action="ticket-detail" data-key="${t.key}" aria-label="${`Open ${t.key} details`}">${t.key}</button></td>
        <td class="wrap">${t.summary}</td>
        <td class="hide-sm nowrap">${t.status}</td>
        <td class="hide-md muted">${t.type}</td>
        <td class="hide-md muted">${t.priority}</td>
        <td class="nowrap">${o ? html`<a href="#/runs/${t.lastRun.id}" class="pill ${o.tone}">${o.label}</a> <span class="muted small">${ago(t.lastRun.at)}</span>` : html`<span class="muted">${t.type === 'Bug' ? '—' : 'Not tested yet'}</span>`}</td>
        <td class="nowrap">${t.type === 'Bug' ? html`<span class="small muted">Defect</span>` : html`<button class="btn sm ${t.lastRun ? '' : 'primary'}" data-action="run-ticket" data-key="${t.key}">${t.lastRun ? 'Run again' : 'Run QA'}</button>`}</td>
      </tr>`;
      })}</tbody></table></div>`
    : empty('No tickets found.');
  return panel('Tickets', body, { flush: true, sub: `${tickets.length} tickets · the Jira Monitoring Agent watches for changes` });
}

async function getWorkflows() {
  state.workflows ||= await api('/workflows');
  return state.workflows;
}

async function renderRuns(params) {
  if (params[0]) return renderRunDetail(params[0]);
  const [runs, workflows] = await Promise.all([api('/runs?limit=100'), getWorkflows()]);
  setTopbar(html`<a class="btn" href="#/jira">Start from a ticket</a>`);
  return html`${panel('Runs', runsTable(runs), { flush: true, sub: `${runs.length} most recent · newest first` })}
    ${workflows.map((w) => panel(`How “${w.name}” works`, renderDag(w, null), { sub: 'Steps stacked in one column run in parallel. Steps marked “if” run only when their condition holds; “approval” steps wait for a person.' }))}`;
}

async function renderRunDetail(id) {
  const [run, logs] = await Promise.all([api(`/runs/${id}`), api(`/runs/${id}/logs`)]);
  const active = ['queued', 'running', 'waiting_approval'].includes(run.status);
  setTopbar(html`${active ? html`<button class="btn danger" data-action="cancel-run" data-id="${run.id}">Cancel run</button>` : ''}
    ${run.outputs?.['qa-report'] ? html`<a class="btn" href="#/reports/${run.id}">QA report</a>` : ''}
    <a class="btn" href="#/trace/${encodeURIComponent(run.input?.ticketKey || '')}">Traceability</a>`);
  titleEl.textContent = `Run · ${run.label}`;

  const o = outcome(run);
  const header = html`<section class="panel">
    <div class="panel-body stack">
      <div class="row between"><div class="row">${outcomePill(o, { lg: true })}<b>${run.label}</b></div>
        <div class="row small muted"><span>trigger: ${run.trigger}</span><span>started ${ago(run.startedAt || run.createdAt)}</span><span>took ${dur(run.durationMs ?? (run.startedAt ? Date.now() - Date.parse(run.startedAt) : null))}</span></div></div>
      ${o.reason ? html`<p class="reason">${o.reason}</p>` : ''}
      ${run.error ? html`<div class="error-box">${run.error.stepId ? `${run.error.stepId}: ` : ''}${run.error.message}</div>` : ''}
      ${stageStrip(run, { labels: true })}
    </div>
  </section>`;

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
  const recent = executions.slice(0, 24).reverse();
  return html`${panel('Results per execution', html`${columns(recent.map((e) => ({ label: e.ticketKey.replace(/^[A-Z]+-/, ''), title: `${e.ticketKey} · ${ago(e.finishedAt)}`, href: `#/runs/${e.runId}`, parts: [{ value: e.summary.passed, tone: 'ok', label: 'passed' }, { value: e.summary.failed, tone: 'err', label: 'failed' }, { value: e.summary.skipped, tone: 'muted', label: 'skipped' }] })), { height: 150 })}
      <div class="legend small"><span><i class="sw tone-ok"></i>passed</span><span><i class="sw tone-err"></i>failed</span><span><i class="sw tone-muted"></i>skipped</span></div>`, { sub: `Last ${recent.length} executions, oldest left. Click a column to open its run.` })}
    <div class="grid kpis">
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
  const CAT = { product_defect: ['product bug', 'err'], automation_issue: ['test needs fixing', 'purple'], environment_issue: ['environment problem', 'warn'], test_data_issue: ['test data problem', 'warn'], unknown: ['unclear cause', 'muted'] };
  const tally = (key) => Object.entries(items.reduce((m, i) => ({ ...m, [i[key]]: (m[i[key]] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
  const charts = items.length
    ? panel('Failures at a glance', html`<div class="health">
        <figure class="chart grow"><figcaption class="small muted">By cause</figcaption>${hbars(tally('category').map(([k, v]) => ({ label: (CAT[k] || [k])[0], value: v, tone: (CAT[k] || [, 'muted'])[1] })))}</figure>
        <figure class="chart grow"><figcaption class="small muted">By ticket</figcaption>${hbars(tally('ticketKey').map(([k, v]) => ({ label: k, value: v, tone: 'info' })))}</figure>
      </div>`, { sub: `${items.length} investigated failures across all runs` })
    : '';
  return html`${charts}${panel('Optimization insights', html`<div class="stack">
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
  const v = VERDICT[report.verdict] || { tone: '', label: report.verdict };
  const skipped = Math.max(0, (m.testsExecuted || 0) - (m.passed || 0) - (m.failed || 0));
  const summary = html`<section class="panel">
    <div class="panel-head"><div class="row">${outcomePill(v, { lg: true })}<b>${report.ticketKey}</b></div><span class="small muted">${ago(report.generatedAt)}</span></div>
    <div class="panel-body health">
      <figure class="chart"><figcaption class="small muted">Test results</figcaption>${donut([{ label: 'passed', value: m.passed || 0, tone: 'ok' }, { label: 'failed', value: m.failed || 0, tone: 'err' }, { label: 'skipped', value: skipped, tone: 'muted' }], { caption: 'tests' })}</figure>
      <figure class="chart grow stack"><figcaption class="small muted">Quality</figcaption>
        ${meterRow('Pass rate', m.passRate, { tone: m.passRate === 1 ? 'ok' : m.passRate ? 'warn' : 'err', note: `${m.passed} of ${m.testsExecuted} tests` })}
        ${meterRow('Acceptance-criteria coverage', m.acCoverage, { tone: m.acCoverage === 1 ? 'ok' : 'warn', note: `${m.acceptanceCriteria} criteria` })}
        ${meterRow('Generated tests executed', m.testsGenerated ? m.testsExecuted / m.testsGenerated : null, { tone: 'info', note: `${m.testsExecuted} of ${m.testsGenerated}` })}
        <div class="small muted">${report.automationGaps.length ? `${report.automationGaps.length} automation gap(s) listed in the report below.` : 'No automation gaps.'}</div>
      </figure>
    </div>
  </section>`;
  return html`${summary}
    ${panel(`QA report · ${report.ticketKey}`, html`<div class="md">${markdown(report.markdown)}</div>`, { sub: `${report.reportId} · ${ago(report.generatedAt)} · ${report.markdownPath}`, actions: html`<a class="small" href="#/runs/${id}">Open run →</a>` })}`;
}

// ------------------------------------------------------------------ start
document.querySelectorAll('#nav a').forEach((a) => a.insertAdjacentHTML('afterbegin', String(icon(NAV_ICON[a.dataset.route] || 'overview'))));
connectEvents();
refreshApprovalBadge();
if (!location.hash) location.hash = '#/overview';
else renderRoute();
// Keep relative times and running durations fresh.
setInterval(() => {
  const { name, params } = parseRoute();
  if (name === 'overview' || (name === 'runs' && params[0])) scheduleRefresh();
}, 15000);
