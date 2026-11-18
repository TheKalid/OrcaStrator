import { Ticket } from '../../core/contracts.js';

/**
 * Jira Cloud REST v3 client (basic auth with email + API token).
 * Ready to use: set JIRA_MODE=cloud, JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN.
 * Optional: JIRA_AC_FIELD (custom field id holding acceptance criteria, e.g. customfield_10042).
 */
export class JiraCloudClient {
  mode = 'cloud';

  constructor({ baseUrl, email, apiToken, projectKey, jql, acceptanceCriteriaField, defectIssueType }) {
    if (!baseUrl || !email || !apiToken) {
      throw new Error('JIRA_MODE=cloud requires JIRA_BASE_URL, JIRA_EMAIL and JIRA_API_TOKEN');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.auth = `Basic ${Buffer.from(`${email}:${apiToken}`).toString('base64')}`;
    this.projectKey = projectKey;
    this.defaultJql = jql || `project = "${projectKey}" ORDER BY updated DESC`;
    this.acField = acceptanceCriteriaField;
    this.defectIssueType = defectIssueType;
  }

  async #request(method, path, body) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: this.auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw Object.assign(new Error(`Jira ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`), {
        status: res.status,
        retryable: res.status === 429 || res.status >= 500,
      });
    }
    return res.status === 204 ? null : res.json();
  }

  #fields() {
    return ['summary', 'description', 'status', 'issuetype', 'priority', 'labels', 'assignee', 'updated', 'comment', ...(this.acField ? [this.acField] : [])];
  }

  #normalize(issue) {
    const f = issue.fields;
    const description = adfToText(f.description);
    const ac = this.acField ? adfToText(f[this.acField]) : extractAcceptanceCriteria(description);
    return Ticket.parse({
      key: issue.key,
      summary: f.summary || '',
      description,
      acceptanceCriteria: ac,
      status: f.status?.name || 'Unknown',
      type: f.issuetype?.name || 'Story',
      priority: f.priority?.name || 'Medium',
      labels: f.labels || [],
      assignee: f.assignee?.displayName || null,
      comments: (f.comment?.comments || []).map((c) => ({ id: String(c.id), author: c.author?.displayName || 'unknown', body: adfToText(c.body), created: c.created })),
      updated: f.updated,
      url: `${this.baseUrl}/browse/${issue.key}`,
    });
  }

  async searchTickets({ jql, statuses, maxResults = 50 } = {}) {
    let query = jql || this.defaultJql;
    if (!jql && statuses?.length) {
      query = `project = "${this.projectKey}" AND status in (${statuses.map((s) => `"${s}"`).join(',')}) ORDER BY updated DESC`;
    }
    const data = await this.#request('POST', '/rest/api/3/search/jql', { jql: query, maxResults, fields: this.#fields() });
    return (data.issues || []).map((i) => this.#normalize(i));
  }

  async getTicket(key) {
    const data = await this.#request('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${this.#fields().join(',')}`);
    return this.#normalize(data);
  }

  async createIssue({ summary, description, issueType, priority, labels = [], linkTo }) {
    const created = await this.#request('POST', '/rest/api/3/issue', {
      fields: {
        project: { key: this.projectKey },
        summary,
        description: textToAdf(description),
        issuetype: { name: issueType || this.defectIssueType },
        ...(priority ? { priority: { name: priority } } : {}),
        labels: [...new Set(['orca', ...labels])],
      },
    });
    if (linkTo) {
      await this.#request('POST', '/rest/api/3/issueLink', {
        type: { name: 'Relates' },
        inwardIssue: { key: created.key },
        outwardIssue: { key: linkTo },
      });
    }
    return { key: created.key, url: `${this.baseUrl}/browse/${created.key}` };
  }

  async addComment(key, body) {
    const data = await this.#request('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: textToAdf(body) });
    return { id: String(data.id) };
  }
}

/** Atlassian Document Format → plain text (paragraphs, lists, code blocks, headings). */
export function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  const walk = (n) => {
    if (n.type === 'text') return n.text || '';
    if (n.type === 'hardBreak') return '\n';
    const inner = (n.content || []).map(walk).join('');
    switch (n.type) {
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
        return `${inner}\n\n`;
      case 'listItem':
        return `- ${inner.trim()}\n`;
      default:
        return inner;
    }
  };
  return walk(node).replace(/\n{3,}/g, '\n\n').trim();
}

export function textToAdf(text) {
  return {
    type: 'doc',
    version: 1,
    content: String(text || '')
      .split(/\n{2,}/)
      .map((para) => ({
        type: 'paragraph',
        content: para.split('\n').flatMap((line, i) => [...(i ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])]),
      })),
  };
}

/** When AC are embedded in the description, take everything from the first "Scenario:" or "Acceptance criteria" header. */
export function extractAcceptanceCriteria(description) {
  const idx = description.search(/^\s*(acceptance criteria\s*:?|scenario:)/im);
  return idx >= 0 ? description.slice(idx).replace(/^\s*acceptance criteria\s*:?\s*/i, '') : '';
}
