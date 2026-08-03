import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverAgents } from '../src/main/agents';

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('pipeline-prefixed specialist agents are not promoted to full pipelines', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'pipeline-classification-'));
  try {
    const directory = path.join(root, '.claude', 'agents');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'ai-pipeline-brainstorm.md'), `---
name: ai-pipeline-brainstorm
description: Refines a request into success criteria. Orchestrator-invoked only and redirects if called directly.
---

# Brainstorm

Refine the operator request before planning.
`, 'utf8');
    await writeFile(path.join(directory, 'ai-pipeline-rgr-orchestrator.md'), `---
name: ai-pipeline-rgr-orchestrator
description: Owns the complete governed workflow.
---

# RGR Orchestrator

## Stage execution

PREPARE → RED → GREEN → REFACTOR → VERIFY → CONVERGE.
For each stage, invoke only the declared owner.
`, 'utf8');

    const agents = await discoverAgents(root);
    const brainstorm = agents.find((agent) => agent.id === 'ai-pipeline-brainstorm');
    const orchestrator = agents.find((agent) => agent.id === 'ai-pipeline-rgr-orchestrator');

    assert.ok(brainstorm);
    assert.ok(orchestrator);
    assert.doesNotMatch(brainstorm.name, /Full pipeline/i);
    assert.match(orchestrator.name, /Full pipeline/i);
    assert.ok(orchestrator.tools.some((tool) => tool.toLowerCase() === 'task'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the guided workbench uses the explicit Full pipeline marker', async () => {
  const workbench = await source('src/renderer/TaskWorkbench.tsx');

  assert.match(workbench, /full pipeline/i);
  assert.match(workbench, /test\(agent\.name\)/);
  assert.doesNotMatch(workbench, /orchestrat\|pipeline\|workflow/);
});

test('provider readiness is checked before an agent worktree is prepared', async () => {
  const ipc = await source('src/main/ipc.ts');
  const runtime = await source('src/main/runtime.ts');
  const handler = ipc.slice(ipc.indexOf('IPC_CHANNELS.prepareAgentExecution'), ipc.indexOf('IPC_CHANNELS.approveAndStartAgentExecution'));

  assert.ok(handler.indexOf('preflightRuntimeSession') >= 0);
  assert.ok(handler.indexOf('agentRuns.prepare') > handler.indexOf('preflightRuntimeSession'));
  assert.match(runtime, /PREFLIGHT_CACHE_MS/);
  assert.match(runtime, /Claude Code is installed, but its sign-in is not usable/);
  assert.match(runtime, /readiness check timed out/);
});

test('Advanced loads a complete light-theme override after legacy styles', async () => {
  const main = await source('src/renderer/main.tsx');
  const light = await source('src/renderer/advanced-light.css');

  assert.ok(main.indexOf("'./advanced-light.css'") > main.indexOf("'./styles.css'"));
  for (const selector of ['.sidebar', '.content', '.form-panel', '.approval-panel', '.run-console']) {
    assert.match(light, new RegExp(`advanced-workbench-shell \\${selector}`));
  }
  assert.match(light, /color-scheme:\s*light/);
});
