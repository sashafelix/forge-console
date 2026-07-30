import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type {
  CreateRunDraftRequest,
  PipelineManifest,
  PreviewRun,
  RunEvent,
  RunEventType
} from '../shared/contracts';
import { spawnRuntimePreview } from './runtime';

interface ActiveRun {
  child: ChildProcessWithoutNullStreams;
  record: PreviewRun;
  cancelRequested: boolean;
}

function runRoot(): string {
  return path.join(app.getPath('userData'), 'runs');
}

function assertRunId(runId: string): void {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new Error('Invalid run id');
}

function sanitizeInputs(manifest: PipelineManifest, inputs: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(inputs)) {
    sanitized[name] = manifest.inputSchema.properties[name]?.secret ? '[REDACTED]' : value;
  }
  return sanitized;
}

export function buildPreviewPrompt(manifest: PipelineManifest, request: CreateRunDraftRequest): string {
  const inputs = sanitizeInputs(manifest, request.inputs);
  const stages = [...manifest.stages]
    .sort((a, b) => a.order - b.order)
    .map((stage) => `${stage.order}. ${stage.name} (${stage.role}): ${stage.description}`)
    .join('\n');

  return [
    `You are performing a read-only preview for the pipeline "${manifest.name}" version ${manifest.version}.`,
    'Do not modify files, write configuration, create branches, execute destructive commands, publish output, or claim that implementation occurred.',
    'Inspect only what the runtime permits in plan/read-only mode.',
    '',
    `Project: ${request.project.name}`,
    `Project root: ${request.project.path}`,
    `Pipeline id: ${manifest.id}`,
    `Requested runtime: ${request.runtimeId}`,
    '',
    'Pipeline inputs:',
    JSON.stringify(inputs, null, 2),
    '',
    'Declared stages:',
    stages,
    '',
    'Return a concise structured assessment containing:',
    '- summary of the requested outcome;',
    '- likely affected areas;',
    '- proposed stage-by-stage approach;',
    '- material risks and missing information;',
    '- clarifying questions that should block execution.',
    '',
    'This is a preview only. End without changing the repository.'
  ].join('\n');
}

function lineConsumer(onLine: (line: string) => void): (chunk: Buffer) => void {
  let buffered = '';
  return (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(line);
  };
}

export class PreviewRunController {
  private readonly active = new Map<string, ActiveRun>();

  async start(
    request: CreateRunDraftRequest,
    manifest: PipelineManifest,
    emitToRenderer: (event: RunEvent) => void
  ): Promise<PreviewRun> {
    if (!manifest.supportedRuntimes.includes(request.runtimeId)) {
      throw new Error(`Pipeline ${manifest.id} does not support runtime ${request.runtimeId}`);
    }
    if (!request.project.isGitRepository) throw new Error('Preview runs currently require a Git repository');

    const id = randomUUID();
    const storagePath = path.join(runRoot(), id);
    await fs.mkdir(storagePath, { recursive: true });

    const sanitizedRequest: CreateRunDraftRequest = {
      ...request,
      inputs: sanitizeInputs(manifest, request.inputs)
    };
    const now = new Date().toISOString();
    const record: PreviewRun = {
      ...sanitizedRequest,
      id,
      createdAt: now,
      updatedAt: now,
      status: 'starting',
      storagePath
    };

    const recordPath = path.join(storagePath, 'run.json');
    const eventPath = path.join(storagePath, 'events.jsonl');
    let sequence = 0;
    let writeQueue = Promise.resolve();
    let finalised = false;

    const persistRecord = () => {
      record.updatedAt = new Date().toISOString();
      writeQueue = writeQueue.then(() => fs.writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8'));
    };
    const publish = (type: RunEventType, message: string, payload?: unknown) => {
      const event: RunEvent = {
        runId: id,
        sequence: ++sequence,
        timestamp: new Date().toISOString(),
        type,
        message,
        payload
      };
      writeQueue = writeQueue.then(() => fs.appendFile(eventPath, `${JSON.stringify(event)}\n`, 'utf8'));
      emitToRenderer(event);
    };
    const finish = (status: PreviewRun['status'], type: RunEventType, message: string, exitCode?: number, error?: string) => {
      if (finalised) return;
      finalised = true;
      record.status = status;
      record.exitCode = exitCode;
      record.error = error;
      persistRecord();
      publish(type, message, { exitCode, error });
      this.active.delete(id);
    };

    persistRecord();
    publish('run.started', `Starting read-only preview with ${request.runtimeId}`);

    try {
      const prompt = buildPreviewPrompt(manifest, sanitizedRequest);
      await fs.writeFile(path.join(storagePath, 'prompt.txt'), prompt, 'utf8');
      const child = await spawnRuntimePreview(request.runtimeId, request.project.path, prompt);
      record.status = 'running';
      persistRecord();
      const active: ActiveRun = { child, record, cancelRequested: false };
      this.active.set(id, active);

      child.stdout.on('data', lineConsumer((line) => publish('runtime.stdout', line)));
      child.stderr.on('data', lineConsumer((line) => publish('runtime.stderr', line)));
      child.once('error', (error) => finish('failed', 'run.failed', error.message, undefined, error.message));
      child.once('close', (code, signal) => {
        if (active.cancelRequested) {
          finish('cancelled', 'run.cancelled', `Preview cancelled${signal ? ` by ${signal}` : ''}`, code ?? undefined);
        } else if (code === 0) {
          finish('completed', 'run.completed', 'Preview completed', 0);
        } else {
          finish('failed', 'run.failed', `Runtime exited with code ${code ?? 'unknown'}`, code ?? undefined);
        }
      });

      return { ...record };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      finish('failed', 'run.failed', message, undefined, message);
      await writeQueue;
      throw error;
    }
  }

  async get(runId: string): Promise<PreviewRun | null> {
    assertRunId(runId);
    const active = this.active.get(runId);
    if (active) return { ...active.record };
    try {
      return JSON.parse(await fs.readFile(path.join(runRoot(), runId, 'run.json'), 'utf8')) as PreviewRun;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  cancel(runId: string): boolean {
    assertRunId(runId);
    const active = this.active.get(runId);
    if (!active) return false;
    active.cancelRequested = true;
    return active.child.kill();
  }
}
