import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TestLibrary, parseSpec } from '../src/integrations/test-library.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '@playwright', 'test', 'cli.js');

const SPEC = `import { test, expect } from '@playwright/test';
test.describe('Checkout', { tag: ['@regression', '@SHOP-102'] }, () => {
  test('[SHOP-102-AC1] Apply a valid code for demo@orca.dev', async ({ page }) => {});
  test.fixme('[SHOP-102-AC2] Not automated yet', async ({ page }) => {});
});
test('home loads @smoke', async ({ page }) => {});
test("api answers", { tag: '@smoke' }, async ({ request }) => {});
`;

test('parseSpec reads titles, case ids, tags and state', () => {
  const tests = parseSpec('tickets/SHOP-102/a.spec.mjs', SPEC);
  assert.equal(tests.length, 4);
  assert.deepEqual(tests[0], {
    id: 'tickets/SHOP-102/a.spec.mjs:3', file: 'tickets/SHOP-102/a.spec.mjs', line: 3, caseId: 'SHOP-102-AC1',
    title: 'Apply a valid code for demo@orca.dev', fullTitle: '[SHOP-102-AC1] Apply a valid code for demo@orca.dev',
    describe: 'Checkout', tags: ['@regression', '@SHOP-102'], ticketKey: 'SHOP-102', state: 'active',
  });
  assert.equal(tests[1].state, 'not-automated');
  // Describe tags apply to the tests after it; inline title tags and option tags are both read.
  assert.deepEqual(tests[2].tags, ['@regression', '@SHOP-102', '@smoke']);
  assert.equal(tests[2].title, 'home loads');
  assert.ok(tests[3].tags.includes('@smoke'));
});

test('catalog groups tests into declared and discovered suites', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-lib-'));
  fs.mkdirSync(path.join(dir, 'tickets', 'SHOP-102'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'tickets', 'SHOP-102', 'a.spec.mjs'), SPEC);
  fs.writeFileSync(path.join(dir, 'suites.json'), JSON.stringify({ suites: [{ name: 'smoke', tag: '@smoke', description: 'Fast' }] }));
  const lib = new TestLibrary({ dir });
  const { suites, tests, files, source } = await lib.catalog();
  assert.equal(source, 'static');
  assert.deepEqual(files, ['tickets/SHOP-102/a.spec.mjs']);
  assert.equal(tests.length, 4);
  assert.deepEqual(suites.map((s) => [s.name, s.count]), [['smoke', 2], ['regression', 4]]);
  assert.equal(await lib.grepFor('smoke'), '@smoke');
  assert.equal(await lib.grepFor('all'), null);
  await assert.rejects(() => lib.grepFor('nope'), /Unknown suite/);
  assert.throws(() => lib.read('../../etc/passwd'), /outside the test library/);
});

const EDGE = `import { test } from '@playwright/test';
test.describe('Outer', { tag: '@regression' }, () => {
  for (const p of ['/x', '/y']) {
    test(\`visits \${p}\`, async () => {});
  }
  test.describe('Inner', () => {
    test(
      '[CASE-1] multi line title @smoke',
      async () => {},
    );
  });
});
test.fixme('later', async () => {});
`;

test('catalog lists tests through Playwright, including loops and multi-line titles', { skip: !fs.existsSync(CLI) && 'Playwright not installed' }, async (t) => {
  // Inside the repo, so the specs can import @playwright/test.
  const workspace = path.join(path.dirname(CLI), '..', '..', '..', 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const dir = fs.mkdtempSync(path.join(workspace, 'test-lib-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'edge.spec.mjs'), EDGE);
  const lib = new TestLibrary({ dir, cli: CLI, workDir: path.join(dir, '.orca') });
  const catalog = await lib.catalog();
  assert.equal(catalog.source, 'playwright');
  assert.deepEqual(
    catalog.tests.map((x) => [x.id, x.title, x.describe, x.tags, x.state]),
    [
      ['edge.spec.mjs:4', 'visits /x', 'Outer', ['@regression'], 'active'],
      ['edge.spec.mjs:4#2', 'visits /y', 'Outer', ['@regression'], 'active'],
      ['edge.spec.mjs:7', 'multi line title', 'Inner', ['@regression', '@smoke'], 'active'],
      ['edge.spec.mjs:13', 'later', null, [], 'not-automated'],
    ],
  );
  assert.equal(catalog.tests[2].caseId, 'CASE-1');
  assert.equal(await lib.catalog(), catalog, 'unchanged files are served from the cache');

  // A spec Playwright cannot load: fall back to the static parse and say why.
  fs.writeFileSync(path.join(dir, 'broken.spec.mjs'), "import { test } from '@playwright/test'; test('broken', () => {");
  const fallback = await lib.catalog();
  assert.equal(fallback.source, 'static');
  assert.match(fallback.errors[0], /^SyntaxError: broken\.spec\.mjs/);
});
