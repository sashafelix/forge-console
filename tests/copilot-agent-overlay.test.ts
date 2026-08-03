import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCopilotAgentOverlay } from '../src/main/copilot-agent-overlay';

test('local uncommitted agents are overlaid and removed after the run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-overlay-'));
  const source = path.join(root, 'source');
  const worktree = path.join(root, 'worktree');
  try {
    await mkdir(path.join(source, '.github', 'agents'), { recursive: true });
    await mkdir(worktree, { recursive: true });
    await writeFile(path.join(source, '.github', 'agents', 'story-intake.agent.md'), '# local intake\n', 'utf8');

    const overlay = await createCopilotAgentOverlay(source, worktree);
    assert.deepEqual(overlay.copiedFiles, [path.join('.github', 'agents', 'story-intake.agent.md')]);
    assert.equal(await readFile(path.join(worktree, '.github', 'agents', 'story-intake.agent.md'), 'utf8'), '# local intake\n');

    overlay.cleanup();
    await assert.rejects(readFile(path.join(worktree, '.github', 'agents', 'story-intake.agent.md'), 'utf8'), /ENOENT/);
    overlay.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('overlaid committed agents are restored byte-for-byte after the run', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'copilot-overlay-'));
  const source = path.join(root, 'source');
  const worktree = path.join(root, 'worktree');
  const relative = path.join('.github', 'agents', 'story-orchestrator.agent.md');
  try {
    await mkdir(path.join(source, '.github', 'agents'), { recursive: true });
    await mkdir(path.join(worktree, '.github', 'agents'), { recursive: true });
    await writeFile(path.join(source, relative), '# improved local orchestrator\n', 'utf8');
    await writeFile(path.join(worktree, relative), '# committed orchestrator\n', 'utf8');

    const overlay = await createCopilotAgentOverlay(source, worktree);
    assert.equal(await readFile(path.join(worktree, relative), 'utf8'), '# improved local orchestrator\n');

    overlay.cleanup();
    assert.equal(await readFile(path.join(worktree, relative), 'utf8'), '# committed orchestrator\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
