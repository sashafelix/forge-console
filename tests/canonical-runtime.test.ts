import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildClaudeArgs, buildCopilotArgs, type AgentRuntimeLaunch } from '../src/main/agent-runtime';
import { createCopilotAgentOverlay } from '../src/main/copilot-agent-overlay';
import { requireNativeAgentExecutable } from '../src/main/agent-library-paths';

test('Windows agent runs reject batch shells before prompt or discovery JSON can be interpreted as commands', () => {
  for (const executable of ['C:\\Tools\\claude.cmd', 'C:\\Tools\\copilot.BAT']) {
    assert.throws(() => requireNativeAgentExecutable(executable, 'win32'), /native CLI .exe/);
  }
  assert.doesNotThrow(() => requireNativeAgentExecutable('C:\\Program Files\\Copilot\\copilot.exe', 'win32'));
  assert.doesNotThrow(() => requireNativeAgentExecutable('/usr/local/bin/claude', 'darwin'));
});

async function fixture(context: { after: (callback: () => Promise<unknown>) => void }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'canonical-runtime-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'); const worktree = path.join(root, 'worktree');
  await fs.mkdir(path.join(source, 'agents'), { recursive: true }); await fs.mkdir(worktree);
  const content = '---\nname: reviewer\ndescription: Review a change.\n---\nRead skills/skill-review/SKILL.md.\n';
  await fs.writeFile(path.join(source, 'agents/reviewer.md'), content);
  const launch: AgentRuntimeLaunch = { runtimeId: 'github-copilot', cwd: worktree, agentSourceRoot: source,
    agentRelativePath: 'agents/reviewer.md', prompt: 'Context\n## Operator task\nReview example.', maxTurns: 10,
    permissions: { allowWrite: false, allowShell: false }, requestedTools: ['Task'], environment: {} };
  return { root, source, worktree, content, launch };
}

test('Claude discovers canonical roles for the session without model or permission overrides', async (context) => {
  const { source, launch } = await fixture(context);
  const args = await buildClaudeArgs({ ...launch, runtimeId: 'claude-code' });
  const definitions = JSON.parse(args[args.indexOf('--agents') + 1]);
  assert.deepEqual(Object.keys(definitions), ['reviewer']);
  assert.match(definitions.reviewer.prompt, /AGENTS\.md/);
  assert.ok(definitions.reviewer.prompt.includes(path.join(source, 'agents/reviewer.md')));
  assert.deepEqual(Object.keys(definitions.reviewer).sort(), ['description', 'prompt']);
  assert.equal(args[args.indexOf('--disallowedTools') + 1], 'WebFetch,WebSearch,Write,Edit,Bash');
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'Read,Glob,Grep,Task');
  assert.equal(args[args.indexOf('--add-dir') + 1], source);
  await assert.rejects(fs.stat(path.join(source, '.claude')), /ENOENT/);
});

test('Copilot selects the canonical agent, masks stale copies and restores the target', async (context) => {
  const { source, worktree, content, launch } = await fixture(context);
  const stale = '.claude/agents/reviewer.md';
  const generated = '.github/agents/reviewer.agent.md';
  await fs.mkdir(path.dirname(path.join(worktree, stale)), { recursive: true });
  await fs.writeFile(path.join(worktree, stale), 'stale target prompt');
  const overlay = await createCopilotAgentOverlay(source, worktree);
  try {
    assert.deepEqual(overlay.copiedFiles, [path.normalize(generated)]);
    await assert.rejects(fs.stat(path.join(worktree, stale)), /ENOENT/);
    const adapter = await fs.readFile(path.join(worktree, generated), 'utf8');
    assert.ok(adapter.includes(path.join(source, 'agents/reviewer.md')));
    assert.match(adapter, /skills\/.*SKILL\.md/);
    const args = await buildCopilotArgs(launch);
    assert.ok(args.includes('--agent=reviewer'));
    assert.ok(args.includes('--allow-tool=read'));
    assert.ok(args.includes('--deny-tool=url,memory,write,shell'));
    assert.equal(args[args.indexOf('--add-dir') + 1], source);
    assert.equal(args[args.indexOf('--prompt') + 1], '## Operator task\nReview example.');
    await assert.rejects(buildCopilotArgs(launch, { options: new Set(['--agent', '--allow-tool', '--deny-tool']), helpText: '' }), /--add-dir/);
  } finally { overlay.cleanup(); }
  assert.equal(await fs.readFile(path.join(worktree, stale), 'utf8'), 'stale target prompt');
  await assert.rejects(fs.stat(path.join(worktree, generated)), /ENOENT/);
  assert.equal(await fs.readFile(path.join(source, 'agents/reviewer.md'), 'utf8'), content);
  await assert.rejects(fs.stat(path.join(source, '.github')), /ENOENT/);
});

test('Copilot overlay refuses target ancestor symlinks before writing', async (context) => {
  const { root, source, worktree } = await fixture(context);
  const outside = path.join(root, 'outside'); await fs.mkdir(outside);
  await fs.symlink(outside, path.join(worktree, '.github'), 'junction');
  await assert.rejects(createCopilotAgentOverlay(source, worktree), /symlinks/);
  assert.deepEqual(await fs.readdir(outside), []);
});
