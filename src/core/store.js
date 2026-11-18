import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal JSON-file persistence: one file per collection, written atomically and
 * debounced. Good enough for an MVP and trivially replaceable by a database
 * behind the same get/set/list interface.
 */
export class JsonStore {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.collections = new Map();
    this.timers = new Map();
  }
  #file(name) {
    return path.join(this.dir, `${name}.json`);
  }
  #load(name) {
    if (!this.collections.has(name)) {
      let data = {};
      try {
        data = JSON.parse(fs.readFileSync(this.#file(name), 'utf8'));
      } catch {
        /* first run */
      }
      this.collections.set(name, data);
    }
    return this.collections.get(name);
  }
  get(name, key) {
    return this.#load(name)[key];
  }
  set(name, key, value) {
    this.#load(name)[key] = value;
    this.#schedule(name);
    return value;
  }
  delete(name, key) {
    delete this.#load(name)[key];
    this.#schedule(name);
  }
  list(name) {
    return Object.values(this.#load(name));
  }
  entries(name) {
    return this.#load(name);
  }
  #schedule(name) {
    clearTimeout(this.timers.get(name));
    this.timers.set(name, setTimeout(() => this.flush(name), 150));
  }
  flush(name) {
    const names = name ? [name] : [...this.collections.keys()];
    for (const n of names) {
      clearTimeout(this.timers.get(n));
      this.timers.delete(n);
      const file = this.#file(n);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.collections.get(n), null, 2));
      fs.renameSync(tmp, file);
    }
  }
}
