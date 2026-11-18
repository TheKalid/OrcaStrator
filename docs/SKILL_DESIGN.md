# OrcaStrator as a skill: design notes

Status: draft. This records the decisions taken so far for turning ORCA into a skill that any QA engineer can add to their own project. Open questions are listed at the end.

## Goal

A QA engineer installs ORCA in their own repository and, from their coding agent, asks it to test one or more tickets. ORCA writes and runs the tests in their repository, drafts bugs for what it finds, files them in Jira only with the QA engineer's authorization and delivers a consolidated QA report.

## Decisions

### Agents are process stages, not a fixed headcount

The six agents of the MVP (Jira Monitoring, Requirement, Test Generation, Deployment & Monitoring, Failure Analysis, Reporting & Optimization) describe the stages every ticket goes through:

```
Ticket → Analyze → Write tests → Run tests → Diagnose → Report → Draft bugs
```

ORCA is the conductor. It decides how many worker agents to open and splits the tickets between them. Each worker takes its tickets through the whole flow on its own.

- Default: one worker per ticket, at most **5** at a time. Extra tickets are queued across those workers.
- Configurable per run, for example `--workers 3`.

### Shared resources

- Test generation always runs in parallel.
- Test data is isolated per ticket (for example a `orca-<TICKET>-` prefix on users, orders and other records the tests create).
- Test execution runs in parallel, unless the project is configured to run it serially (for fragile shared environments).

### Failures are isolated per ticket

If a worker crashes or stalls, only its ticket is marked *Run crashed*, with the reason. The other workers finish normally, and ORCA offers to retry that ticket alone.

### Bugs need the QA engineer's authorization

The worker for a ticket drafts each bug with:

- title;
- steps to reproduce;
- expected vs. actual result;
- evidence (screenshots, traces) and the relevant application logs.

The bug is created in Jira only after the QA engineer authorizes it. A rejected bug is not filed.

### Ticket sources

Jira is optional. ORCA accepts:

- Jira keys (through the Atlassian MCP server when it is connected, otherwise through ORCA's Jira REST client configured in `.env`);
- tickets pasted into the chat;
- a Markdown file with the ticket and its acceptance criteria.

### Generated tests live in the user's repository

Tests are written into the user's repository (for example `tests/orca/<TICKET>.spec.ts`) and follow their existing Playwright configuration. If the project has no Playwright setup, ORCA offers to add it. The tests are versioned with the project and can be promoted to its regression suite.

### Testing modes

By default ORCA tests **only the acceptance criteria of each ticket**.

When the run finishes, ORCA delivers the report and asks whether to run another mode:

| Mode | What it checks | Tooling |
|---|---|---|
| Accessibility | WCAG issues: contrast, labels, keyboard access | axe-core |
| Visual regression | Unexpected visual changes | Playwright screenshots |
| Performance | Load times, Core Web Vitals | Lighthouse |
| Basic security | Headers, cookies, simple XSS/injection checks | Playwright checks |
| Cross-browser / mobile | Chromium, Firefox, WebKit and mobile viewports | Playwright projects |

- The QA engineer can pick one or more modes, for all tickets or only some of them.
- Extra modes run in parallel with the same worker rules (one per ticket, at most 5) and reuse the analysis already done, without fetching or analyzing the tickets again.
- Bugs found by extra modes follow the same authorization rule.
- The report gains one section per mode.
- Running a mode on every run by default (through configuration) is out of scope for the first version.

### Distribution

- First-class target: a Claude Code plugin installable from this repository.
- Skills are written in the open `SKILL.md` format so other agent harnesses can use them too.

## Open questions

- **Authorization flow**: whether ORCA asks for authorization as soon as each bug is drafted while the other workers keep going, and how a rejection is recorded.
- **Other harnesses**: which ones are officially tested, how ORCA is installed in them (for example `npx skills add TheKalid/OrcaStrator`) and how it behaves in harnesses without parallel sub-agents (proposal: same flow, tickets processed one after another).
- **Authorization outside Claude Code**: proposal is an explicit yes/no in the chat as the common minimum, with the harness's own question UI when it has one.
- **Current codebase**: proposal is to keep the Jira client, traceability store, run history, QA report generator and optional dashboard (`npx orcastrator ui`) as an npm package; keep the demo shop and mock Jira as an example; retire the rule-based agent heuristics, since the harness's model does that work.
- **Definition of done**: proposal is that a QA engineer, in another repository with a web app, installs ORCA, runs `/orca SHOP-1 SHOP-2 SHOP-3` (or pastes the tickets), watches the workers run in parallel, authorizes each bug as it appears (approved bugs are filed in Jira) and gets a consolidated report, in Claude Code and in at least one other harness.
