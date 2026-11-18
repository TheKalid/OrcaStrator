import { newId } from '../core/util.js';

/**
 * CI/CD provider interface:
 *   listPipelines({ limit }) -> [{ id, name, branch, commit, status, conclusion, startedAt, durationSec, url }]
 *   listDeployments()        -> [{ environment, version, status, deployedAt, url }]
 */
export function createCI(config, { store, targetApp }) {
  return config.ci.mode === 'github-actions' ? new GitHubActionsCI(config.github) : new MockCI({ store, targetApp });
}

export class MockCI {
  mode = 'mock';
  constructor({ store, targetApp }) {
    this.store = store;
    this.targetApp = targetApp;
    if (!this.store.list('ci_pipelines').length) this.#seed();
  }
  #seed() {
    const base = Date.now() - 6 * 3600_000;
    const runs = [
      { name: 'shop-web / build-and-deploy', branch: 'main', commit: 'a1c9e02', message: 'SHOP-101 login form', status: 'completed', conclusion: 'success', durationSec: 312 },
      { name: 'shop-web / build-and-deploy', branch: 'main', commit: 'b7d41f3', message: 'SHOP-103 products API', status: 'completed', conclusion: 'success', durationSec: 287 },
      { name: 'shop-web / unit-tests', branch: 'feature/pricing-bps', commit: 'c03aa9d', message: 'SHOP-102 pricing in basis points', status: 'completed', conclusion: 'failure', durationSec: 141 },
      { name: 'shop-web / build-and-deploy', branch: 'main', commit: 'd5e2b81', message: 'SHOP-102 pricing in basis points (retry)', status: 'completed', conclusion: 'success', durationSec: 335 },
      { name: 'shop-web / build-and-deploy', branch: 'main', commit: 'e88f10c', message: 'SHOP-104 password reset', status: 'completed', conclusion: 'success', durationSec: 298 },
    ];
    runs.forEach((r, i) => {
      const id = `ci_${i + 1}`;
      this.store.set('ci_pipelines', id, { id, ...r, startedAt: new Date(base + i * 3600_000).toISOString(), url: `mock://ci/runs/${id}` });
    });
  }
  async listPipelines({ limit = 20 } = {}) {
    return this.store.list('ci_pipelines').sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }
  async recordPipeline(run) {
    const id = newId('ci');
    this.store.set('ci_pipelines', id, { id, url: `mock://ci/runs/${id}`, ...run });
    return id;
  }
  async listDeployments() {
    const health = await this.targetApp.health();
    const last = (await this.listPipelines()).find((p) => p.name.includes('deploy') && p.conclusion === 'success');
    return [
      {
        environment: 'staging',
        baseUrl: this.targetApp.baseUrl,
        version: health.version || 'unknown',
        commit: last?.commit || null,
        status: health.ok ? 'healthy' : 'unhealthy',
        latencyMs: health.latencyMs,
        deployedAt: last?.startedAt || null,
        error: health.error || null,
      },
    ];
  }
}

export class GitHubActionsCI {
  mode = 'github-actions';
  constructor({ token, repo }) {
    this.repo = repo;
    this.headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  }
  async #get(url) {
    const res = await fetch(`https://api.github.com${url}`, { headers: this.headers, signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw Object.assign(new Error(`GitHub ${url} → ${res.status}`), { retryable: res.status >= 500 || res.status === 429 });
    return res.json();
  }
  async listPipelines({ limit = 20 } = {}) {
    const data = await this.#get(`/repos/${this.repo}/actions/runs?per_page=${limit}`);
    return data.workflow_runs.map((r) => ({
      id: String(r.id), name: r.name, branch: r.head_branch, commit: r.head_sha.slice(0, 7), message: r.display_title,
      status: r.status, conclusion: r.conclusion, startedAt: r.run_started_at,
      durationSec: r.updated_at && r.run_started_at ? Math.round((Date.parse(r.updated_at) - Date.parse(r.run_started_at)) / 1000) : null,
      url: r.html_url,
    }));
  }
  async listDeployments() {
    const data = await this.#get(`/repos/${this.repo}/deployments?per_page=10`);
    return data.map((d) => ({ environment: d.environment, version: d.ref, commit: d.sha.slice(0, 7), status: 'unknown', deployedAt: d.created_at, url: d.url }));
  }
}
