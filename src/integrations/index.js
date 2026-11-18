import { createJiraClient } from './jira/index.js';
import { createCodeContext } from './code-context.js';
import { createCI } from './ci.js';
import { TargetApp } from './target-app.js';
import { PlaywrightRunner } from './playwright-runner.js';

/** Builds every external integration from config. Agents receive this object as ctx.integrations. */
export function createIntegrations(config, { store }) {
  const targetApp = new TargetApp({ baseUrl: config.target.baseUrl });
  return {
    jira: createJiraClient(config, { store }),
    codeContext: createCodeContext(config),
    ci: createCI(config, { store, targetApp }),
    targetApp,
    playwright: new PlaywrightRunner({ rootDir: config.paths.root, ...config.playwright }),
  };
}
