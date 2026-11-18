import { JiraMonitorAgent } from './jira-monitor.agent.js';
import { RequirementAgent } from './requirement.agent.js';
import { TestGenerationAgent } from './test-generation.agent.js';
import { DeploymentMonitorAgent } from './deployment-monitor.agent.js';
import { FailureAnalysisAgent } from './failure-analysis.agent.js';
import { ReportingAgent } from './reporting.agent.js';

/** Default agent roster. Add, remove or replace agents here (or at runtime via the registry). */
export function createDefaultAgents() {
  return [new JiraMonitorAgent(), new RequirementAgent(), new TestGenerationAgent(), new DeploymentMonitorAgent(), new FailureAnalysisAgent(), new ReportingAgent()];
}
