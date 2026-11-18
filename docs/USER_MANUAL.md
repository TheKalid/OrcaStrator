# ORCA user manual

ORCA is an AI agent orchestrator for software testing. It takes a Jira ticket, works out its acceptance criteria, writes automated tests, runs them with Playwright, analyzes the failures and gives you a QA report with a clear verdict. When an action is sensitive, such as filing defects in Jira, ORCA stops and asks for your approval.

This manual explains how to use the web console. For the technical design, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 1. Getting started

### Requirements

- Node.js 22.6 or later.

### Installation (first time only)

```bash
npm install
```

```bash
npx playwright install chromium-headless-shell
```

### Start ORCA

```bash
npm start
```

Open **http://127.0.0.1:4000** in your browser.

ORCA also starts a demo store, **ORCA Shop**, on http://127.0.0.1:4100. It is the application under test in demo mode, and it ships with a deliberate pricing bug so you can watch ORCA find it.

> If the page looks unchanged after an update, do a hard reload: **Cmd + Shift + R** (Mac) or **Ctrl + Shift + R** (Windows/Linux).

### Connection indicator

A dot in the bottom-left corner shows the connection state:

- **green · live**: the console is receiving real-time events.
- **red · reconnecting…**: the connection to the server was lost. Check that `npm start` is still running.

---

## 2. Key concepts

### Ticket

A Jira user story. ORCA tests tickets in the **Ready for QA** status. *Bug* tickets are defects and are not tested.

### Run

One full pass of the QA workflow for a ticket. Every run goes through seven stages:

| Stage | What it does | Agent |
|---|---|---|
| **Ticket** | Reads the ticket from Jira. | Jira Monitoring |
| **Analyze** | Turns the ticket into requirements and Given/When/Then criteria, and flags ambiguities. At the same time it checks that the environment is healthy. | Requirement · Deployment & Monitoring |
| **Write tests** | Generates Playwright tests (UI and API) from the criteria. | Test Generation |
| **Run tests** | Runs the tests against the application. | Deployment & Monitoring |
| **Diagnose** | Investigates each failure, correlates it with the application logs and proposes a cause. Runs only if something failed. | Failure Analysis |
| **Report** | Computes metrics, coverage and the final verdict. | Reporting & Optimization |
| **File bugs** | Creates the defects in Jira. Happens only for product bugs and **always requires your approval**. | Jira Monitoring |

### Run outcome

Each run shows a single outcome, always with a one-line reason:

| Outcome | Meaning | What to do |
|---|---|---|
| **Ready to release** (green) | Every test passed and every criterion is covered. | Nothing. You can promote the tests to the regression suite. |
| **Needs attention** (yellow) | No product bugs, but something prevents full confidence: a broken test, ambiguous criteria or criteria without a test. | Read the reason and fix the ticket or the test. |
| **Blocked** (red) | A real product bug was found, or the environment is unhealthy. | Don't release. Review the diagnosis and the proposed defect. |
| **Waiting for your approval** (yellow) | The run is paused until you approve or reject an action. | Go to **Approvals**. |
| **Testing…** (blue) | The run is in progress. | Wait; the screen updates on its own. |
| **Run crashed** (red) | The run itself failed because of a technical error, not because of the tests. | Open the run and check the logs. |
| **Not tested yet** | The ticket has never been tested. | Click **Run QA**. |

### Failure categories

When a test fails, the analysis agent classifies it:

| Category | Meaning |
|---|---|
| **product bug** | The application does something other than what the criterion requires. A real defect. |
| **test needs fixing** | The test is wrong, for example it uses a selector that doesn't exist. ORCA suggests the right one when it can find it. |
| **environment problem** | The application was unreachable or too slow. |
| **test data problem** | Test data is missing or wrong. |
| **unclear cause** | Not enough evidence to classify it. |

Each diagnosis includes a **confidence** percentage. If the same failure repeats across runs, it is marked **recurring ×N**.

