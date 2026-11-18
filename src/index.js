import { createOrca, startJiraMonitoring } from './app.js';
import { createApi } from './server/api.js';
import { startDemoApp } from '../demo-app/server.js';

const orca = await createOrca();
const { config } = orca;

const demo = config.target.startDemoApp ? await startDemoApp({ port: config.target.demoAppPort }) : null;
const tick = startJiraMonitoring(orca);
tick(); // take the initial Jira snapshot right away

const server = createApi(orca).listen(config.server.port, config.server.host, () => {
  orca.logger.info(`ORCA dashboard: http://${config.server.host}:${config.server.port}`);
  orca.logger.info(`LLM provider: ${orca.llm.name} · Jira: ${orca.integrations.jira.mode} · Playwright: ${orca.integrations.playwright.mode}`);
});

const shutdown = async () => {
  orca.logger.info('Shutting down...');
  server.close();
  demo?.close();
  await orca.shutdown();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
