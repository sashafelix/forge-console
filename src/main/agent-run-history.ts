import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentExecutionRun, RunEvent } from '../shared/contracts';

const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const ACTIVE_STATUSES = new Set<AgentExecutionRun['status']>([
  'preparing',
  'awaiting_approval',
  'running',
  'validating'
]);

function runRoot(): string {
  return path.join(app.getPath('userData'), 'runs');
}

function isAgentRun(value: unknown): value is AgentExecutionRun {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<AgentExecutionRun>;
  return typeof record.id === 'string'
    && RUN_ID_PATTERN.test(record.id)
    && typeof record.agentName === 'string'
    && typeof record.agentSourcePath === 'string'
    && typeof record.updatedAt === 'string'
    && typeof record.status === 'string';
}

async function readAgentRun(runId: string): Promise<AgentExecutionRun | null> {
  if (!RUN_ID_PATTERN.test(runId)) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(runRoot(), runId, 'run.json'), 'utf8')) as unknown;
    return isAgentRun(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export async function getLatestAgentExecutionRun(): Promise<AgentExecutionRun | null> {
  let entries: string[];
  try {
    entries = await fs.readdir(runRoot());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  const records = (await Promise.all(entries.filter((entry) => RUN_ID_PATTERN.test(entry)).map(readAgentRun)))
    .filter((record): record is AgentExecutionRun => Boolean(record))
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));

  return records.find((record) => ACTIVE_STATUSES.has(record.status)) ?? records[0] ?? null;
}

export async function getAgentExecutionEvents(runId: string): Promise<RunEvent[]> {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('Invalid run id');
  try {
    const lines = (await fs.readFile(path.join(runRoot(), runId, 'events.jsonl'), 'utf8'))
      .split(/\r?\n/)
      .filter(Boolean);
    const events: RunEvent[] = [];
    for (const line of lines.slice(-2_000)) {
      try {
        const event = JSON.parse(line) as RunEvent;
        if (event.runId === runId && Number.isInteger(event.sequence)) events.push(event);
      } catch {
        // Ignore an incomplete final line while a run is still writing.
      }
    }
    return events;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}
