import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverAgents, resolveAgentDefinition } from '../src/main/agents';

const SAMPLE_AGENT = `---
name: investigate-defect
version: '1.0.0'
description: >
  Investigate a Jira defect against a target code repository.
tools: ["bash", "view", "edit", "create", "grep", "glob", "ask_user"]
---

# Agent

Investigate **\${input:ticket}**.

## Writes
- \`defects/\${input:ticket}.md\`
- \`BASELINE-SCAN-REPORT.md\`

Run curl with $ATC_JIRA_TOKEN against https://jira.example.test.
`;

test('discovers agent metadata, inputs, permissions, writes and environment requirements', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-library-'));
  try {
    await mkdir(path.join(root, 'agents'));
    await writeFile(path.join(root, 'agents', 'investigate-defect.agent.md'), SAMPLE_AGENT, 'utf8');
    const agents = await discoverAgents(root);
    assert.equal(agents.length, 1);
    const agent = agents[0];
    assert.equal(agent.id, 'investigate-defect');
    assert.equal(agent.version, '1.0.0');
    assert.deepEqual(agent.inputs.map((input) => input.name), ['ticket']);
    assert.ok(agent.tools.includes('bash'));
    assert.ok(agent.requestedCapabilities.includes('jira.read'));
    assert.ok(agent.requestedCapabilities.includes('repository.write'));
    assert.equal(agent.shellRequested, true);
    assert.equal(agent.networkRequested, true);
    assert.deepEqual(agent.requiredEnvironment, ['ATC_JIRA_TOKEN']);
    assert.deepEqual(agent.writes, ['`defects/${input:ticket}.md`', '`BASELINE-SCAN-REPORT.md`']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects agent paths that escape the selected library', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-library-'));
  try {
    await assert.rejects(resolveAgentDefinition(root, '../outside.agent.md'), /escapes/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
