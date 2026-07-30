import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  CreateRunDraftRequest,
  ExecutionRun,
  PipelineManifest,
  PipelineValidationCommand,
  ProcessRuntimeId,
  RunEvent,
  RunEventType,
  ValidationCommandResult
} from '../shared/contracts';
import { readPipelineTextAsset, type ResolvedPipelinePack } from './packs';
import {
  findExecutable,
  requiresCommandShell,
  runtimeSearchPath,
  spawnRuntimeExecution
} from './runtime';
import {
  createIsolatedWorktree,
  discardPreparedWorktree,
  type PreparedWorktree
} from './worktrees';

const MAX_EVENT_LINE_CHARS = 16_384;
const MAX_OUTPUT_EVENTS = 5_000;
const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/i;

interface ActiveExecution {
  child: ChildProcessWithoutNullStreams;
  record: ExecutionRun;
  cancelRequested: boolean;
}

interface EventWriter {
  publish(type: RunEventType, message: string, payload?: unknown): void;
  publishOutput(type: 'runtime.stdout' | 'runtime.stderr' | 'validation.stdout' | 'validation.stderr', message: string): void;
  flush(): Promise<void>;
}

function runRoot(): string {
  return path.join(app.getPath('userData'), 'runs');
}

function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error('Invalid run id');
}

function isProcessRuntimeId(value: string): value is ProcessRuntimeId {
  return value === 'claude-code' || value === 'github-copilot';
}

function sanitizeInputs(manifest: PipelineManifest, inputs: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(inputs).map(([name, value]) => [name, manifest.inputSchema.properties[name]?.secret ? '[REDACTED]' : value])
  );
}

function atomicJsonWrite(target: string, value: unknown): Promise<void> {
  return (async () => {
    await fs.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp-${randomUUID()}`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, target);
    } catch (error) {
      await fs.rm(temporary, { force: true });
      throw error;
    }
  })();
}

async function lastEventSequence(eventPath: string): Promise<number> {
  try {
    const lines = (await fs.readFile(eventPath, 'utf8')).split(/\r?\n/).filter(Boolean);
    if (lines.length === 0) return 0;
    const event = JSON.parse(lines.at(-1) ?? '{}') as { sequence?: unknown };
    return Number.isInteger(event.sequence) ? Number(event.sequence) : 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
}

async function createEventWriter(
  runId: string,
  storagePath: string,
  emitToRenderer: (event: RunEvent) => void
): Promise<EventWriter> {
  const eventPath = path.join(storagePath, 'events.jsonl');
  let sequence = await lastEventSequence(eventPath);
  let writeQueue = Promise.resolve();
  let outputEvents = 0;
  let truncationPublished = false;

  const publish = (type: RunEventType, message: string, payload?: unknown) => {
    const event: RunEvent = {
      runId,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      type,
      message: message.slice(0, MAX_EVENT_LINE_CHARS),
      payload
    };
    writeQueue = writeQueue.then(() => fs.appendFile(eventPath, `${JSON.stringify(event)}\n`, 'utf8'));
    emitToRenderer(event);
  };

  return {
    publish,
    publishOutput(type, message) {
      if (outputEvents < MAX_OUTPUT_EVENTS) {
        outputEvents += 1;
        publish(type, message);
      } else if (!truncationPublished) {
        truncationPublished = true;
        publish('runtime.stderr', `Output event limit of ${MAX_OUTPUT_EVENTS} reached; additional provider or validation output was omitted.`);
      }
    },
    flush: () => writeQueue
  };
}

function createLineConsumer(onLine: (line: string) => void): { push(chunk: Buffer): void; flush(): void } {
  let buffered = '';
  return {
    push(chunk: Buffer) {
      buffered += chunk.toString('utf8');
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';
      for (const line of lines) if (line.trim()) onLine(line);
    },
    flush() {
      if (buffered.trim()) onLine(buffered);
      buffered = '';
    }
  };
}

function renderExecutionPrompt(
  template: string,
  manifest: PipelineManifest,
  request: CreateRunDraftRequest,
  workingDirectory: string
): string {
  const values: Record<string, string> = {
    pipelineName: manifest.name,
    pipelineVersion: manifest.version,
    projectName: request.project.name,
    workingDirectory,
    inputsJson: JSON.stringify(request.inputs, null, 2),
    stages: [...manifest.stages]
      .sort((a, b) => a.order - b.order)
      .map((stage) => `${stage.order}. ${stage.name} (${stage.role}): ${stage.description}`)
      .join('\n')
  };

  const unknown = new Set<string>();
  const rendered = template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g, (_match, key: string) => {
    if (!(key in values)) {
      unknown.add(key);
      return '';
    }
    return values[key];
  });
  if (unknown.size > 0) throw new Error(`Unknown prompt template placeholders: ${[...unknown].sort().join(', ')}`);

  return [
    rendered.trim(),
    '',
    'Mandatory execution guardrails:',
    `- Work only inside the current working directory: ${workingDirectory}`,
    '- Do not access or modify files outside the isolated Git worktree.',
    '- Do not modify .git metadata, create commits, push branches, merge, publish, deploy, or access production systems.',
    '- Shell and network tools are intentionally unavailable. Do not attempt to bypass those restrictions.',
    '- Make only changes required by the supplied pipeline inputs and declared stages.',
    '- The desktop controller will run the exact declared validation commands after your session.',
    '- Finish with a concise summary of changed files, decisions, risks, and anything that remains incomplete.'
  ].join('\n');
}

function ensureWithin(root: string, candidate: string, label: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes the isolated worktree`);
  }
  return resolvedCandidate;
}

