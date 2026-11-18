/** Health checks and log retrieval for the application under test. */
export class TargetApp {
  constructor({ baseUrl }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }
  async health() {
    const t0 = performance.now();
    try {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
      const body = await res.json().catch(() => ({}));
      return { ok: res.ok && body.status === 'ok', httpStatus: res.status, version: body.version || null, latencyMs: Math.round(performance.now() - t0), details: body };
    } catch (err) {
      return { ok: false, httpStatus: null, version: null, latencyMs: Math.round(performance.now() - t0), error: err.cause?.code || err.message };
    }
  }
  /** Application logs (the demo app exposes /__logs; replace with your log aggregator). */
  async logs({ since } = {}) {
    try {
      const res = await fetch(`${this.baseUrl}/__logs${since ? `?since=${encodeURIComponent(since)}` : ''}`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return [];
      return (await res.json()).lines || [];
    } catch {
      return [];
    }
  }
}
