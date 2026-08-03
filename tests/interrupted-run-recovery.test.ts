import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recoverInterruptedRunsAtRoot } from '../src/main/interrupted-run-recovery-core';

async function writeRun(root: string, id: string, status: string, worktreePath: string): Promise<void> {
  const directory = path.join(root, id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'run.json'), `${JSON.stringify({
    id,
    status,
    updatedAt: '2026-08-03T08:00:00.000Z',
    worktreePath,
    pendingQuestion: status === 'waiting_for_input' ? { id: 'question-1', question: 'What outcome is required?', choices: [], allowFreeText: true } : undefined
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(directory, 'events.jsonl'), `${JSON.stringify({
    runId: id,
    sequence: 4,
    timestamp: '2026-08-03T08:00:00.000Z',
    type: 'execution.started',
    message: 'Runtime started.'
  })}\n`, 'utf8');
}

test('marks orphaned running runs as failed while preserving worktrees and resumable questions', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'agent-pipeline-recovery-'));
  const runsRoot = path.join(temporary, 'runs');
  const worktreesRoot = path.join(temporary, 'worktrees');
  const runningId = '11111111-1111-4111-8111-111111111111';
  const waitingId = '22222222-2222-4222-8222-222222222222';
  const runningWorktree = path.join(worktreesRoot, runningId);
  const waitingWorktree = path.join(worktreesRoot, waitingId);

  try {
    await mkdir(runningWorktree, { recursive: true });
    await mkdir(waitingWorktree, { recursive: true });
    await writeRun(runsRoot, runningId, 'running', runningWorktree);
    await writeRun(runsRoot, waitingId, 'waiting_for_input', waitingWorktree);

    assert.equal(await recoverInterruptedRunsAtRoot(runsRoot), 1);

    const running = JSON.parse(await readFile(path.join(runsRoot, runningId, 'run.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(running.status, 'failed');
    assert.match(String(running.error), /interrupted when the desktop app stopped/i);
    assert.equal(running.pendingQuestion, undefined);
    assert.equal((await stat(runningWorktree)).isDirectory(), true);

    const events = (await readFile(path.join(runsRoot, runningId, 'events.jsonl'), 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(events.at(-1)?.sequence, 5);
    assert.equal(events.at(-1)?.type, 'run.failed');

    const waiting = JSON.parse(await readFile(path.join(runsRoot, waitingId, 'run.json'), 'utf8')) as Record<string, unknown>;
    assert.equal(waiting.status, 'waiting_for_input');
    assert.ok(waiting.pendingQuestion);
    assert.equal((await stat(waitingWorktree)).isDirectory(), true);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('returns zero when the run directory does not exist', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'agent-pipeline-recovery-'));
  try {
    assert.equal(await recoverInterruptedRunsAtRoot(path.join(temporary, 'missing')), 0);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
