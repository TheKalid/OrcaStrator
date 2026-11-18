import { z } from 'zod';
import { BaseAgent } from '../core/agent.js';
import { Ticket } from '../core/contracts.js';

/**
 * Jira Monitoring Agent
 * Watches Jira for new tickets, status transitions and comments; fetches tickets
 * for workflows and files defects (a sensitive action, always behind approval).
 */
export class JiraMonitorAgent extends BaseAgent {
  constructor() {
    super({
      id: 'jira-monitor',
      name: 'Jira Monitoring Agent',
      description: 'Continuously monitors Jira tickets, status changes, comments and new requirements.',
      tags: ['jira', 'monitoring'],
      concurrency: 4,
    });

    this.action('getTicket', { input: z.object({ ticketKey: z.string() }), output: Ticket, description: 'Fetch one ticket' }, async ({ ticketKey }, ctx) => {
      const ticket = await ctx.integrations.jira.getTicket(ticketKey);
      ctx.memory.run.set('ticket', ticket);
      ctx.trace([{ id: ticket.key, type: 'ticket', label: `${ticket.key} ${ticket.summary}`, data: { status: ticket.status, url: ticket.url, priority: ticket.priority } }]);
      ctx.log.info(`Fetched ${ticket.key} "${ticket.summary}" [${ticket.status}]`);
      return ticket;
    });

    this.action(
      'poll',
      {
        input: z.object({ statuses: z.array(z.string()).optional() }).default({}),
        output: z.object({
          scanned: z.number(),
          changes: z.array(z.object({ key: z.string(), kind: z.enum(['new', 'status_changed', 'commented', 'updated']), from: z.string().nullable(), to: z.string().nullable(), summary: z.string() })),
        }),
        description: 'Detect changes since the previous poll',
      },
      async ({ statuses }, ctx) => {
        const tickets = await ctx.integrations.jira.searchTickets({ statuses, maxResults: 100 });
        const snapshot = ctx.memory.global.get('jira.snapshot', {});
        const first = Object.keys(snapshot).length === 0;
        const changes = [];
        for (const t of tickets) {
          const prev = snapshot[t.key];
          if (!prev) {
            if (!first) changes.push({ key: t.key, kind: 'new', from: null, to: t.status, summary: t.summary });
          } else if (prev.status !== t.status) {
            changes.push({ key: t.key, kind: 'status_changed', from: prev.status, to: t.status, summary: t.summary });
          } else if (prev.comments !== t.comments.length) {
            const last = t.comments[t.comments.length - 1];
            changes.push({ key: t.key, kind: 'commented', from: null, to: null, summary: `${last?.author}: ${last?.body?.slice(0, 120)}` });
          } else if (prev.updated !== t.updated) {
            changes.push({ key: t.key, kind: 'updated', from: null, to: null, summary: t.summary });
          }
          snapshot[t.key] = { status: t.status, comments: t.comments.length, updated: t.updated };
        }
        ctx.memory.global.set('jira.snapshot', snapshot);
        for (const c of changes) {
          ctx.emit('jira.change', c);
          ctx.log.info(`Jira change ${c.key}: ${c.kind}${c.to ? ` → ${c.to}` : ''}`);
        }
        return { scanned: tickets.length, changes };
      },
    );

    this.action(
      'createDefects',
      {
        input: z.object({
          ticketKey: z.string(),
          defects: z.array(z.object({ testId: z.string(), executionId: z.string(), summary: z.string(), description: z.string(), severity: z.string() })),
        }),
        output: z.object({ created: z.array(z.object({ key: z.string(), url: z.string(), testId: z.string() })) }),
        description: 'File defects in Jira linked to the story (requires approval)',
        sensitive: true,
      },
      async ({ ticketKey, defects }, ctx) => {
        const created = [];
        for (const d of defects) {
          const issue = await ctx.integrations.jira.createIssue({
            summary: d.summary,
            description: `${d.description}\n\nDetected by ORCA from test ${d.testId} (execution ${d.executionId}).`,
            issueType: ctx.config.jira.defectIssueType,
            priority: { critical: 'Highest', high: 'High', medium: 'Medium', low: 'Low' }[d.severity] || 'High',
            labels: ['qa-automation'],
            linkTo: ticketKey,
          });
          created.push({ ...issue, testId: d.testId });
          ctx.trace([{ id: issue.key, type: 'defect', label: `${issue.key} ${d.summary}`, data: { url: issue.url, severity: d.severity } }], [{ from: `inv:${d.executionId}:${d.testId}`, to: issue.key, rel: 'reported_as' }]);
          ctx.log.info(`Created defect ${issue.key} for ${d.testId}`);
        }
        return { created };
      },
    );
  }
}
