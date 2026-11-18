import fs from 'node:fs';
import path from 'node:path';
import { Ticket } from '../../core/contracts.js';
import { now } from '../../core/util.js';

/**
 * In-memory Jira backed by fixtures/jira/issues.json. Runtime changes (status
 * transitions, comments, created defects) are persisted in the JSON store so
 * they survive restarts. It also offers `simulateActivity()` to exercise the
 * Jira Monitoring Agent without a real Jira instance.
 */
export class MockJiraClient {
  mode = 'mock';

  constructor({ fixturesDir, store, projectKey }) {
    this.store = store;
    this.projectKey = projectKey;
    const seed = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'jira', 'issues.json'), 'utf8'));
    for (const issue of seed) {
      if (!this.store.get('jira_mock', issue.key)) this.store.set('jira_mock', issue.key, issue);
    }
  }

  #normalize(issue) {
    return Ticket.parse({ ...issue, url: `mock://jira/browse/${issue.key}` });
  }

  async searchTickets({ statuses, maxResults = 50, types } = {}) {
    return this.store
      .list('jira_mock')
      .filter((i) => !statuses?.length || statuses.includes(i.status))
      .filter((i) => !types?.length || types.includes(i.type))
      .sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }))
      .slice(0, maxResults)
      .map((i) => this.#normalize(i));
  }

  async getTicket(key) {
    const issue = this.store.get('jira_mock', key);
    if (!issue) throw Object.assign(new Error(`Jira issue ${key} not found`), { code: 'NOT_FOUND', retryable: false, status: 404 });
    return this.#normalize(issue);
  }

  async createIssue({ summary, description, issueType = 'Bug', priority = 'High', labels = [], linkTo }) {
    const nums = this.store.list('jira_mock').map((i) => Number(i.key.split('-')[1]) || 0);
    const key = `${this.projectKey}-${Math.max(100, ...nums) + 1}`;
    const issue = {
      key, summary, description, acceptanceCriteria: '', type: issueType, status: 'Open', priority,
      labels: [...new Set(['orca', ...labels])], assignee: null, updated: now(),
      comments: [], links: linkTo ? [{ type: 'relates to', key: linkTo }] : [],
    };
    this.store.set('jira_mock', key, issue);
    if (linkTo) await this.addComment(linkTo, `ORCA linked defect ${key}: ${summary}`);
    return { key, url: `mock://jira/browse/${key}` };
  }

  async addComment(key, body, author = 'ORCA') {
    const issue = this.store.get('jira_mock', key);
    if (!issue) throw Object.assign(new Error(`Jira issue ${key} not found`), { retryable: false });
    const comment = { id: `c${(issue.comments?.length || 0) + 1}`, author, body, created: now() };
    this.store.set('jira_mock', key, { ...issue, comments: [...(issue.comments || []), comment], updated: now() });
    return { id: comment.id };
  }

  async transition(key, status) {
    const issue = this.store.get('jira_mock', key);
    if (!issue) throw Object.assign(new Error(`Jira issue ${key} not found`), { retryable: false });
    this.store.set('jira_mock', key, { ...issue, status, updated: now() });
  }

  /** Mock-only: produce a realistic change so the monitor has something to detect. */
  async simulateActivity() {
    const issues = this.store.list('jira_mock').filter((i) => i.type !== 'Bug');
    const inProgress = issues.find((i) => i.status === 'In Progress');
    if (inProgress) {
      await this.transition(inProgress.key, 'Ready for QA');
      await this.addComment(inProgress.key, 'Development finished, moving to QA.', inProgress.assignee || 'Developer');
      return { key: inProgress.key, change: 'status: In Progress → Ready for QA' };
    }
    const target = issues[Math.floor(Math.random() * issues.length)];
    await this.addComment(target.key, 'Product owner: please also verify this on mobile viewport.', 'Product Owner');
    return { key: target.key, change: 'new comment' };
  }

  /** Mock-only: restore fixtures (drops created defects and runtime changes). */
  reset(fixturesDir) {
    for (const i of this.store.list('jira_mock')) this.store.delete('jira_mock', i.key);
    const seed = JSON.parse(fs.readFileSync(path.join(fixturesDir, 'jira', 'issues.json'), 'utf8'));
    for (const issue of seed) this.store.set('jira_mock', issue.key, issue);
  }
}
