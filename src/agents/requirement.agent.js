import { z } from 'zod';
import { BaseAgent } from '../core/agent.js';
import { Ticket, RequirementAnalysis } from '../core/contracts.js';

const SYSTEM = `You are a senior QA analyst. Convert a Jira ticket into structured, testable requirements.
Rules:
- Keep acceptance criteria in Given/When/Then form. Each step is one short imperative phrase.
- Prefer the controlled step vocabulary used by the test generator when the ticket allows it:
  I am on the "<page>" page | I am logged in | I fill "<test-id>" with "<value>" | I click "<test-id>" |
  I should see "<text>" | I should be on the "<page>" page | "<test-id>" should show "<text>" |
  I send a GET|POST|PUT|DELETE request to "<path>" | the response status should be <n> |
  the response should contain <n> items | each item should have "<field>", "<field>" | the response field "<field>" should be "<value>"
- Never invent behavior that is not supported by the ticket. List anything unclear as an ambiguity.
- A requirement is testable only if it has at least one acceptance criterion with an observable outcome.`;

/**
 * Requirement Agent
 * Reads tickets / documentation and produces structured user stories,
 * acceptance criteria and testable requirements.
 */
export class RequirementAgent extends BaseAgent {
  constructor() {
    super({
      id: 'requirement',
      name: 'Requirement Agent',
      description: 'Converts tickets and documentation into structured user stories, acceptance criteria and testable requirements.',
      tags: ['analysis', 'requirements'],
    });

    this.action('analyze', { input: z.object({ ticket: Ticket }), output: RequirementAnalysis, description: 'Analyze a Jira ticket' }, async ({ ticket }, ctx) => {
      let analysis = null;
      if (ctx.llm.available) {
        try {
          const LlmShape = RequirementAnalysis.omit({ source: true, ticketKey: true });
          const out = await ctx.llm.generateObject({
            system: SYSTEM,
            prompt: `Ticket ${ticket.key} (${ticket.type}, priority ${ticket.priority})\nSummary: ${ticket.summary}\n\nDescription:\n${ticket.description}\n\nAcceptance criteria:\n${ticket.acceptanceCriteria || '(none provided)'}\n\nComments:\n${ticket.comments.map((c) => `- ${c.author}: ${c.body}`).join('\n') || '(none)'}\n\nUse requirement ids ${ticket.key}-R1, ${ticket.key}-R2... and criterion ids ${ticket.key}-AC1, ${ticket.key}-AC2... (numbered across the ticket).`,
            schema: LlmShape,
          });
          analysis = { ...out, ticketKey: ticket.key, source: 'llm' };
        } catch (err) {
          ctx.log.warn(`LLM analysis failed, using heuristic parser: ${err.message}`);
        }
      }
      analysis ||= heuristicAnalysis(ticket);
      analysis = RequirementAnalysis.parse(analysis);

      ctx.memory.run.set('requirements', analysis);
      const nodes = [];
      const edges = [];
      for (const r of analysis.requirements) {
        nodes.push({ id: r.id, type: 'requirement', label: r.title, data: { kind: r.kind, priority: r.priority, testable: r.testable } });
        edges.push({ from: analysis.ticketKey, to: r.id, rel: 'derives' });
        for (const ac of r.acceptanceCriteria) {
          nodes.push({ id: ac.id, type: 'acceptance_criterion', label: ac.title, data: { given: ac.given, when: ac.when, then: ac.then } });
          edges.push({ from: r.id, to: ac.id, rel: 'specifies' });
        }
      }
      ctx.trace(nodes, edges);
      const acCount = analysis.requirements.reduce((n, r) => n + r.acceptanceCriteria.length, 0);
      ctx.log.info(`${analysis.requirements.length} requirement(s), ${acCount} acceptance criteria, ${analysis.ambiguities.length} ambiguities (${analysis.source})`);
      return analysis;
    });
  }
}

/** Deterministic parser for "As a / I want / So that" stories and Gherkin scenarios. */
export function heuristicAnalysis(ticket) {
  const text = `${ticket.description}\n`;
  const story = {
    asA: (text.match(/as an? ([^\n]+)/i) || [])[1]?.trim(),
    iWant: (text.match(/i want (?:to )?([^\n]+)/i) || [])[1]?.trim(),
    soThat: (text.match(/so that ([^\n]+)/i) || [])[1]?.trim().replace(/\.$/, ''),
  };
  const userStory = story.asA && story.iWant ? { asA: story.asA, iWant: story.iWant, soThat: story.soThat || '' } : null;

  const scenarios = [];
  let current = null;
  let section = 'given';
  for (const raw of (ticket.acceptanceCriteria || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const sc = line.match(/^scenario(?: outline)?:\s*(.+)$/i);
    if (sc) {
      current = { title: sc[1].trim(), given: [], when: [], then: [] };
      scenarios.push(current);
      section = 'given';
      continue;
    }
    const step = line.match(/^(given|when|then|and|but)\s+(.+)$/i);
    if (!step) continue;
    if (!current) {
      current = { title: ticket.summary, given: [], when: [], then: [] };
      scenarios.push(current);
    }
    const kw = step[1].toLowerCase();
    if (kw === 'given' || kw === 'when' || kw === 'then') section = kw;
    current[section].push(step[2].trim());
  }

  const ambiguities = [];
  if (!scenarios.length) ambiguities.push('No acceptance criteria in Given/When/Then form; the ticket cannot be verified automatically.');
  for (const vague of ['fast', 'good', 'user-friendly', 'intuitive', 'nice', 'quickly', 'easy']) {
    if (new RegExp(`\\b${vague}\\b`, 'i').test(text)) ambiguities.push(`Non-measurable term "${vague}" in the description; define an objective threshold.`);
  }
  scenarios.filter((s) => !s.then.length).forEach((s) => ambiguities.push(`Scenario "${s.title}" has no expected outcome (Then).`));

  const acs = scenarios.map((s, i) => ({ id: `${ticket.key}-AC${i + 1}`, ...s }));
  const isApi = (ac) => [...ac.given, ...ac.when].some((x) => /request to/i.test(x));
  const kinds = new Set(acs.map((ac) => (isApi(ac) ? 'api' : 'ui')));
  const priority = { highest: 'critical', critical: 'critical', high: 'high', medium: 'medium', low: 'low', lowest: 'low' }[ticket.priority.toLowerCase()] || 'medium';

  return {
    ticketKey: ticket.key,
    userStory,
    requirements: [
      {
        id: `${ticket.key}-R1`,
        title: ticket.summary,
        kind: kinds.size > 1 ? 'mixed' : kinds.has('api') ? 'api' : 'ui',
        priority,
        acceptanceCriteria: acs,
        testable: acs.some((ac) => ac.then.length > 0),
        notes: ticket.comments.map((c) => `${c.author}: ${c.body}`),
      },
    ],
    ambiguities,
    source: 'heuristic',
  };
}
