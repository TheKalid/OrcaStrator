import { z } from 'zod';

/**
 * Structured communication contracts shared by the orchestrator and every agent.
 * All messages crossing an agent boundary are validated against these schemas,
 * so agents can be added or replaced independently as long as they honor them.
 */

export const TaskStatus = z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting_approval', 'rejected', 'cancelled']);
export const RunStatus = z.enum(['queued', 'running', 'waiting_approval', 'succeeded', 'failed', 'cancelled']);

export const TraceNodeType = z.enum(['ticket', 'requirement', 'acceptance_criterion', 'test', 'execution', 'investigation', 'defect', 'report']);

export const TraceNode = z.object({
  id: z.string(),
  type: TraceNodeType,
  label: z.string(),
  data: z.record(z.string(), z.any()).optional(),
});

export const TraceEdge = z.object({
  from: z.string(),
  to: z.string(),
  rel: z.string(), // e.g. 'derives', 'verifies', 'executed_as', 'investigated_by', 'reported_as'
});

/** Message sent from the orchestrator to an agent. */
export const AgentTask = z.object({
  id: z.string(),
  runId: z.string().nullable(),
  stepId: z.string().nullable(),
  agentId: z.string(),
  action: z.string(),
  input: z.any(),
  attempt: z.number().int().min(1).default(1),
  createdAt: z.string(),
});

/** Message returned from an agent to the orchestrator. */
export const AgentResult = z.object({
  taskId: z.string(),
  agentId: z.string(),
  action: z.string(),
  status: z.enum(['succeeded', 'failed']),
  output: z.any().optional(),
  error: z.object({ message: z.string(), code: z.string().optional(), retryable: z.boolean().optional() }).optional(),
  trace: z.object({ nodes: z.array(TraceNode).default([]), edges: z.array(TraceEdge).default([]) }).optional(),
  metrics: z.object({ durationMs: z.number(), llmCalls: z.number().default(0), tokensIn: z.number().default(0), tokensOut: z.number().default(0) }),
  startedAt: z.string(),
  finishedAt: z.string(),
});

export const ApprovalRequest = z.object({
  id: z.string(),
  runId: z.string(),
  stepId: z.string(),
  agentId: z.string(),
  action: z.string(),
  title: z.string(),
  summary: z.string(),
  payload: z.any(),
  status: z.enum(['pending', 'approved', 'rejected']),
  decidedBy: z.string().nullable(),
  comment: z.string().nullable(),
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Domain payloads exchanged by the initial agents
// ---------------------------------------------------------------------------

export const Ticket = z.object({
  key: z.string(),
  summary: z.string(),
  description: z.string().default(''),
  acceptanceCriteria: z.string().default(''),
  status: z.string(),
  type: z.string().default('Story'),
  priority: z.string().default('Medium'),
  labels: z.array(z.string()).default([]),
  assignee: z.string().nullable().default(null),
  comments: z.array(z.object({ id: z.string(), author: z.string(), body: z.string(), created: z.string() })).default([]),
  updated: z.string(),
  url: z.string().nullable().default(null),
});

export const AcceptanceCriterion = z.object({
  id: z.string(),
  title: z.string(),
  given: z.array(z.string()),
  when: z.array(z.string()),
  then: z.array(z.string()),
});

export const Requirement = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(['ui', 'api', 'mixed']),
  priority: z.enum(['low', 'medium', 'high', 'critical']),
  acceptanceCriteria: z.array(AcceptanceCriterion),
  testable: z.boolean(),
  notes: z.array(z.string()),
});

export const RequirementAnalysis = z.object({
  ticketKey: z.string(),
  userStory: z.object({ asA: z.string(), iWant: z.string(), soThat: z.string() }).nullable(),
  requirements: z.array(Requirement),
  ambiguities: z.array(z.string()),
  source: z.enum(['heuristic', 'llm']),
});

export const GeneratedTest = z.object({
  id: z.string(), // e.g. SHOP-102-AC1
  requirementId: z.string(),
  acceptanceCriterionId: z.string(),
  title: z.string(),
  kind: z.enum(['ui', 'api']),
  file: z.string(),
  code: z.string(),
  unsupportedSteps: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const TestGenerationResult = z.object({
  ticketKey: z.string(),
  suiteDir: z.string(),
  files: z.array(z.string()),
  tests: z.array(GeneratedTest),
  source: z.enum(['heuristic', 'llm']),
});

export const TestCaseResult = z.object({
  testId: z.string(),
  title: z.string(),
  file: z.string(),
  status: z.enum(['passed', 'failed', 'timedOut', 'skipped', 'interrupted']),
  durationMs: z.number(),
  startedAt: z.string().nullable().default(null),
  error: z.object({ message: z.string(), stack: z.string().optional(), snippet: z.string().optional() }).nullable(),
  attachments: z.array(z.object({ name: z.string(), path: z.string().optional(), contentType: z.string() })).default([]),
});

export const ExecutionResult = z.object({
  executionId: z.string(),
  ticketKey: z.string(),
  environment: z.string(),
  baseUrl: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  durationMs: z.number(),
  mode: z.enum(['playwright', 'simulated']),
  summary: z.object({ total: z.number(), passed: z.number(), failed: z.number(), skipped: z.number(), flaky: z.number() }),
  results: z.array(TestCaseResult),
  rawReportPath: z.string().nullable(),
});

export const FailureCategory = z.enum(['product_defect', 'automation_issue', 'environment_issue', 'test_data_issue', 'unknown']);

export const Investigation = z.object({
  testId: z.string(),
  title: z.string(),
  category: FailureCategory,
  confidence: z.number().min(0).max(1),
  rootCause: z.string(),
  evidence: z.array(z.string()),
  correlatedLogs: z.array(z.string()),
  suggestedActions: z.array(z.string()),
  signature: z.string(),
  recurring: z.boolean(),
  occurrences: z.number(),
  proposedDefect: z.object({ summary: z.string(), description: z.string(), severity: z.enum(['low', 'medium', 'high', 'critical']) }).nullable(),
});

export const FailureAnalysisResult = z.object({
  ticketKey: z.string(),
  executionId: z.string(),
  investigations: z.array(Investigation),
  source: z.enum(['heuristic', 'llm']),
});

export const QAReport = z.object({
  reportId: z.string(),
  ticketKey: z.string(),
  generatedAt: z.string(),
  verdict: z.enum(['ready_for_release', 'blocked', 'needs_attention']),
  summary: z.string(),
  metrics: z.object({
    requirements: z.number(),
    acceptanceCriteria: z.number(),
    testsGenerated: z.number(),
    testsExecuted: z.number(),
    passed: z.number(),
    failed: z.number(),
    passRate: z.number(),
    acCoverage: z.number(),
  }),
  defects: z.array(z.object({ testId: z.string(), category: FailureCategory, summary: z.string() })),
  automationGaps: z.array(z.string()),
  recurringIssues: z.array(z.string()),
  recommendations: z.array(z.string()),
  markdownPath: z.string(),
  markdown: z.string(),
});
