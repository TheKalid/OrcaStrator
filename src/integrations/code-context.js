import fs from 'node:fs';
import path from 'node:path';

/**
 * Read-only access to the source code of the application under test, used by
 * the Test Generation Agent (selectors, routes) and the Failure Analysis Agent.
 *   - local:  a directory on disk (default: ./demo-app)
 *   - rest:   a GitHub repository (GITHUB_TOKEN + GITHUB_REPO)
 */
export function createCodeContext(config) {
  return config.github.mode === 'rest' ? new GitHubCodeContext(config.github) : new LocalCodeContext(config.github.localSourceDir);
}

const SOURCE_EXT = /\.(m?js|ts|tsx|jsx|html|vue|svelte)$/;

class BaseCodeContext {
  /** All data-testid values found in the source, with the file they appear in. */
  async findTestIds() {
    const ids = new Map();
    for (const file of (await this.listFiles()).filter((f) => SOURCE_EXT.test(f))) {
      const content = await this.readFile(file);
      for (const m of content.matchAll(/data-testid=["'`]([^"'`$]+)["'`]/g)) {
        if (!ids.has(m[1])) ids.set(m[1], file);
      }
    }
    return [...ids].map(([id, file]) => ({ id, file }));
  }

  /** Route-like strings (e.g. app.get('/cart')) found in the source. */
  async findRoutes() {
    const routes = new Set();
    for (const file of (await this.listFiles()).filter((f) => SOURCE_EXT.test(f))) {
      const content = await this.readFile(file);
      for (const m of content.matchAll(/\.(get|post|put|patch|delete)\(\s*['"`](\/[^'"`]*)['"`]/g)) routes.add(`${m[1].toUpperCase()} ${m[2]}`);
    }
    return [...routes];
  }

  async grep(pattern, { maxResults = 20 } = {}) {
    const re = new RegExp(pattern, 'i');
    const hits = [];
    for (const file of (await this.listFiles()).filter((f) => SOURCE_EXT.test(f))) {
      const lines = (await this.readFile(file)).split('\n');
      lines.forEach((line, i) => {
        if (hits.length < maxResults && re.test(line)) hits.push({ file, line: i + 1, text: line.trim().slice(0, 200) });
      });
    }
    return hits;
  }
}

export class LocalCodeContext extends BaseCodeContext {
  mode = 'local';
  constructor(dir) {
    super();
    this.dir = dir;
  }
  async listFiles() {
    const out = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(path.relative(this.dir, p));
      }
    };
    if (fs.existsSync(this.dir)) walk(this.dir);
    return out;
  }
  async readFile(rel) {
    const p = path.resolve(this.dir, rel);
    if (!p.startsWith(path.resolve(this.dir))) throw new Error('Path escapes code context root');
    return fs.readFileSync(p, 'utf8');
  }
  async recentChanges() {
    return [];
  }
}

export class GitHubCodeContext extends BaseCodeContext {
  mode = 'github';
  constructor({ token, repo, branch }) {
    super();
    this.repo = repo;
    this.branch = branch;
    this.headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    this.cache = new Map();
  }
  async #get(url, raw = false) {
    const res = await fetch(`https://api.github.com${url}`, { headers: raw ? { ...this.headers, Accept: 'application/vnd.github.raw' } : this.headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw Object.assign(new Error(`GitHub ${url} → ${res.status}`), { retryable: res.status >= 500 || res.status === 429 });
    return raw ? res.text() : res.json();
  }
  async listFiles() {
    if (!this.cache.has('tree')) {
      const tree = await this.#get(`/repos/${this.repo}/git/trees/${this.branch}?recursive=1`);
      this.cache.set('tree', tree.tree.filter((t) => t.type === 'blob').map((t) => t.path));
    }
    return this.cache.get('tree');
  }
  async readFile(p) {
    if (!this.cache.has(p)) this.cache.set(p, await this.#get(`/repos/${this.repo}/contents/${p}?ref=${this.branch}`, true));
    return this.cache.get(p);
  }
  async recentChanges(limit = 10) {
    const commits = await this.#get(`/repos/${this.repo}/commits?sha=${this.branch}&per_page=${limit}`);
    return commits.map((c) => ({ sha: c.sha.slice(0, 7), message: c.commit.message.split('\n')[0], author: c.commit.author?.name, date: c.commit.author?.date }));
  }
}
