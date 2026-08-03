import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverAgents } from '../src/main/agents';

const RGR_STYLE_ORCHESTRATOR = `---
name: ai-pipeline-rgr-orchestrator
description: Executes the portable RGR software pack locally.
---

# RGR Orchestrator

Execute PREPARE → RED → GREEN → REFACTOR → VERIFY → CONVERGE.
Invoke only the declared stage owner.

\`\`\`bash
python3 scripts/validate-pack.py packs/rgr-software-v2/pack.json
\`\`\`
`;

test('orchestrators infer delegation, shell and worktree-write requirements', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orchestrator-library-'));
  try {
    const directory = path.join(root, '.claude', 'agents');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'ai-pipeline-rgr-orchestrator.md'), RGR_STYLE_ORCHESTRATOR, 'utf8');

    const [orchestrator] = await discoverAgents(root);
    assert.ok(orchestrator.tools.some((tool) => tool.toLowerCase() === 'task'));
    assert.ok(orchestrator.tools.some((tool) => tool.toLowerCase() === 'bash'));
    assert.ok(orchestrator.tools.some((tool) => tool.toLowerCase() === 'write'));
    assert.equal(orchestrator.shellRequested, true);
    assert.equal(orchestrator.writeRequested, true);
    assert.ok(orchestrator.requestedCapabilities.includes('command.execute'));
    assert.ok(orchestrator.requestedCapabilities.includes('repository.write'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