---

## 3. Console tour

The left menu has three groups. On a phone, open it with the menu button in the top-left corner.

### Overview

The main screen. Read it top to bottom:

1. **Needs your action**: whatever needs you right now.
   - Pending approvals, with a **Review** button.
   - *Blocked* or *Needs attention* tickets, with their reason and an **Open** button.
   - When there is nothing, you'll see *Nothing needs you right now*.
2. **Tickets through the QA pipeline**: one row per ticket with seven bars, one per stage of the latest run.

   | Bar color | Meaning |
   |---|---|
   | Green | Stage done |
   | Pulsing blue | In progress |
   | Yellow | Waiting for your approval |
   | Red | Failed |
   | Outline only | Not needed (for example *Diagnose* when everything passed) |
   | Gray | Not started |

   Hover over a bar to see that stage's details. **Details** opens the run, and **Run QA** starts the first one.
3. **Agents**: what each agent is doing now (*Idle* or *Working: …*), how many tasks it has run and its success rate.
4. **Activity**: what is happening, as short sentences with a timestamp. It fills in live from the moment you open the page.
5. **Connections**: which systems ORCA is connected to (Jira, LLM, code, CI, test runner, MCP servers).

The **Test all “Ready for QA” tickets** button starts one run per ready ticket, all in parallel.

### Approvals

Sensitive actions waiting for your decision. The number next to the menu item shows how many are pending.

Each request shows:

- The title, for example *Create 1 defect(s) in Jira for SHOP-102*.
- A summary of what will happen.
- **Payload sent to the agent**: the exact data that will be sent.
- An optional comment field for the reason behind your decision.

Click **Approve** to let the run continue, or **Reject** to drop the action. Both are recorded in the history with who decided and when.

### Jira tickets

The list of tickets with their Jira status and the latest QA outcome.

- Click a key (for example `SHOP-101`) to see the description, acceptance criteria and comments.
- **Run QA** or **Run again** starts the workflow for that ticket.
- **Check Jira now** polls Jira for changes immediately instead of waiting for the next automatic poll.
- **Simulate Jira activity** (demo mode only) moves a ticket to another status so you can watch the Jira agent detect it.

### Runs

Every run, newest first, with its outcome and reason. Below it is a diagram of **how the workflow works**: steps stacked in one column run in parallel, steps marked *if* run only when their condition holds, and steps marked *approval* wait for a person.

**Run detail.** When you open a run you'll see:

- At the top, the outcome, the reason and the seven named stages.
- **Steps**: each step with its agent, status, summary and duration.
- **Logs**: the live log of what each agent did.
- **Generated tests**: the code of the generated tests.
- **Input / output**: the run's input and output data.
- Buttons in the top-right corner: **QA report**, **Traceability** and **Cancel run** (only while it is running).

### Results → QA reports

The QA report of each run: verdict, pass rate, acceptance-criteria coverage, tests generated and automation gaps, followed by the full report. Switch runs with the selector in the top-right corner. The report is also saved to disk as a Markdown file; its path appears under the title.

### Results → Test results

Every test execution, with a green/red bar of passed and failed tests, and a table per test with its status, duration and the first line of the error.

### Results → Failure analysis

- **Optimization insights**: recommendations drawn from every run, recurring failures and flaky tests.
- **Failure investigations**: each failure with its category, confidence, probable cause, evidence, suggested actions, the correlated application logs and, when relevant, the proposed defect.

### Results → Traceability

Pick a ticket in the top-right corner to see the full matrix:

**Requirement → acceptance criterion → test → latest execution → investigation or defect**

Use it to answer questions such as "which criterion has no test?" or "which requirement does this defect come from?". A criterion without a test is marked **no test**.

### System → Environments & CI

The state of each environment (version, commit, latency and health) and the latest CI/CD pipelines with their result.

---

## 4. Common tasks

### Test one ticket

