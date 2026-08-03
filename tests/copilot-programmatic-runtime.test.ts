import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Copilot receives the prompt through -p instead of closed stdin', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /'-p', customAgentPrompt\(launch\.prompt\)/);
  assert.match(runtime, /if \(launch\.runtimeId === 'claude-code'\) child\.stdin\.end\(launch\.prompt, 'utf8'\);/);
  assert.match(runtime, /else child\.stdin\.end\(\);/);
  assert.doesNotMatch(runtime, /child\.stdin\.end\(launch\.prompt, 'utf8'\);\s*return child;/);
});

test('Copilot selects repository agents and supplies repository MCP explicitly', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /resolveCopilotAgentName/);
  assert.match(runtime, /`--agent=\$\{selectedAgent\}`/);
  assert.match(runtime, /`--additional-mcp-config=@\$\{mcp\.path\}`/);
  assert.match(runtime, /--allow-all-mcp-server-instructions/);
  assert.match(runtime, /for \(const server of mcp\.serverNames\) allowedTools\.add\(server\)/);
  assert.match(runtime, /'--add-dir', launch\.agentSourceRoot/);
});

test('Copilot programmatic permissions allow questions and redact injected secrets', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /allowedTools\.add\('ask_user'\)/);
  assert.match(runtime, /allowedTools\.add\('task'\)/);
  assert.match(runtime, /`--secret-env-vars=\$\{secrets\.join\(','\)\}`/);
  assert.doesNotMatch(runtime, /--no-ask-user/);
  assert.doesNotMatch(runtime, /--available-tools=/);
});
