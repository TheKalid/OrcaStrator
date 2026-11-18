import fs from 'node:fs';
import { TargetApp } from './target-app.js';

const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const VAR_KEY = /^[A-Z_][A-Z0-9_]*$/i;
const PLACEHOLDER = /\$\{([A-Z_][A-Z0-9_]*)\}/gi;
const SECRET_KEY = /(secret|token|password|passwd|pwd|api[_-]?key|private|credential)/i;

/**
 * Test environments (dev, QA, staging, UAT…), each with its own base URL and
 * variables. Declared in orca.environments.json:
 *
 * {
 *   "default": "staging",
 *   "environments": {
 *     "staging": {
 *       "baseUrl": "https://staging.example.com",
 *       "description": "Shared staging",
 *       "variables": { "TEST_USER": "qa@example.com", "TEST_PASSWORD": "${STAGING_TEST_PASSWORD}" }
 *     }
 *   }
 * }
 *
 * ${VAR} placeholders are expanded from the process environment (.env), so
 * secrets stay out of the file. Variables are passed to the test process as
 * environment variables, together with ORCA_ENV and BASE_URL.
 *
 * Without the file, a single "staging" environment is built from
 * ORCA_TARGET_BASE_URL, so existing setups keep working.
 */
export class Environments {
  constructor({ file, fallbackBaseUrl, store, env = process.env }) {
    this.file = file;
    this.fallbackBaseUrl = fallbackBaseUrl;
    this.store = store;
    this.env = env;
    this.mtime = null;
    this.defs = null;
    this.defaultName = null;
    this.error = null;
    this.targets = new Map();
    this.reload();
  }

  /** Re-reads the file when it changed on disk, so edits apply without a restart. */
  reload() {
    let mtime = null;
    try {
      mtime = fs.statSync(this.file).mtimeMs;
    } catch {
      mtime = null;
    }
    if (this.defs && mtime === this.mtime) return;
    this.mtime = mtime;
    this.targets.clear();
    this.error = null;
    if (mtime === null) return this.#useFallback();
    try {
      const parsed = parseFile(JSON.parse(fs.readFileSync(this.file, 'utf8')));
      this.defs = parsed.environments;
      this.defaultName = parsed.default;
    } catch (err) {
      this.error = `Invalid ${this.file}: ${err.message}`;
      this.#useFallback();
    }
  }

  #useFallback() {
    this.defs = { staging: { baseUrl: this.fallbackBaseUrl, description: 'From ORCA_TARGET_BASE_URL', variables: {} } };
    this.defaultName = 'staging';
  }

  get source() {
    return this.mtime === null || this.error ? 'env' : 'file';
  }

  names() {
    this.reload();
    return Object.keys(this.defs);
  }

  has(name) {
    return this.names().includes(name);
  }

  /** The environment new runs use when none is given. Chosen in the console, falls back to the file's default. */
  get active() {
    const chosen = this.store?.get('settings', 'activeEnvironment');
    return chosen && this.has(chosen) ? chosen : this.defaultName;
  }

  setActive(name) {
    this.assert(name);
    this.store?.set('settings', 'activeEnvironment', name);
    return name;
  }

  assert(name) {
    if (!this.has(name)) throw Object.assign(new Error(`Unknown environment "${name}". Available: ${this.names().join(', ')}`), { status: 400 });
    return this.defs[name];
  }

  /** Health checks and logs for one environment's application. */
  target(name = this.active) {
    const def = this.assert(name);
    if (!this.targets.has(name)) this.targets.set(name, new TargetApp({ baseUrl: def.baseUrl }));
    return this.targets.get(name);
  }

  /** Resolved variables for the test process. Values never leave the server except in this process env. */
  variables(name = this.active) {
    const def = this.assert(name);
    const out = { ORCA_ENV: name, BASE_URL: def.baseUrl };
    for (const [k, v] of Object.entries(def.variables)) out[k] = this.#expand(v).value;
    return out;
  }

  #expand(raw) {
    const missing = [];
    const value = String(raw).replace(PLACEHOLDER, (_m, key) => {
      if (this.env[key] === undefined) missing.push(key);
      return this.env[key] ?? '';
    });
    return { value, missing };
  }

  /** Safe view for the API: secret values are masked, placeholders show where the value comes from. */
  describe() {
    this.reload();
    const active = this.active;
    return {
      active,
      default: this.defaultName,
      source: this.source,
      file: this.file,
      error: this.error,
      environments: Object.entries(this.defs).map(([name, def]) => ({
        name,
        baseUrl: def.baseUrl,
        description: def.description || '',
        active: name === active,
        variables: Object.entries(def.variables).map(([key, raw]) => {
          const { value, missing } = this.#expand(raw);
          const refs = [...String(raw).matchAll(PLACEHOLDER)].map((m) => m[1]);
          const secret = refs.length > 0 || SECRET_KEY.test(key);
          return { key, value: secret ? null : value, secret, from: refs, missing, set: value !== '' && !missing.length };
        }),
      })),
    };
  }
}

function parseFile(json) {
  if (!json || typeof json !== 'object' || !json.environments || typeof json.environments !== 'object') {
    throw new Error('expected { "environments": { "<name>": { "baseUrl": "..." } } }');
  }
  const environments = {};
  for (const [name, def] of Object.entries(json.environments)) {
    if (!NAME.test(name)) throw new Error(`environment name "${name}" must be letters, digits, - or _`);
    if (!def || typeof def.baseUrl !== 'string' || !/^https?:\/\//.test(def.baseUrl)) throw new Error(`environment "${name}" needs an http(s) baseUrl`);
    const variables = {};
    for (const [k, v] of Object.entries(def.variables || {})) {
      if (!VAR_KEY.test(k)) throw new Error(`variable "${k}" in "${name}" must be a valid env var name`);
      if (['ORCA_ENV', 'BASE_URL', 'PATH', 'HOME'].includes(k.toUpperCase())) throw new Error(`variable "${k}" in "${name}" is reserved`);
      variables[k] = String(v);
    }
    environments[name] = { baseUrl: def.baseUrl.replace(/\/$/, ''), description: def.description ? String(def.description) : '', variables };
  }
  const names = Object.keys(environments);
  if (!names.length) throw new Error('declare at least one environment');
  const def = json.default && environments[json.default] ? json.default : names[0];
  return { environments, default: def };
}
