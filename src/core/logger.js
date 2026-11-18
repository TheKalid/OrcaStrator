import { now } from './util.js';

const KEY_VALUE_PATTERN = /(api[_-]?key|token|password|secret|authorization)(["'\s:=]+)(?!Bearer |Basic )([^\s"',}]+)/gi;
const SECRET_PATTERNS = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /Basic [A-Za-z0-9+/=]{16,}/g,
  /Bearer [A-Za-z0-9._-]{16,}/g,
];

/** Remove anything that looks like a credential before it reaches logs or the UI. */
export function redact(value) {
  if (value == null) return value;
  let text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const re of SECRET_PATTERNS) text = text.replace(re, '[REDACTED]');
  return text.replace(KEY_VALUE_PATTERN, (_m, k, sep) => `${k}${sep}[REDACTED]`);
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

/**
 * Structured logger. Every entry is emitted on the event bus (so the dashboard
 * can stream it) and printed to stdout as one JSON-ish line.
 */
export class Logger {
  constructor({ bus, level = process.env.ORCA_LOG_LEVEL || 'info', scope = {} } = {}) {
    this.bus = bus;
    this.level = level;
    this.scope = scope;
  }
  child(scope) {
    return new Logger({ bus: this.bus, level: this.level, scope: { ...this.scope, ...scope } });
  }
  log(level, message, data) {
    if (LEVELS[level] < LEVELS[this.level]) return;
    const entry = { ts: now(), level, message: redact(message), ...this.scope };
    if (data !== undefined) {
      try {
        entry.data = JSON.parse(redact(data instanceof Error ? { message: data.message } : data) ?? 'null');
      } catch {
        entry.data = redact(String(data));
      }
    }
    if (process.env.ORCA_QUIET !== 'true') {
      const scope = [this.scope.runId, this.scope.agentId, this.scope.stepId].filter(Boolean).join(' ');
      const line = `${entry.ts} ${level.toUpperCase().padEnd(5)} ${scope ? `[${scope}] ` : ''}${entry.message}`;
      (level === 'error' ? console.error : console.log)(line);
    }
    this.bus?.emit('log', entry);
    return entry;
  }
  debug(m, d) { return this.log('debug', m, d); }
  info(m, d) { return this.log('info', m, d); }
  warn(m, d) { return this.log('warn', m, d); }
  error(m, d) { return this.log('error', m, d); }
}
