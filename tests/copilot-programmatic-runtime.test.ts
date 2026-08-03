import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('Copilot receives the prompt as an argument instead of closed stdin', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /supports\(capabilities, '--prompt'\)/);
  assert.match(runtime, /args\.push\('-p', customAgentPrompt\(launch\.prompt\)\)/);
  assert.match(runtime, /if \(launch\.runtimeId === 'claude-code'\) child\.stdin\.end\(launch\.prompt, 'utf8'\);/);
  assert.match(runtime, /else child\.stdin\.end\(\);/);
});

test('Copilot agent ID comes from the selected filename', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /resolveCopilotAgentId/);
  assert.match(runtime, /stripMarkdownSuffix\(path\.basename\(worktreeAgentPath\)\)/);
  assert.match(runtime, /`--agent=\$\{selectedAgent\}`/);
  assert.doesNotMatch(runtime, /declaredName \|\| stripMarkdownSuffix/);
});

test('Copilot receives repository MCP configuration only through supported flags', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP = 'true'/);
  assert.match(runtime, /requireOption\(capabilities, '--additional-mcp-config'/);
  assert.match(runtime, /`--additional-mcp-config=@\$\{mcp\.path\}`/);
  assert.match(runtime, /optionalFlag\(args, capabilities, '--allow-all-mcp-server-instructions'\)/);
  assert.match(runtime, /for \(const server of mcp\.serverNames\) allowedPermissions\.add\(server\)/);
});

test('Copilot permissions use one comma-separated value for enterprise CLI compatibility', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /new Set<string>\(\['read'\]\)/);
  assert.match(runtime, /allowedPermissions\.add\('write'\)/);
  assert.match(runtime, /allowedPermissions\.add\('shell'\)/);
  assert.match(runtime, /`--allow-tool=\$\{\[\.\.\.allowedPermissions\]\.join\(','\)\}`/);
  assert.match(runtime, /`--deny-tool=\$\{\[\.\.\.deniedPermissions\]\.join\(','\)\}`/);
  assert.doesNotMatch(runtime, /repeatedOption/);
  assert.doesNotMatch(runtime, /allowedPermissions\.add\('view'\)/);
  assert.doesNotMatch(runtime, /allowedPermissions\.add\('ask_user'\)/);
});

test('Copilot optional flags are negotiated from the installed CLI help', async () => {
  const runtime = await source('src/main/agent-runtime.ts');

  assert.match(runtime, /spawn\(executable, \['--help'\]/);
  assert.match(runtime, /collectHelpCapabilities/);
  assert.match(runtime, /const options = new Set\(output\.match/);
  assert.match(runtime, /optionalFlag\(args, capabilities, '--no-banner'\)/);
  assert.match(runtime, /optionalFlag\(args, capabilities, '--no-remote-export'\)/);
  assert.match(runtime, /supports\(capabilities, '--secret-env-vars'\)/);
  assert.match(runtime, /does not support \$\{option\}/);
});
