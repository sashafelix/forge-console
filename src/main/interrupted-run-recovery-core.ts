import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentExecutionRun, RunEvent } from '../shared/contracts';

const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const NON_RESUMABLE_ACTIVE_STATES = new Set(['preparing', 'running', 'validating']);

async function atomicJsonWrite(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function appendRecoveryEvent(runDirectory: string, runId: string, message: string): Promise<void> {
  const eventPath = path.join(runDirectory, 'events.jsonl');
  let sequence = 0;
  try {
    const lines = (await fs.readFile(eventPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    if (lines.length > 0) {
      const last = JSON.parse(lines.at(-1) ?? '{}') as { sequence?: unknown };
      if (Number.isInteger(last.sequence)) sequence = Number(last.sequence);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const event: RunEvent = {
    runId,
    sequence: sequence + 1,
    timestamp: new Date().toISOString(),
    type: 'run.failed',
    message
  };
  await fs.appendFile(eventPath, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
}

export async function recoverInterruptedRunsAtRoot(root: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }

  let recovered = 0;
  for (const runId of entries.filter((entry) => RUN_ID_PATTERN.test(entry))) {
    const runDirectory = path.join(root, runId);
    const recordPath = path.join(runDirectory, 'run.json');
    let record: AgentExecutionRun;
    try {
      record = JSON.parse(await fs.readFile(recordPath, 'utf8')) as AgentExecutionRun;
    } catch {
      continue;
    }

    if (!NON_RESUMABLE_ACTIVE_STATES.has(record.status)) continue;

    const previousStatus = record.status;
    const message = `The previous ${previousStatus.replaceAll('_', ' ')} task was interrupted when the desktop app stopped. Its isolated worktree was preserved so you can inspect any partial results.`;
    record.status = 'failed';
    record.updatedAt = new Date().toISOString();
    record.error = message;
    record.pendingQuestion = undefined;
    await atomicJsonWrite(recordPath, record);
    await appendRecoveryEvent(runDirectory, runId, message);
    recovered += 1;
  }

  return recovered;
}
