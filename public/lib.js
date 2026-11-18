// Shared helpers: safe HTML templating, API client, formatting, UI primitives.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
/** Mark a string as already-safe HTML. Only use with output of `html` or trusted constants. */
export const raw = (s) => new Raw(String(s));

/** Tagged template: every interpolated value is HTML-escaped unless it is Raw (or an array of Raw). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return raw(out);
}
function render(v) {
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  if (v === null || v === undefined || v === false) return '';
  return esc(v);
}

// ------------------------------------------------------------------- API
export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `${method} ${path} → ${res.status}`);
  return data;
}

// ------------------------------------------------------------ formatting
export function ago(ts) {
  if (!ts) return '—';
  const s = Math.round((Date.now() - Date.parse(ts)) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
export function dur(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}
export const pct = (n) => (n === null || n === undefined ? '—' : `${Math.round(n * 100)}%`);
export const clock = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour12: false }) : '');
export const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

const STATUS_TONE = {
  succeeded: 'ok', passed: 'ok', healthy: 'ok', success: 'ok', ready_for_release: 'ok', approved: 'ok', idle: '', connected: 'ok',
  failed: 'err', timedOut: 'err', error: 'err', unhealthy: 'err', failure: 'err', blocked: 'err', product_defect: 'err', cancelled: '',
  running: 'info', busy: 'info', queued: 'info', automation_issue: 'purple',
  waiting_approval: 'warn', pending: 'warn', needs_attention: 'warn', environment_issue: 'warn', test_data_issue: 'warn',
  rejected: 'purple', skipped: '', unknown: '',
};
export function pill(status, label) {
  if (!status) return html`<span class="pill">—</span>`;
  const tone = STATUS_TONE[status] ?? '';
  const anim = status === 'running' || status === 'busy' ? ' running' : '';
  return html`<span class="pill ${tone}${anim}">${label || String(status).replace(/_/g, ' ')}</span>`;
}

// ------------------------------------------------------------ UI pieces
export function toast(message, tone = '') {
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.textContent = message;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 4500);
}

const drawer = () => document.getElementById('drawer');
export function openDrawer(title, bodyHtml) {
  document.getElementById('drawer-title').textContent = title;
  document.getElementById('drawer-body').innerHTML = String(bodyHtml);
  drawer().hidden = false;
  drawer().querySelector('.drawer-head [data-close]').focus();
}
export function closeDrawer() {
  drawer().hidden = true;
}
document.addEventListener('click', (e) => {
  if (e.target.closest('#drawer [data-close]')) closeDrawer();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !drawer().hidden) closeDrawer();
});

export const empty = (msg) => html`<div class="empty">${msg}</div>`;
export const errorBox = (err) => html`<div class="error-box">⚠ ${err.message || err}</div>`;

export function panel(title, body, { sub, actions, flush } = {}) {
  return html`<section class="panel">
    <div class="panel-head"><div><h2>${title}</h2>${sub ? html`<div class="sub">${sub}</div>` : ''}</div>${actions || ''}</div>
    <div class="panel-body ${flush ? 'flush' : ''}">${body}</div>
  </section>`;
}

// ------------------------------------------------------------- markdown
/** Minimal, safe markdown renderer (everything escaped first). Supports headings, tables, lists, fenced code, bold, inline code. */
export function markdown(src) {
  const lines = String(src || '').split('\n');
  const out = [];
  let i = 0;
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      i++;
      continue;
    }
    if (line.trim().startsWith('|')) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++]);
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const body = rows.filter((r, idx) => !(idx === 1 && /^\|?[\s|:-]+\|?$/.test(r)));
      const [head, ...rest] = body;
      out.push(`<div class="table-wrap"><table><thead><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>`);
      continue;
    }
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
    i++;
  }
  return raw(out.join('\n'));
}
