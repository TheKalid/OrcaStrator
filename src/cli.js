#!/usr/bin/env node
/**
 * CLI: run the MVP workflow headless.
 *   node src/cli.js run SHOP-102 [--approve|--reject]
 *   node src/cli.js run --all            # every "Ready for QA" ticket, in parallel
 */
import { createOrca } from './app.js';
import { startDemoApp } from '../demo-app/server.js';

const [, , command, ...args] = process.argv;
if (command !== 'run') {
  console.log('Usage: node src/cli.js run <TICKET-KEY...>|--all [--approve|--reject]');
  process.exit(1);
}
const decision = args.includes('--approve') ? true : args.includes('--reject') ? false : null;

const orca = await createOrca();
const demo = orca.config.target.startDemoApp ? await startDemoApp({ port: orca.config.target.demoAppPort }) : null;

orca.bus.on('approval.requested', (e) => {
  const a = e.payload;
  console.log(`\n⏸  Approval required: ${a.title}\n${a.summary}\n`);
  if (decision === null) console.log('   (use --approve or --reject to decide from the CLI; rejecting by default)');
  orca.approvals.decide(a.id, { approved: decision === true, decidedBy: 'cli' });
});

let keys = args.filter((a) => !a.startsWith('--'));
if (args.includes('--all')) keys = (await orca.integrations.jira.searchTickets({ statuses: [orca.config.jira.triggerStatus] })).map((t) => t.key);
if (!keys.length) {
  console.error('No ticket keys given');
  process.exit(1);
}

const runs = keys.map((ticketKey) => orca.startRun('jira-to-qa-report', { ticketKey }, { trigger: 'cli' }));
const finished = await Promise.all(runs.map((r) => r.done));
console.log('\n================ RESULTS ================');
for (const run of finished) {
  console.log(`${run.label.padEnd(10)} ${run.status.padEnd(10)} ${run.output ? `${run.output.verdict} · pass rate ${Math.round(run.output.passRate * 100)}% · defects ${run.output.defectsCreated.map((d) => d.key).join(', ') || '-'}` : run.error?.message}`);
}
await orca.shutdown();
demo?.close();
process.exit(finished.every((r) => r.status === 'succeeded') ? 0 : 1);
