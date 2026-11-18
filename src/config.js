import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env if present (Node >= 21.7 built-in, no dotenv dependency).
const envFile = path.join(ROOT_DIR, '.env');
if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
  process.loadEnvFile(envFile);
}

const env = process.env;
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const int = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

/**
 * Single source of runtime configuration. Secrets are only ever read from the
 * environment and never persisted or logged (see core/logger.js redaction).
 */
export function loadConfig(overrides = {}) {
  const config = {
    server: {
      host: env.ORCA_HOST || '127.0.0.1',
      port: int(env.ORCA_PORT, 4000),
      apiToken: env.ORCA_API_TOKEN || null,
    },
    paths: {
      root: ROOT_DIR,
      data: path.resolve(ROOT_DIR, env.ORCA_DATA_DIR || 'data'),
      workspace: path.resolve(ROOT_DIR, env.ORCA_WORKSPACE_DIR || 'workspace'),
      fixtures: path.join(ROOT_DIR, 'fixtures'),
      // The team's Playwright test library (hand-written tests + tests kept from tickets).
      testLibrary: path.resolve(ROOT_DIR, env.ORCA_TEST_LIBRARY_DIR || 'qa-tests'),
      public: path.join(ROOT_DIR, 'public'),
    },
    llm: {
      // 'mock' (deterministic heuristics, no network) | 'anthropic'
      provider: env.ORCA_LLM_PROVIDER || 'mock',
      model: env.ORCA_LLM_MODEL || 'claude-opus-5-5',
      effort: env.ORCA_LLM_EFFORT || 'medium',
      maxTokens: int(env.ORCA_LLM_MAX_TOKENS, 16000),
    },
    jira: {
      mode: env.JIRA_MODE || 'mock', // 'mock' | 'cloud'
      baseUrl: env.JIRA_BASE_URL || null,
      email: env.JIRA_EMAIL || null,
      apiToken: env.JIRA_API_TOKEN || null,
      projectKey: env.JIRA_PROJECT_KEY || 'SHOP',
      jql: env.JIRA_JQL || null,
      acceptanceCriteriaField: env.JIRA_AC_FIELD || null,
      defectIssueType: env.JIRA_DEFECT_ISSUE_TYPE || 'Bug',
      pollIntervalMs: int(env.JIRA_POLL_INTERVAL_MS, 30000),
      autoTrigger: bool(env.JIRA_AUTO_TRIGGER, false),
      triggerStatus: env.JIRA_TRIGGER_STATUS || 'Ready for QA',
    },
    github: {
      mode: env.GITHUB_TOKEN && env.GITHUB_REPO ? 'rest' : 'local',
      token: env.GITHUB_TOKEN || null,
      repo: env.GITHUB_REPO || null, // owner/name
      branch: env.GITHUB_BRANCH || 'main',
      localSourceDir: path.resolve(ROOT_DIR, env.ORCA_CODE_DIR || 'demo-app'),
    },
    ci: {
      mode: env.GITHUB_TOKEN && env.GITHUB_REPO && bool(env.CI_USE_GITHUB_ACTIONS, false) ? 'github-actions' : 'mock',
    },
    target: {
      baseUrl: env.ORCA_TARGET_BASE_URL || 'http://127.0.0.1:4100',
      // Test environments (dev, QA, staging…) with their own URL and variables. Optional.
      environmentsFile: path.resolve(ROOT_DIR, env.ORCA_ENVIRONMENTS_FILE || 'orca.environments.json'),
      startDemoApp: bool(env.ORCA_START_DEMO_APP, true),
      demoAppPort: int(env.DEMO_APP_PORT, 4100),
    },
    playwright: {
      timeoutMs: int(env.PLAYWRIGHT_RUN_TIMEOUT_MS, 180000),
      testTimeoutMs: int(env.PLAYWRIGHT_TEST_TIMEOUT_MS, 10000),
      workers: int(env.PLAYWRIGHT_WORKERS, 2),
      simulate: bool(env.PLAYWRIGHT_SIMULATE, false),
    },
    orchestrator: {
      maxConcurrentRuns: int(env.ORCA_MAX_CONCURRENT_RUNS, 3),
      defaultAgentConcurrency: int(env.ORCA_AGENT_CONCURRENCY, 2),
      defaultTaskTimeoutMs: int(env.ORCA_TASK_TIMEOUT_MS, 240000),
      defaultRetries: int(env.ORCA_TASK_RETRIES, 1),
    },
    mcp: {
      configFile: path.resolve(ROOT_DIR, env.ORCA_MCP_CONFIG || 'orca.mcp.json'),
    },
  };
  return deepMerge(config, overrides);
}

function deepMerge(target, source) {
  for (const [k, v] of Object.entries(source || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') {
      deepMerge(target[k], v);
    } else {
      target[k] = v;
    }
  }
  return target;
}
