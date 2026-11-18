import { html, raw } from './lib.js';

/**
 * Small, dependency-free charts drawn from real data. Colours come from the
 * tone tokens (ok, warn, err, info, purple, muted) so they follow the theme.
 */

/** Donut with the total in the middle and a legend beside it. segments: [{label, value, tone}] */
export function donut(segments, { caption = '', size = 132 } = {}) {
  const items = segments.filter((s) => s.value > 0);
  const total = items.reduce((a, s) => a + s.value, 0);
  const r = 42;
  const c = 2 * Math.PI * r;
  const gap = items.length > 1 ? 2.5 : 0;
  let offset = 0;
  const arcs = items.map((s) => {
    const len = (s.value / total) * c;
    const arc = `<circle class="arc tone-${s.tone || 'muted'}" r="${r}" cx="60" cy="60" stroke-dasharray="${Math.max(0, len - gap)} ${c}" stroke-dashoffset="${-offset}"><title>${s.label}: ${s.value}</title></circle>`;
    offset += len;
    return arc;
  });
  const label = items.map((s) => `${s.value} ${s.label}`).join(', ') || 'no data';
  return html`<div class="donut-wrap">
    <svg class="donut" width="${size}" height="${size}" viewBox="0 0 120 120" role="img" aria-label="${`${caption}: ${label}`}">
      <circle class="track" r="${r}" cx="60" cy="60"></circle>
      <g transform="rotate(-90 60 60)">${raw(arcs.join(''))}</g>
      <text x="60" y="58" class="donut-total">${total}</text>
      <text x="60" y="76" class="donut-cap">${caption}</text>
    </svg>
    <ul class="chart-legend">${segments.map((s) => html`<li class="${s.value ? '' : 'zero'}"><i class="sw tone-${s.tone || 'muted'}"></i><span>${s.label}</span><b class="num">${s.value}</b></li>`)}</ul>
  </div>`;
}

/** Stacked columns, oldest left. items: [{label, title, href, parts: [{value, tone, label}]}] */
export function columns(items, { height = 132, unit = '' } = {}) {
  if (!items.length) return '';
  const max = Math.max(1, ...items.map((i) => i.parts.reduce((a, p) => a + p.value, 0)));
  return html`<div class="cols-chart" style="--h:${height}px">
    <div class="cols-axis small muted"><span class="num">${max}</span><span class="num">0</span></div>
    <div class="cols-plot">${items.map((i) => {
      const sum = i.parts.reduce((a, p) => a + p.value, 0);
      const tip = `${i.title || i.label}: ${i.parts.filter((p) => p.value).map((p) => `${p.value} ${p.label}`).join(', ') || `0${unit}`}`;
      const bar = html`<span class="col-bar" style="height:${(sum / max) * 100}%">${i.parts.filter((p) => p.value).map((p) => html`<span class="tone-bg-${p.tone}" style="flex:${p.value}"></span>`)}</span>`;
      return html`<a class="col" href="${i.href || '#'}" title="${tip}" aria-label="${tip}"><span class="col-track">${bar}</span><span class="col-label">${i.label}</span></a>`;
    })}</div>
  </div>`;
}

/** Horizontal bars. items: [{label, value, tone, note}] */
export function hbars(items, { max } = {}) {
  if (!items.length) return '';
  const top = max || Math.max(1, ...items.map((i) => i.value));
  return html`<ul class="hbars">${items.map((i) => html`<li>
    <span class="hb-label">${i.label}</span>
    <span class="hb-track" role="img" aria-label="${`${i.label}: ${i.value}${i.note ? ` (${i.note})` : ''}`}"><span class="tone-bg-${i.tone || 'info'}" style="width:${(i.value / top) * 100}%"></span></span>
    <span class="hb-value num">${i.value}${i.note ? html`<span class="muted"> ${i.note}</span>` : ''}</span>
  </li>`)}</ul>`;
}

/** Single horizontal meter with a label, for a ratio 0..1. */
export function meterRow(label, ratio, { tone = 'info', note = '' } = {}) {
  const pctTxt = ratio == null ? '—' : `${Math.round(ratio * 100)}%`;
  return html`<div class="meter-row">
    <div class="row between small"><span>${label}</span><span class="num"><b>${pctTxt}</b>${note ? html`<span class="muted"> · ${note}</span>` : ''}</span></div>
    <div class="meter-track" role="img" aria-label="${`${label}: ${pctTxt}`}"><span class="tone-bg-${tone}" style="width:${(ratio || 0) * 100}%"></span></div>
  </div>`;
}
