import path from 'node:path';
import { createJiraClient } from './jira/index.js';
import { createCodeContext } from './code-context.js';
import { createCI } from './ci.js';
import { Environments } from './environments.js';
import { PlaywrightRunner } from './playwright-runner.js';
import { TestLibrary } from './test-library.js';

/** Builds every external integration from config. Agents receive this object as ctx.integrations. */
export function createIntegrations(config, { store }) {
  const environments = new Environments({ file: config.target.environmentsFile, fallbackBaseUrl: config.target.baseUrl, store });
  return {
    jira: createJiraClient(config, { store }),
    codeContext: createCodeContext(config),
    ci: createCI(config, { store, environments }),
    environments,
    /** The active environment's application. Use environments.target(name) for a specific one. */
    get targetApp() {
      return environments.target();
    },
    testLibrary: new TestLibrary({
      dir: config.paths.testLibrary,
      cli: config.playwright.simulate ? null : path.join(config.paths.root, 'node_modules', '@playwright', 'test', 'cli.js'),
      workDir: path.join(config.paths.workspace, 'library'),
    }),
    playwright: new PlaywrightRunner({ rootDir: config.paths.root, ...config.playwright }),
  };
}
