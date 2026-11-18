import { raw } from './lib.js';

/** One authored icon set: 24px grid, 1.8 stroke, round caps. */
const PATHS = {
  overview: '<rect x="3.5" y="3.5" width="7" height="8.5" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15" width="7" height="5.5" rx="1.5"/>',
  shield: '<path d="M12 3l7.5 3v5.6c0 4.4-3.2 8.2-7.5 9.4-4.3-1.2-7.5-5-7.5-9.4V6z"/><path d="M8.8 12.2l2.3 2.3 4.2-4.6"/>',
  ticket: '<path d="M4 6.5h16V10a2 2 0 0 0 0 4v3.5H4V14a2 2 0 0 0 0-4z"/><path d="M14.5 7v1.5M14.5 11.25v1.5M14.5 15.5V17"/>',
  play: '<path d="M7.5 5v14l11-7z"/>',
  file: '<path d="M14 3.5H6.5a1 1 0 0 0-1 1v15a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/>',
  flask: '<path d="M9 3.5h6M10 3.5v5.8L4.8 18.4a1.5 1.5 0 0 0 1.3 2.1h11.8a1.5 1.5 0 0 0 1.3-2.1L14 9.3V3.5"/><path d="M7.4 14.5h9.2"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>',
  trace: '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.5 6h7M6 8.5V12a3 3 0 0 0 3 3h3a3 3 0 0 1 3 3"/>',
  server: '<rect x="3.5" y="4" width="17" height="6.5" rx="1.5"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.5"/><path d="M7.5 7.25h.01M7.5 16.75h.01"/>',
  analyze: '<path d="M4 6.5l1.5 1.5 2.8-3M4 16.5l1.5 1.5 2.8-3M11.5 7h8.5M11.5 12h8.5M11.5 17h8.5"/>',
  code: '<path d="M8.5 7.5L4 12l4.5 4.5M15.5 7.5L20 12l-4.5 4.5M13.4 5l-2.8 14"/>',
  pulse: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
  chart: '<path d="M4 20h16"/><rect x="5.5" y="11" width="3" height="6" rx=".6"/><rect x="10.5" y="5.5" width="3" height="11.5" rx=".6"/><rect x="15.5" y="13.5" width="3" height="3.5" rx=".6"/>',
  bug: '<rect x="7.5" y="8" width="9" height="12" rx="4.5"/><path d="M9.5 8V6.8a2.5 2.5 0 0 1 5 0V8M12 12.5V20M3.5 13H7.5M16.5 13h4M4.5 7.5l3.2 2.4M19.5 7.5l-3.2 2.4M4.5 19.5l3.2-2.4M19.5 19.5l-3.2-2.4"/>',
  check: '<circle cx="12" cy="12" r="8.5"/><path d="M8.2 12.4l2.6 2.6 5-5.4"/>',
  alert: '<path d="M12 4L3 19.5h18z"/><path d="M12 10v4.5M12 17.2h.01"/>',
  ban: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  crash: '<circle cx="12" cy="12" r="8.5"/><path d="M9 9l6 6M15 9l-6 6"/>',
  user: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
  spinner: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5"/>',
  dashed: '<circle cx="12" cy="12" r="8.5" stroke-dasharray="2.6 3"/>',
  minus: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12h8"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 9.5h5v5h-5zM9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/>',
  branch: '<circle cx="6.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="17.5" cy="7.5" r="2.5"/><path d="M6.5 8v8M17.5 10a6 6 0 0 1-6 6H9"/>',
  plug: '<path d="M9 3.5V8M15 3.5V8M6.5 8h11v3a5.5 5.5 0 0 1-11 0zM12 16.5V20.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4v4.5H15"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};

export function icon(name, { size = 16, cls = '' } = {}) {
  return raw(`<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name] || ''}</svg>`);
}

export const NAV_ICON = { overview: 'overview', approvals: 'shield', jira: 'ticket', runs: 'play', reports: 'file', tests: 'flask', investigations: 'search', trace: 'trace', deployments: 'server' };
export const AGENT_ICON = { 'jira-monitor': 'ticket', requirement: 'analyze', 'test-generation': 'code', 'deployment-monitor': 'server', 'failure-analysis': 'pulse', reporting: 'chart' };
