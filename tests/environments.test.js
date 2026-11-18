import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Environments } from '../src/integrations/environments.js';

function memoryStore() {
  const data = new Map();
  return { get: (c, k) => data.get(`${c}/${k}`), set: (c, k, v) => data.set(`${c}/${k}`, v) };
}

function writeFile(json) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-env-'));
  const file = path.join(dir, 'orca.environments.json');
  fs.writeFileSync(file, JSON.stringify(json));
  return file;
}

const spec = {
  default: 'qa',
  environments: {
    qa: { baseUrl: 'https://qa.example.com/', variables: { TEST_USER: 'bot@x.io', TEST_PASSWORD: '${QA_PW}', MISSING: '${NOPE}' } },
    staging: { baseUrl: 'https://staging.example.com', variables: { TEST_USER: 'stg@x.io' } },
  },
};

test('falls back to a single staging environment from ORCA_TARGET_BASE_URL', () => {
  const envs = new Environments({ file: '/does/not/exist.json', fallbackBaseUrl: 'http://127.0.0.1:4100', store: memoryStore() });
  assert.deepEqual(envs.names(), ['staging']);
  assert.equal(envs.active, 'staging');
  assert.equal(envs.target().baseUrl, 'http://127.0.0.1:4100');
  assert.equal(envs.describe().source, 'env');
});

test('loads environments, expands placeholders and switches the active one', () => {
  const envs = new Environments({ file: writeFile(spec), fallbackBaseUrl: 'http://x', store: memoryStore(), env: { QA_PW: 's3cret' } });
  assert.deepEqual(envs.names(), ['qa', 'staging']);
  assert.equal(envs.active, 'qa');
  assert.deepEqual(envs.variables('qa'), { ORCA_ENV: 'qa', BASE_URL: 'https://qa.example.com', TEST_USER: 'bot@x.io', TEST_PASSWORD: 's3cret', MISSING: '' });
  envs.setActive('staging');
  assert.equal(envs.active, 'staging');
  assert.equal(envs.target().baseUrl, 'https://staging.example.com');
  assert.throws(() => envs.setActive('prod'), /Unknown environment "prod"/);
});

test('describe() masks secrets and reports missing values', () => {
  const envs = new Environments({ file: writeFile(spec), fallbackBaseUrl: 'http://x', store: memoryStore(), env: { QA_PW: 's3cret' } });
  const qa = envs.describe().environments.find((e) => e.name === 'qa');
  const byKey = Object.fromEntries(qa.variables.map((v) => [v.key, v]));
  assert.equal(byKey.TEST_USER.value, 'bot@x.io');
  assert.equal(byKey.TEST_PASSWORD.value, null);
  assert.equal(byKey.TEST_PASSWORD.secret, true);
  assert.equal(byKey.TEST_PASSWORD.set, true);
  assert.deepEqual(byKey.MISSING.missing, ['NOPE']);
  assert.ok(!JSON.stringify(envs.describe()).includes('s3cret'));
});

test('an invalid file is reported and the fallback is used', () => {
  const envs = new Environments({ file: writeFile({ environments: { qa: { baseUrl: 'ftp://nope' } } }), fallbackBaseUrl: 'http://127.0.0.1:4100', store: memoryStore() });
  assert.deepEqual(envs.names(), ['staging']);
  assert.match(envs.describe().error, /needs an http\(s\) baseUrl/);
});
