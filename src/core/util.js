import crypto from 'node:crypto';

export const now = () => new Date().toISOString();

export function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
}

export function hash(text, len = 10) {
  return crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, len);
}

export class TimeoutError extends Error {
  constructor(ms) {
    super(`Timed out after ${ms}ms`);
    this.code = 'TIMEOUT';
    this.retryable = true;
  }
}

export async function withTimeout(promise, ms, onTimeout) {
  if (!ms) return promise;
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new TimeoutError(ms));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Counting semaphore used to cap per-agent and per-orchestrator concurrency. */
export class Semaphore {
  constructor(max) {
    this.max = Math.max(1, max);
    this.active = 0;
    this.queue = [];
  }
  get pending() {
    return this.queue.length;
  }
  async acquire() {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise((resolve) => this.queue.push(resolve));
    this.active++;
  }
  release() {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
