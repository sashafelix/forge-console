import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('interactive reply API crosses contracts, preload and IPC', async () => {
  const contracts = await source('src/shared/contracts.ts');
  const channels = await source('src/shared/channels.ts');
  const preload = await source('src/main/preload.ts');
  const ipc = await source('src/main/ipc.ts');

  assert.match(contracts, /waiting_for_input/);
  assert.match(contracts, /replyToAgentExecution/);
  assert.match(channels, /replyToAgentExecution: 'agents:reply-execution'/);
  assert.match(preload, /replyToAgentExecution: \(request: ReplyToAgentExecutionRequest\)/);
  assert.match(ipc, /IPC_CHANNELS\.replyToAgentExecution/);
  assert.match(ipc, /agentRuns\.reply\(request/);
  assert.match(ipc, /agentRuns\.getLatest\(\)/);
  assert.match(ipc, /agentRuns\.getEvents\(runId\)/);
});

test('provider runtime loads repository MCP configuration and supports session resume', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /\.github', 'mcp\.json'/);
  assert.match(runtime, /--mcp-config/);
  assert.match(runtime, /--add-dir/);
  assert.match(runtime, /--resume/);
  assert.match(runtime, /mcp__\$\{server\}__\*/);
  assert.doesNotMatch(runtime, /--no-ask-user/);
});

test('controller pauses for questions, resumes the session and rejects empty false success', async () => {
  const controller = await source('src/main/agent-execution-controller.ts');

  assert.match(controller, /status = 'waiting_for_input'/);
  assert.match(controller, /providerSessionId/);
  assert.match(controller, /interaction\.requested/);
  assert.match(controller, /interaction\.replied/);
  assert.match(controller, /spawnAgentRuntime/);
  assert.match(controller, /workflow produced none of its declared artefacts/);
  assert.match(controller, /without producing a result, asking a question, or changing any files/);
  assert.match(controller, /```agent-input/);
  assert.match(controller, /```agent-result/);
});

test('guided workbench renders conversation, choices and reply controls', async () => {
  const workbench = await source('src/renderer/TaskWorkbench.tsx');
  const styles = await source('src/renderer/interactive-runs.css');

  assert.match(workbench, /Your input is needed/);
  assert.match(workbench, /task-conversation/);
  assert.match(workbench, /pendingQuestion\.choices/);
  assert.match(workbench, /Send answer and continue/);
  assert.match(workbench, /replyToAgentExecution/);
  assert.match(workbench, /Shape a new Jira story/);
  assert.match(styles, /task-reply-panel/);
  assert.match(styles, /task-message\.user/);
});
