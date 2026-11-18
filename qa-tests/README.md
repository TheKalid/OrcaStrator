# Test library

The team's Playwright tests. OrcaStrator lists them on the console's **Test cases** page and runs them by suite.

```
qa-tests/
├── suites.json              # suite names, tags and descriptions
├── smoke.spec.mjs           # @smoke: is the app up?
├── access-control.spec.mjs  # @regression @security: private pages are protected
└── tickets/<KEY>/           # tests OrcaStrator generated for each ticket (@regression @<KEY>)
```

## Suites

A suite is a tag. Tag a whole `describe` block or a single test:

```js
test.describe('Checkout', { tag: ['@regression', '@smoke'] }, () => { /* … */ });
test('cart loads @smoke', async ({ page }) => { /* … */ });
```

Declare a suite's description in `suites.json`. Tags that are not declared still show up as suites.

| Suite | When to run it |
|---|---|
| `@smoke` | After every deployment: fast checks that the app and its key APIs answer. |
| `@regression` | Before a release: everything that already works, including every ticket's tests. |
| `@security` | Access control and data exposure checks. |

## Ticket tests

Every time a ticket's QA workflow generates tests, the latest version is saved to `tickets/<KEY>/` and tagged `@regression` and `@<KEY>`. Edit them by hand if needed, but the next run of that ticket replaces them.

## How OrcaStrator lists them

The **Test cases** page asks Playwright for the list (`playwright test --list`), with a generated config in `workspace/library/`, so what you see is exactly what Playwright would run. The list is cached until a spec file or `suites.json` changes. If Playwright cannot load a spec, the page shows the error and falls back to reading the sources.

## How OrcaStrator runs them

For each run OrcaStrator writes a Playwright config under `workspace/suites/<execution>/` with the selected environment's base URL, and passes that environment's variables (`BASE_URL`, `ORCA_ENV` and those from `orca.environments.json`) to the tests. Use relative URLs (`page.goto('/cart')`) so the same test works in every environment.
