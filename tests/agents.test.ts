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

Run curl with $JIRA_TOKEN against https://jira.example.test.
`;

const ORCHESTRATOR = `---
name: story-orchestrator
version: '2.0.0'
description: Coordinate the complete Jira story review pipeline.
tools: ["view", "task"]
---

# Story Orchestrator

Coordinate the specialist agents and produce the final review.
Wait for operator approval before applying any Jira change.
`;

const STORY_INTAKE = `---
name: story-intake
version: '1.0.0'
description: Shape a new requirement through guided questions.
tools: ["view", "ask_user"]
---

# Story Intake

Ask one purposeful question at a time. Wait for the user response before continuing.
Freeze the completed intake snapshot before handing it to governed review.

## Writes
- \`docs/agent/intake/{intake_id}/snapshot.md\`
`;

const INPUT_FREE_SPECIALIST = `---
name: story-evaluator
version: '1.0.0'
description: Evaluate the supplied story using repository context.
tools: ["view", "grep"]
---

# Story evaluator

Evaluate the requested Jira story.
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
    assert.ok(agent.requestedCapabilities.includes('user.input'));
    assert.equal(agent.shellRequested, true);
    assert.equal(agent.networkRequested, true);
    assert.equal(agent.interactive, true);
    assert.deepEqual(agent.requiredEnvironment, ['JIRA_TOKEN']);
    assert.deepEqual(agent.writes, ['`defects/${input:ticket}.md`', '`BASELINE-SCAN-REPORT.md`']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('excludes README files and plain markdown without agent frontmatter', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-library-'));
  try {
    const directory = path.join(root, '.github', 'agents');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'README.md'), '# Agent documentation', 'utf8');
    await writeFile(path.join(directory, 'notes.md'), '# Notes', 'utf8');
    await writeFile(path.join(directory, 'valid.agent.md'), SAMPLE_AGENT, 'utf8');
    const agents = await discoverAgents(root);
    assert.deepEqual(agents.map((agent) => agent.id), ['investigate-defect']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('adds a required task input and frozen prompt placeholder for orchestrators', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-library-'));
  try {
    const directory = path.join(root, '.github', 'agents');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'story-orchestrator.agent.md'), ORCHESTRATOR, 'utf8');
    const agents = await discoverAgents(root);
    assert.equal(agents[0].name, 'story-orchestrator · Full pipeline');
    assert.equal(agents[0].interactive, true);
    assert.deepEqual(agents[0].inputs.map((input) => input.name), ['task']);
    const resolved = await resolveAgentDefinition(root, '.github/agents/story-orchestrator.agent.md');
    assert.match(resolved.source, /\$\{input:task\}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detects guided story intake as an interactive agent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-library-'));
  try {
    const directory = path.join(root, '.github', 'agents');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'story-intake.agent.md'), STORY_INTAKE, 'utf8');
    const [agent] = await discoverAgents(root);
    assert.equal(agent.id, 'story-intake');
    assert.equal(agent.interactive, true);
    assert.ok(agent.requestedCapabilities.includes('user.input'));
    assert.deepEqual(agent.inputs.map((input) => input.name), ['task']);
    assert.deepEqual(agent.writes, ['`docs/agent/intake/{intake_id}/snapshot.md`']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('gives input-free specialist agents a simple task field', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-library-'));
  try {
    const directory = path.join(root, '.github', 'agents');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'story-evaluator.agent.md'), INPUT_FREE_SPECIALIST, 'utf8');
    const agents = await discoverAgents(root);
    assert.deepEqual(agents[0].inputs.map((input) => input.name), ['task']);
    assert.equal(agents[0].inputs[0].title, 'Task');
    assert.equal(agents[0].interactive, false);
    const resolved = await resolveAgentDefinition(root, '.github/agents/story-evaluator.agent.md');
    assert.match(resolved.source, /## Operator task/);
    assert.match(resolved.source, /\$\{input:task\}/);
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
