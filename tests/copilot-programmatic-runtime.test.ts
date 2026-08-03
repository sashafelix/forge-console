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

test('Copilot agent ID comes from the selected filename, not display-name frontmatter', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /resolveCopilotAgentId/);
  assert.match(runtime, /stripMarkdownSuffix\(path\.basename\(worktreeAgentPath\)\)/);
  assert.match(runtime, /`--agent=\$\{selectedAgent\}`/);
  assert.doesNotMatch(runtime, /declaredName \|\| stripMarkdownSuffix/);
  assert.match(runtime, /The optional\s*\n\s*\/\/ frontmatter `name` field is display text/);
});

test('Copilot receives explicit repository MCP configuration in prompt mode', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP = 'true'/);
  assert.match(runtime, /`--additional-mcp-config=@\$\{mcp\.path\}`/);
  assert.match(runtime, /--allow-all-mcp-server-instructions/);
  assert.match(runtime, /for \(const server of mcp\.serverNames\) allowedPermissions\.add\(server\)/);
  assert.match(runtime, /'--add-dir', launch\.agentSourceRoot/);
});

test('Copilot permission flags use permission kinds rather than implementation tool names', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /new Set<string>\(\['read'\]\)/);
  assert.match(runtime, /allowedPermissions\.add\('write'\)/);
  assert.match(runtime, /allowedPermissions\.add\('shell'\)/);
  assert.match(runtime, /repeatedOption\('--allow-tool', allowedPermissions\)/);
  assert.match(runtime, /repeatedOption\('--deny-tool', deniedPermissions\)/);
  assert.match(runtime, /`--secret-env-vars=\$\{secrets\.join\(','\)\}`/);

  assert.doesNotMatch(runtime, /allowedPermissions\.add\('view'\)/);
  assert.doesNotMatch(runtime, /allowedPermissions\.add\('grep'\)/);
  assert.doesNotMatch(runtime, /allowedPermissions\.add\('glob'\)/);
  assert.doesNotMatch(runtime, /allowedPermissions\.add\('ask_user'\)/);
  assert.doesNotMatch(runtime, /allowedPermissions\.add\('task'\)/);
  assert.doesNotMatch(runtime, /--no-ask-user/);
  assert.doesNotMatch(runtime, /--available-tools=/);
});