1. Go to **Jira tickets** and click **Run QA** on the ticket.
2. The run detail opens; watch the stages progress.
3. When it finishes, read the outcome and the reason at the top.

### Test everything that is ready

1. On **Overview**, click **Test all “Ready for QA” tickets**.
2. Follow progress on the ticket board.
3. Handle whatever shows up under **Needs your action**.

### Review and file a defect

1. When a run finds a *product bug*, it pauses at **File bugs** and shows up under **Needs your action**.
2. Click **Review** and read the summary and payload.
3. Click **Approve** to create the defect in Jira, or **Reject** if it doesn't apply. The run finishes either way.

### Understand why a test failed

1. Open the run and look at the **Diagnose** stage, or go to **Results → Failure analysis**.
2. Read the probable cause and the evidence.
3. If it is *test needs fixing*, apply the suggested action (for example the correct selector) or adjust the criterion in Jira.

---

## 5. Command line

You can run the workflow without opening the console:

```bash
node src/cli.js run SHOP-101
```

Every *Ready for QA* ticket, approving defects automatically:

```bash
node src/cli.js run --all --approve
```

Use `--reject` instead of `--approve` to reject them. If you pass neither, the CLI rejects defects to be safe.

---

## 6. Demo scenarios

With the sample data you'll see these outcomes:

| Ticket | Scenario | Expected outcome |
|---|---|---|
| SHOP-101 | Login | Ready to release |
| SHOP-102 | Discount code | Blocked: the store charges $99.00 instead of $90.00. ORCA correlates it with the logs and proposes a defect for you to approve. |
| SHOP-103 | Products API | Ready to release |
| SHOP-104 | Password reset | Needs attention: the criterion uses a selector that doesn't exist, and ORCA suggests `reset-email-input`. |
| SHOP-105 | Order history | Needs attention: the ticket is vague and has no criteria, so no tests are generated. |

SHOP-105 starts *In Progress*. Click **Simulate Jira activity** and then **Check Jira now** to move it to *Ready for QA*.

---

## 7. Connecting real systems

Copy `.env.example` to `.env` and set only what you need; with no settings, everything runs locally on sample data. Restart ORCA after changing `.env`.

| System | Variables |
|---|---|
| **Jira Cloud** | `JIRA_MODE=cloud`, `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`, `JIRA_PROJECT_KEY`. Optional: `JIRA_AC_FIELD` if acceptance criteria live in a custom field, and `JIRA_AUTO_TRIGGER=true` to start QA when a ticket reaches `JIRA_TRIGGER_STATUS`. |
| **AI model** | `ORCA_LLM_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. Without them the agents use their own rules (*Connections* shows *LLM off (rule-based agents)*). |
| **Application under test** | `ORCA_TARGET_BASE_URL` and `ORCA_START_DEMO_APP=false`. |
| **GitHub** | `GITHUB_TOKEN` and `GITHUB_REPO` to read code from your repository; `CI_USE_GITHUB_ACTIONS=true` to read pipelines from GitHub Actions. |
| **MCP tools** | Copy `orca.mcp.example.json` to `orca.mcp.json` and declare the servers. |
| **Protect the console** | `ORCA_API_TOKEN` requires a token on every API call. |

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The page doesn't load | The server isn't running. | Run `npm start`. |
| The connection dot is red | The connection to the server was lost. | Check the terminal where ORCA runs; the console reconnects on its own. |
| I see the old interface | Browser cache. | Hard reload: Cmd/Ctrl + Shift + R. |
| A run stays at *Waiting for your approval* | An approval is pending. | Go to **Approvals**. |
| *Run crashed* | A technical error during the run. | Open the run and check **Logs**. |
| Every test fails with *environment problem* | The application under test isn't responding. | Check **Environments & CI** and the configured URL. |
| No tests are generated | The ticket has no clear acceptance criteria. | Add criteria in Jira and run QA again. |
| *Activity* is empty | The feed only shows what happened since you opened the page. | Start a run, or check the history under **Runs**. |
