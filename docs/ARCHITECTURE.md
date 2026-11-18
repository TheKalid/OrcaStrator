# OrcaStrator architecture

ORCA (Orchestrator for Reasoning, Coordination & Automation) coordinates specialized
AI agents across the software testing lifecycle. This document describes the MVP
foundation and how it is meant to grow.

## Principles

| Principle | How the MVP applies it |
|---|---|
| Orchestrator-centric | Agents never call each other directly. Every call goes through `Orchestrator.dispatch`, which validates, limits, times out, retries, measures and traces it. |
| Structured communication | Every agent action declares zod input/output schemas (`src/core/contracts.js`). A contract violation fails the task explicitly instead of propagating bad data. |
| Provider independence | Agents talk to `ctx.llm`, a small interface (`generateObject`, `generateText`). Providers: `mock` (offline) and `anthropic`. Each agent keeps a deterministic heuristic path and falls back to it if the LLM is unavailable or fails. |
| Modularity | Agents extend `BaseAgent` and are registered in `AgentRegistry`; integrations are created in one factory; workflows are plain data. Each piece can be replaced on its own. |
| Observability | Every run, step, task, agent status change, approval, Jira change and log line is an event on the `EventBus`, persisted where useful and streamed to the dashboard over SSE. |
| Safety | Sensitive actions sit behind human approval. Secrets are only read from env, redacted from logs, and not passed to the Playwright child process. Generated tests run in a separate process with a hard timeout. The API binds to localhost and supports a bearer token. |

## Components

```
                ┌──────────────── Dashboard (public/) ────────────────┐
                │   REST + SSE  (src/server/api.js)                   │
                └───────────────────────┬─────────────────────────────┘
                                        │
┌───────────────────────────────── Orchestrator ─────────────────────────────────┐
│ WorkflowEngine   sequential · parallel · conditional · approval gates          │
│ dispatch()       contracts · per-agent concurrency · timeout · retry/backoff   │
│ ApprovalService  human-in-the-loop                                             │
│ ContextStore     shared memory (run scope + global scope)                      │
│ Traceability     ticket → requirement → AC → test → execution → RCA → defect   │
│ AgentMetrics     status, invocations, success rate, latency, LLM usage         │
│ EventBus/Logger  structured events and logs with secret redaction              │
└──────┬──────────────┬───────────────┬───────────────┬──────────────┬──────────┘
       │              │               │               │              │
  Jira Monitor   Requirement     Test Generation   Deployment &   Failure     Reporting &
                                                   Monitoring     Analysis    Optimization
       │                              │               │              │
       └──────────── ctx.integrations / ctx.llm / ctx.tools (MCP) ───┘
         Jira (mock | Cloud) · Code context (local | GitHub) · CI (mock | GitHub Actions)
         Playwright runner · Target app (health, logs) · MCP tool hub
```

### Directory map

| Path | Purpose |
|---|---|
| `src/core/` | Orchestrator, workflow engine, contracts, registry, approvals, memory, traceability, metrics, logger, store |
| `src/agents/` | The six initial agents |
| `src/workflows/` | Workflow definitions (MVP: `jira-to-qa-report`) |
| `src/llm/` | LLM provider interface + mock and Anthropic providers |
| `src/integrations/` | Jira, code context, CI, Playwright runner, target app, MCP |
| `src/server/` | REST/SSE API |
| `public/` | Dashboard (vanilla JS, no build) |
| `demo-app/` | Application under test for the mock setup (has an intentional pricing bug) |
| `fixtures/jira/` | Mock Jira tickets |
| `data/` | Runtime persistence (JSON, gitignored) |
| `workspace/runs/<runId>/` | Generated tests, Playwright report/artifacts and QA reports (gitignored) |

## MVP workflow

```
fetch-ticket ──► ┌ analyze-requirements ┐ ──► generate-tests ──► execute-tests ──► analyze-failures ──► qa-report ──► file-defects
  (Jira)         └ check-environment    ┘     [has testable AC]   [env healthy]    [failures > 0]                   [product defects,
                    (parallel)                                                                                       human approval]
```

## Agents

| Agent | Actions | Notes |
|---|---|---|
| Jira Monitoring | `getTicket`, `poll`, `createDefects` (sensitive) | `poll` diffs a snapshot kept in global memory and emits `jira.change`; the server schedules it and can auto-trigger runs. |
| Requirement | `analyze` | Gherkin + user story parser; LLM mode normalizes free text into the step vocabulary. Flags ambiguities and untestable requirements. |
| Test Generation | `generate` | Reads selectors/routes from the code context, compiles steps to Playwright (or asks the LLM, with a forbidden-API check), and warns about selectors missing from the source. |
| Deployment & Monitoring | `checkHealth`, `runTests` | Environment health + pipelines; runs Playwright in a child process and tracks per-test history (flakiness). |
| Failure Analysis | `investigate` | Classifies failures (product / automation / environment / data), correlates application logs from the test's time window, tracks recurring signatures, proposes defects. |
| Reporting & Optimization | `generateReport`, `insights` | Verdict, metrics, AC coverage, automation gaps, recurring issues and recommendations; Markdown + JSON on disk. |

### Step vocabulary (offline test generation)

```
Given I am logged in
Given I am on the "<page>" page
When  I fill "<data-testid>" with "<value>"
When  I click "<data-testid>"
When  I send a GET|POST|PUT|PATCH|DELETE request to "<path>" [with body {...}]
Then  I should see "<text>"
Then  I should be on the "<page>" page
Then  "<data-testid>" should show "<text>"
Then  the response status should be <code>
Then  the response should contain <n> items
Then  each item should have "<field>", "<field>"
Then  the response field "<field>" should be "<value>"
```

Steps outside this vocabulary are kept in the generated test as `test.fixme` and reported as
automation gaps. With `ORCA_LLM_PROVIDER=anthropic`, the LLM handles free-form criteria.

## Extending

- **New agent**: extend `BaseAgent`, declare actions with zod schemas, add it in `src/agents/index.js`.
- **New workflow**: add a definition in `src/workflows/` and register it in `src/app.js`.
- **New LLM provider**: implement `{ name, available, generateObject, generateText }` and add it to `createLLM`.
- **New integration**: add it to `createIntegrations`; agents receive it as `ctx.integrations.<name>`.
- **External tools**: declare MCP servers in `orca.mcp.json`; agents call `ctx.tools.call(server, tool, args)`.

## Roadmap

1. Persistence on PostgreSQL/SQLite and a durable queue (BullMQ/NATS) so runs survive restarts and scale across workers.
2. Real CI triggers (GitHub Actions webhooks) and deployment events as workflow triggers.
3. Requirement Agent over Confluence/Markdown documentation (via MCP).
4. Test maintenance loop: auto-fix automation issues and open PRs with the generated tests (behind approval).
5. RBAC, audit log and SSO for approvals.
6. Evaluation sets for each LLM-backed agent to measure quality before changing prompts or models.