async function resolveRealWithin(root: string, candidate: string, label: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  const realCandidate = await fs.realpath(candidate);
  return ensureWithin(realRoot, realCandidate, label);
}

async function resolveValidationExecutable(
  command: PipelineValidationCommand,
  cwd: string,
  worktreePath: string
): Promise<string> {
  const configured = process.platform === 'win32' && command.windowsExecutable
    ? command.windowsExecutable
    : command.executable;
  if (path.isAbsolute(configured)) throw new Error(`Validation executable must not be absolute: ${configured}`);

  if (configured.includes('/') || configured.includes('\\') || configured.startsWith('.')) {
    const candidate = await resolveRealWithin(worktreePath, path.resolve(cwd, configured), 'Validation executable');
    const details = await fs.lstat(candidate);
    if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Validation executable must be a regular file: ${configured}`);
    await fs.access(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return candidate;
  }

  const executable = await findExecutable([configured]);
  if (!executable) throw new Error(`Validation executable was not found: ${configured}`);
  return executable;
}

function runValidationCommand(
  executable: string,
  command: PipelineValidationCommand,
  cwd: string,
  writer: EventWriter,
  setChild: (child: ChildProcessWithoutNullStreams) => void,
  cancelled: () => boolean
): Promise<ValidationCommandResult> {
  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(executable, command.args, {
      cwd,
      env: { ...process.env, PATH: runtimeSearchPath(), NO_COLOR: '1', CI: '1' },
      shell: requiresCommandShell(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    setChild(child);

    const stdout = createLineConsumer((line) => writer.publishOutput('validation.stdout', `[${command.name}] ${line}`));
    const stderr = createLineConsumer((line) => writer.publishOutput('validation.stderr', `[${command.name}] ${line}`));
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, command.timeoutSeconds * 1_000);

    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      stdout.flush();
      stderr.flush();
      if (cancelled()) {
        reject(new Error('Execution cancelled'));
        return;
      }
      const exitCode = code ?? undefined;
      resolve({
        commandId: command.id,
        startedAt,
        completedAt: new Date().toISOString(),
        exitCode,
        timedOut,
        passed: !timedOut && exitCode === 0,
        required: command.required
      });
    });
  });
}

export class ExecutionController {
  private readonly active = new Map<string, ActiveExecution>();

  async prepare(
    request: CreateRunDraftRequest,
    pack: ResolvedPipelinePack,
    emitToRenderer: (event: RunEvent) => void
  ): Promise<ExecutionRun> {
    const execution = pack.manifest.execution;
    if (!execution) throw new Error(`Pipeline ${pack.manifest.id} does not declare an execution contract`);
    if (!isProcessRuntimeId(request.runtimeId)) throw new Error(`Runtime ${request.runtimeId} does not support isolated local execution`);
    if (!pack.manifest.supportedRuntimes.includes(request.runtimeId)) {
      throw new Error(`Pipeline ${pack.manifest.id} does not support runtime ${request.runtimeId}`);
    }

    const id = randomUUID();
    const storagePath = path.join(runRoot(), id);
    await fs.mkdir(storagePath, { recursive: true });
    const writer = await createEventWriter(id, storagePath, emitToRenderer);
    writer.publish('run.started', `Preparing isolated execution for ${pack.manifest.name}`);

    let worktree: PreparedWorktree | undefined;
    let committed = false;
    try {
      const sanitizedRequest: CreateRunDraftRequest = {
        ...request,
        inputs: sanitizeInputs(pack.manifest, request.inputs)
      };
      const template = await readPipelineTextAsset(pack, execution.promptTemplate);
      renderExecutionPrompt(template, pack.manifest, sanitizedRequest, '<isolated-worktree>');

      worktree = await createIsolatedWorktree(sanitizedRequest.project, id, sanitizedRequest.inputs);
      writer.publish('worktree.created', `Created isolated worktree ${worktree.branchName}`, {
        worktreePath: worktree.worktreePath,
        workingDirectory: worktree.workingDirectory,
        branchName: worktree.branchName,
        baseRevision: worktree.baseRevision
      });

      const prompt = renderExecutionPrompt(template, pack.manifest, sanitizedRequest, worktree.workingDirectory);
      await fs.writeFile(path.join(storagePath, 'prompt.txt'), prompt, { encoding: 'utf8', mode: 0o600 });

      const now = new Date().toISOString();
      const record: ExecutionRun = {
        ...sanitizedRequest,
        id,
        createdAt: now,
        updatedAt: now,
        status: 'awaiting_approval',
        storagePath,
        repositoryRoot: worktree.repositoryRoot,
        baseRevision: worktree.baseRevision,
        worktreePath: worktree.worktreePath,
        workingDirectory: worktree.workingDirectory,
        branchName: worktree.branchName,
        approvalRequired: true,
        runtimePolicy: {
          fileWrites: 'worktree-only',
          shell: 'denied-to-model',
          network: 'denied-to-model',
          maxTurns: execution.maxTurns,
          validationCommands: execution.validationCommands
        },
        validationResults: []
      };
      await atomicJsonWrite(path.join(storagePath, 'run.json'), record);
      writer.publish('approval.required', 'Execution is prepared and requires explicit operator approval.', {
        branchName: record.branchName,
        baseRevision: record.baseRevision,
        worktreePath: record.worktreePath,
        maxTurns: record.runtimePolicy.maxTurns,
        validationCommands: record.runtimePolicy.validationCommands
      });
      await writer.flush();
      committed = true;
      return record;
    } catch (error) {
      if (worktree && !committed) await discardPreparedWorktree(worktree);
      await fs.rm(path.join(storagePath, 'run.json'), { force: true });
      await fs.rm(path.join(storagePath, 'prompt.txt'), { force: true });
      const message = error instanceof Error ? error.message : String(error);
      writer.publish('run.failed', message);
      await writer.flush();
      throw error;
    }
  }

  async start(
    runId: string,
    pack: ResolvedPipelinePack,
    emitToRenderer: (event: RunEvent) => void
  ): Promise<ExecutionRun> {
    assertRunId(runId);
    if (this.active.has(runId)) throw new Error('Execution is already active');
    if (!pack.manifest.execution) throw new Error(`Pipeline ${pack.manifest.id} does not declare an execution contract`);

    const record = await this.get(runId);
    if (!record) throw new Error('Execution run was not found');
    if (record.pipelineId !== pack.manifest.id || record.pipelineVersion !== pack.manifest.version) {
      throw new Error('Installed pipeline no longer matches the prepared execution');
    }
    if (record.status !== 'awaiting_approval') throw new Error(`Execution cannot start from status ${record.status}`);
    if (!isProcessRuntimeId(record.runtimeId)) throw new Error(`Runtime ${record.runtimeId} does not support local execution`);

    const worktreePath = await fs.realpath(record.worktreePath);
    const workingDirectory = await resolveRealWithin(worktreePath, record.workingDirectory, 'Execution working directory');
    const prompt = await fs.readFile(path.join(record.storagePath, 'prompt.txt'), 'utf8');
    const writer = await createEventWriter(runId, record.storagePath, emitToRenderer);
    record.worktreePath = worktreePath;
    record.workingDirectory = workingDirectory;
    record.approvedAt = new Date().toISOString();
    record.updatedAt = record.approvedAt;
    record.status = 'running';
    await atomicJsonWrite(path.join(record.storagePath, 'run.json'), record);
    writer.publish('execution.started', `Approved execution started with ${record.runtimeId}`, {
      approvedAt: record.approvedAt,
      worktreePath: record.worktreePath,
      maxTurns: record.runtimePolicy.maxTurns
    });

    try {
      const child = await spawnRuntimeExecution(
        record.runtimeId,
        record.workingDirectory,
        prompt,
        record.runtimePolicy.maxTurns
      );
      const active: ActiveExecution = { child, record, cancelRequested: false };
      this.active.set(runId, active);

      const stdout = createLineConsumer((line) => writer.publishOutput('runtime.stdout', line));
      const stderr = createLineConsumer((line) => writer.publishOutput('runtime.stderr', line));
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', (error) => {
        void this.finishFailure(active, writer, error.message);
      });
      child.once('close', (code) => {
        stdout.flush();
        stderr.flush();
        if (active.cancelRequested) {
          void this.finishCancelled(active, writer, code ?? undefined);
        } else if (code !== 0) {
          void this.finishFailure(active, writer, `Runtime exited with code ${code ?? 'unknown'}`, code ?? undefined);
        } else {
          void this.validateAndFinish(active, writer);
        }
      });
      return { ...record };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.status = 'failed';
      record.error = message;
      record.updatedAt = new Date().toISOString();
      await atomicJsonWrite(path.join(record.storagePath, 'run.json'), record);
      writer.publish('run.failed', message);
      await writer.flush();
      throw error;
    }
  }

  async get(runId: string): Promise<ExecutionRun | null> {
    assertRunId(runId);
    const active = this.active.get(runId);
    if (active) return { ...active.record };
    try {
      return JSON.parse(await fs.readFile(path.join(runRoot(), runId, 'run.json'), 'utf8')) as ExecutionRun;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async cancel(runId: string, emitToRenderer: (event: RunEvent) => void): Promise<boolean> {
    assertRunId(runId);
    const active = this.active.get(runId);
    if (active) {
      active.cancelRequested = true;
      active.child.kill();
      return true;
    }

    const record = await this.get(runId);
    if (!record || record.status !== 'awaiting_approval') return false;
    const writer = await createEventWriter(runId, record.storagePath, emitToRenderer);
    await discardPreparedWorktree({
      repositoryRoot: record.repositoryRoot,
      worktreePath: record.worktreePath,
      workingDirectory: record.workingDirectory,
      branchName: record.branchName,
      baseRevision: record.baseRevision
    });
    record.status = 'cancelled';
    await this.persist(record);
    writer.publish('run.cancelled', 'Prepared execution was discarded before approval; its worktree and branch were removed.');
    await writer.flush();
    return true;
  }

  private async persist(record: ExecutionRun): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await atomicJsonWrite(path.join(record.storagePath, 'run.json'), record);
  }

  private async finishFailure(
    active: ActiveExecution,
    writer: EventWriter,
    message: string,
    exitCode?: number
  ): Promise<void> {
    if (!this.active.has(active.record.id)) return;
    active.record.status = 'failed';
    active.record.error = message;
    active.record.exitCode = exitCode;
    await this.persist(active.record);
    writer.publish('run.failed', message, { exitCode });
    await writer.flush();
    this.active.delete(active.record.id);
  }

  private async finishCancelled(active: ActiveExecution, writer: EventWriter, exitCode?: number): Promise<void> {
    if (!this.active.has(active.record.id)) return;
    active.record.status = 'cancelled';
    active.record.exitCode = exitCode;
    await this.persist(active.record);
    writer.publish('run.cancelled', 'Execution was cancelled by the operator.', { exitCode });
    await writer.flush();
    this.active.delete(active.record.id);
  }

  private async validateAndFinish(active: ActiveExecution, writer: EventWriter): Promise<void> {
    active.record.status = 'validating';
    active.record.exitCode = 0;
    await this.persist(active.record);
    writer.publish('validation.started', `Running ${active.record.runtimePolicy.validationCommands.length} declared validation command(s).`);

    try {
      for (const command of active.record.runtimePolicy.validationCommands) {
        if (active.cancelRequested) throw new Error('Execution cancelled');
        writer.publish('validation.started', `Starting validation: ${command.name}`, { commandId: command.id });
        const cwdCandidate = command.cwd && command.cwd !== '.'
          ? path.resolve(active.record.workingDirectory, command.cwd)
          : active.record.workingDirectory;
        const cwd = await resolveRealWithin(active.record.worktreePath, cwdCandidate, 'Validation working directory');
        const executable = await resolveValidationExecutable(command, cwd, active.record.worktreePath);
        const result = await runValidationCommand(
          executable,
          command,
          cwd,
          writer,
          (child) => { active.child = child; },
          () => active.cancelRequested
        );
        active.record.validationResults.push(result);
        await this.persist(active.record);
        writer.publish('validation.completed', `${command.name}: ${result.passed ? 'PASS' : 'FAIL'}`, result);
        if (result.required && !result.passed) {
          await this.finishFailure(active, writer, `Required validation failed: ${command.name}`, result.exitCode);
          return;
        }
      }

      active.record.status = 'completed';
      await this.persist(active.record);
      writer.publish('run.completed', 'Isolated execution and all required validations completed. Review the worktree before committing or publishing.', {
        worktreePath: active.record.worktreePath,
        branchName: active.record.branchName,
        validationResults: active.record.validationResults
      });
      await writer.flush();
      this.active.delete(active.record.id);
    } catch (error) {
      if (active.cancelRequested) {
        await this.finishCancelled(active, writer);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      await this.finishFailure(active, writer, message);
    }
  }
}
