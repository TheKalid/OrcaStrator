<p align="center">
  <picture>
    <source srcset="docs/assets/logo-light.png" media="(prefers-color-scheme: dark)">
    <img src="docs/assets/logo.png" alt="OrcaStrator logo: an orca conducting with a baton" width="140">
  </picture>
</p>

# OrcaStrator

An agent orchestrator for software testing.

**ORCA** (Orchestrator for Reasoning, Coordination & Automation) is a Node.js platform where a central
orchestrator assigns tasks to specialized AI agents, runs workflows, shares context between them,
gates sensitive operations behind human approval and traces every Jira requirement to the tests,
executions and defects it produced.

The MVP ships one end-to-end workflow, running against a mock Jira and a demo shop app:

```
Jira ticket → Requirement analysis ∥ Environment health → Test generation → Playwright execution
            → Failure analysis → QA report → (human approval) → Defects filed in Jira
```

## Quick start

Requirements: Node.js ≥ 22.6.

```bash
npm install
```

```bash
npx playwright install chromium-headless-shell
```

```bash
npm start
```

Open http://127.0.0.1:4000. ORCA also starts the demo app under test on http://127.0.0.1:4100.

Run the workflow headless from the CLI (all "Ready for QA" tickets, in parallel):

```bash
node src/cli.js run --all --approve
```

```bash
npm test
```

## What the mock setup demonstrates

| Ticket | Scenario | Expected outcome |
|---|---|---|
| SHOP-101 | Login (UI) | All tests pass → `ready_for_release` |
| SHOP-102 | Discount code (UI) | Real pricing bug in the demo app → product defect, correlated with app logs, defect proposed for approval → `blocked` |
| SHOP-103 | Products API | API tests pass → `ready_for_release` |
| SHOP-104 | Password reset (UI) | AC references a selector that doesn't exist → classified as automation issue with the correct selector suggested → `needs_attention` |
| SHOP-105 | Order history | Vague, no acceptance criteria → ambiguities and automation gaps, no tests → `needs_attention` |

In the dashboard, "Simulate Jira activity" moves SHOP-105 to *Ready for QA* so you can watch the Jira Monitoring Agent pick up the change.

## Agents

| Agent | Responsibility |
|---|---|
| Jira Monitoring | Polls Jira, detects new tickets, status changes and comments; fetches tickets; files defects (approval required). |
| Requirement | Turns tickets into user stories, Given/When/Then acceptance criteria and testable requirements; flags ambiguities. |
| Test Generation | Generates Playwright UI and API tests from acceptance criteria and the app's source (selectors, routes). |
| Deployment & Monitoring | Checks environment and pipeline health; runs suites with Playwright; tracks flaky tests. |
| Failure Analysis | Root-cause analysis: classifies failures, correlates app logs, detects recurring failures, proposes defects. |
| Reporting & Optimization | QA reports, AC coverage, automation gaps, recurring issues and recommendations. |

## Connecting real systems

Copy `.env.example` to `.env` and set what you need. Without these settings everything runs offline.

- **Jira Cloud**: `JIRA_MODE=cloud`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`.
  Optionally `JIRA_AC_FIELD` if acceptance criteria live in a custom field, and `JIRA_AUTO_TRIGGER=true` to start the QA workflow when a ticket reaches `JIRA_TRIGGER_STATUS`.
- **LLM**: `ORCA_LLM_PROVIDER=anthropic` plus `ANTHROPIC_API_KEY`. Agents switch from heuristics to Claude and fall back to the heuristics if a call fails.
- **Application under test**: `ORCA_TARGET_BASE_URL` and `ORCA_START_DEMO_APP=false`.
- **GitHub**: `GITHUB_TOKEN` and `GITHUB_REPO` make the code context come from your repo; `CI_USE_GITHUB_ACTIONS=true` reads pipelines from GitHub Actions.
- **MCP tools**: copy `orca.mcp.example.json` to `orca.mcp.json` and declare servers. Agents call them via `ctx.tools`.

## Documentation

- [User manual](docs/USER_MANUAL.md): how to use the console, what each outcome means, common tasks, troubleshooting.
- [Architecture](docs/ARCHITECTURE.md): components, contracts, agents, workflow, how to extend, roadmap.

## License

MIT
