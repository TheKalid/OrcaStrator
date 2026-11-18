import { MockJiraClient } from './mock-client.js';
import { JiraCloudClient } from './cloud-client.js';

/**
 * Jira client interface (both implementations return normalized `Ticket` objects,
 * see core/contracts.js):
 *
 *   searchTickets({ jql?, statuses?, maxResults? }) -> Ticket[]
 *   getTicket(key)                                  -> Ticket
 *   createIssue({ summary, description, issueType, priority, labels, linkTo }) -> { key, url }
 *   addComment(key, body)                           -> { id }
 *
 * Switch to a real Jira Cloud site by setting JIRA_MODE=cloud plus
 * JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN (see .env.example).
 */
export function createJiraClient(config, { store }) {
  if (config.jira.mode === 'cloud') return new JiraCloudClient(config.jira);
  return new MockJiraClient({ fixturesDir: config.paths.fixtures, store, projectKey: config.jira.projectKey });
}
