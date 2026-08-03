import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AgentExecutionRequest,
  AgentExecutionRun,
  ProcessRuntimeId,
  RunEvent,
  RunEventType
} from '../shared/contracts';
import { resolveAgentDefinition } from './agents';
import { resolveAgentEnvironment } from './connections';
import { findExecutable, runtimeSearchPath, spawnAgentRuntimeExecution } from './runtime';
import { RuntimeOutputTracker, type RuntimeStream } from './runtime-output';
import { createIsolatedWorktree, discardPreparedWorktree, type PreparedWorktree } from './worktrees';

const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_EVENT_LINE_CHARS = 16_384;
const MAX_OUTPUT_EVENTS = 5_000;
const MAX_CHANGED_FILES = 500;

interface ActiveAgentExecution {
  child: ChildProcessWithoutNullStreams;
  record: AgentExecutionRun;
  cancelRequested: boolean;
  output: RuntimeOutputTracker;
}

interface EventWriter {
  publish(type: RunEventType, message: string, payload?: unknown): void;
  publishOutput(type: 'runtime.stdout' | 'runtime.stderr' | 'validation.stdout' | 'validation.stderr', message: string): void;
  flush(): Promise<void>;
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
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

async function atomicJsonWrite(target: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
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
        publish('runtime.stderr', `Output event limit of ${MAX_OUTPUT_EVENTS} reached; additional output was omitted.`);
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

function publishRuntimeLine(output: RuntimeOutputTracker, writer: EventWriter, stream: RuntimeStream, line: string): void {
  for (const item of output.consume(stream, line)) {
    writer.publishOutput(item.stream === 'stderr' ? 'runtime.stderr' : 'runtime.stdout', item.message);
  }
}

function renderAgentPrompt(
  source: string,
  definition: Awaited<ReturnType<typeof resolveAgentDefinition>>['definition'],
  inputs: Record<string, unknown>,
  workingDirectory: string
): string {
  for (const input of definition.inputs) {
    const value = inputs[input.name];
    if (input.required && (value === undefined || value === null || String(value).trim().length === 0)) {
      throw new Error(`Agent input is required: ${input.name}`);
    }
  }

  const rendered = source.replace(/\$\{input:([A-Za-z][A-Za-z0-9_.-]*)\}/g, (_match, name: string) => {
    const value = inputs[name];
    if (value === undefined || value === null) throw new Error(`No value supplied for agent input: ${name}`);
    return String(value);
  });

  const permissions = [
    `- Repository reads: allowed inside ${workingDirectory}.`,
    definition.writeRequested
      ? '- File writes: allowed only inside the isolated worktree.'
      : '- File writes: not requested by this agent; do not create or modify files.',
    definition.shellRequested
      ? '- Shell access: explicitly approved for this trusted agent definition. Use it only for the stated task.'
      : '- Shell access: unavailable; do not attempt to invoke commands.',
    definition.networkRequested
      ? '- Network access may occur only through the approved agent tools and only for services required by the task.'
      : '- Network access is not requested; do not access external services.'
  ];

  return [
    rendered.trim(),
    '',
    'Desktop execution context:',
    `- Agent source: ${definition.relativePath}`,
    `- Target repository worktree: ${workingDirectory}`,
    '- The agent source repository contains instructions only. Investigate the target repository in the current working directory.',
    ...permissions,
    '- Do not access files outside the isolated worktree except through explicitly approved service calls.',
    '- Do not modify Git metadata, create commits, push, merge, publish, deploy, or access production systems.',
    '- Never print credentials, tokens, authorization headers, or secret environment-variable values.',
    '- Finish with a concise summary of evidence, files created or changed, unresolved questions, and recommended next steps.'
  ].join('\n');
}

function runCommand(executable: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, PATH: runtimeSearchPath(), NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0' },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
  });
}

function parseChangedFiles(porcelain: string): string[] {
  const changed = new Set<string>();
  for (const line of porcelain.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rawPath = line.slice(3).trim();
    const resolved = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1)?.trim() : rawPath;
    if (resolved) changed.add(resolved.replace(/^"|"$/g, ''));
    if (changed.size >= MAX_CHANGED_FILES) break;
  }
  return [...changed].sort();
}

export class AgentExecutionController {
  private readonly active = new Map<string, ActiveAgentExecution>();

  async prepare(request: AgentExecutionRequest, emitToRenderer: (event: RunEvent) => void): Promise<AgentExecutionRun> {
    if (!isProcessRuntimeId(request.runtimeId)) throw new Error(`Runtime ${request.runtimeId} does not support local agent execution`);
    if (!request.targetProject?.isGitRepository) throw new Error('A target Git repository is required');

    const resolved = await resolveAgentDefinition(request.agentSourceRoot, request.agentRelativePath);
    if (resolved.definition.id !== request.agentId) throw new Error('Selected agent no longer matches its source definition');
    if (!resolved.definition.supportedRuntimes.includes(request.runtimeId)) {
      throw new Error(`Agent ${resolved.definition.name} does not support runtime ${request.runtimeId}`);
    }

    const id = randomUUID();
    const storagePath = path.join(runRoot(), id);
    await fs.mkdir(storagePath, { recursive: true });
    const writer = await createEventWriter(id, storagePath, emitToRenderer);
    writer.publish('run.started', `Preparing standalone agent ${resolved.definition.name}`);

    let worktree: PreparedWorktree | undefined;
    let committed = false;
    try {
      renderAgentPrompt(resolved.source, resolved.definition, request.inputs, '<isolated-worktree>');
      worktree = await createIsolatedWorktree(request.targetProject, id, request.inputs);
      writer.publish('worktree.created', `Created target-code worktree ${worktree.branchName}`, {
        worktreePath: worktree.worktreePath,
        workingDirectory: worktree.workingDirectory,
        branchName: worktree.branchName,
        baseRevision: worktree.baseRevision
      });

      const prompt = renderAgentPrompt(resolved.source, resolved.definition, request.inputs, worktree.workingDirectory);
      await fs.writeFile(path.join(storagePath, 'prompt.txt'), prompt, { encoding: 'utf8', mode: 0o600 });
      const environment = await resolveAgentEnvironment(resolved.definition.requiredEnvironment);
      const now = new Date().toISOString();
      const record: AgentExecutionRun = {
        ...request,
        id,
        agentName: resolved.definition.name,
        agentVersion: resolved.definition.version,
        agentSourcePath: resolved.definition.sourcePath,
        agentDescription: resolved.definition.description,
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
          fileWrites: resolved.definition.writeRequested ? 'worktree-only' : 'denied-to-model',
          shell: resolved.definition.shellRequested ? 'allowed-to-model' : 'denied-to-model',
          network: resolved.definition.networkRequested ? 'allowed-through-approved-tools' : 'denied-to-model',
          maxTurns: resolved.definition.maxTurns,
          requestedTools: resolved.definition.tools,
          declaredWrites: resolved.definition.writes,
          requiredEnvironment: resolved.definition.requiredEnvironment,
          missingEnvironment: environment.missing
        },
        changedFiles: []
      };
      await atomicJsonWrite(path.join(storagePath, 'run.json'), record);
      writer.publish('approval.required', 'Standalone agent is prepared and requires explicit operator approval.', {
        agentName: record.agentName,
        targetRepository: record.repositoryRoot,
        worktreePath: record.worktreePath,
        runtimePolicy: record.runtimePolicy
      });
      await writer.flush();
      committed = true;
      return record;
    } catch (error) {
      if (worktree && !committed) await discardPreparedWorktree(worktree);
      const message = error instanceof Error ? error.message : String(error);
      writer.publish('run.failed', message);
      await writer.flush();
      throw error;
    }
  }

  async start(runId: string, emitToRenderer: (event: RunEvent) => void): Promise<AgentExecutionRun> {
    assertRunId(runId);
    if (this.active.has(runId)) throw new Error('Agent execution is already active');
    const record = await this.get(runId);
    if (!record) throw new Error('Agent execution was not found');
    if (record.status !== 'awaiting_approval') throw new Error(`Agent execution cannot start from status ${record.status}`);
    if (!isProcessRuntimeId(record.runtimeId)) throw new Error(`Runtime ${record.runtimeId} does not support local agent execution`);

    const environment = await resolveAgentEnvironment(record.runtimePolicy.requiredEnvironment);
    record.runtimePolicy.missingEnvironment = environment.missing;
    if (record.runtimePolicy.missingEnvironment.length > 0) {
      await this.persist(record);
      throw new Error(`Required environment variables are not configured: ${record.runtimePolicy.missingEnvironment.join(', ')}`);
    }

    record.worktreePath = await fs.realpath(record.worktreePath);
    record.workingDirectory = await fs.realpath(record.workingDirectory);
    if (record.workingDirectory !== record.worktreePath && !record.workingDirectory.startsWith(`${record.worktreePath}${path.sep}`)) {
      throw new Error('Agent working directory escapes the isolated worktree');
    }

    const prompt = await fs.readFile(path.join(record.storagePath, 'prompt.txt'), 'utf8');
    const writer = await createEventWriter(runId, record.storagePath, emitToRenderer);
    record.approvedAt = new Date().toISOString();
    record.updatedAt = record.approvedAt;
    record.status = 'running';
    await this.persist(record);
    writer.publish('execution.started', `Approved standalone agent started with ${record.runtimeId}`, {
      agentName: record.agentName,
      worktreePath: record.worktreePath,
      shell: record.runtimePolicy.shell,
      network: record.runtimePolicy.network
    });

    try {
      const child = await spawnAgentRuntimeExecution(
        record.runtimeId,
        record.workingDirectory,
        prompt,
        record.runtimePolicy.maxTurns,
        {
          allowWrite: record.runtimePolicy.fileWrites === 'worktree-only',
          allowShell: record.runtimePolicy.shell === 'allowed-to-model'
        },
        record.runtimePolicy.requestedTools,
        environment.values
      );
      const output = new RuntimeOutputTracker(record.runtimeId);
      const active: ActiveAgentExecution = { child, record, cancelRequested: false, output };
      this.active.set(runId, active);
      const stdout = createLineConsumer((line) => publishRuntimeLine(output, writer, 'stdout', line));
      const stderr = createLineConsumer((line) => publishRuntimeLine(output, writer, 'stderr', line));
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', (error) => { void this.finishFailure(active, writer, output.failureMessage(undefined, error.message)); });
      child.once('close', (code) => {
        stdout.flush();
        stderr.flush();
        if (active.cancelRequested) void this.finishCancelled(active, writer, code ?? undefined);
        else if (code !== 0) void this.finishFailure(active, writer, output.failureMessage(code ?? undefined), code ?? undefined);
        else void this.validateAndFinish(active, writer);
      });
      return { ...record };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      record.status = 'failed';
      record.error = message;
      await this.persist(record);
      writer.publish('run.failed', message);
      await writer.flush();
      throw error;
    }
  }

  async get(runId: string): Promise<AgentExecutionRun | null> {
    assertRunId(runId);
    const active = this.active.get(runId);
    if (active) return { ...active.record };
    try {
      return JSON.parse(await fs.readFile(path.join(runRoot(), runId, 'run.json'), 'utf8')) as AgentExecutionRun;
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
    writer.publish('run.cancelled', 'Prepared standalone-agent worktree and branch were discarded before approval.');
    await writer.flush();
    return true;
  }

  private async persist(record: AgentExecutionRun): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await atomicJsonWrite(path.join(record.storagePath, 'run.json'), record);
  }

  private async finishFailure(active: ActiveAgentExecution, writer: EventWriter, message: string, exitCode?: number): Promise<void> {
    if (!this.active.has(active.record.id)) return;
    active.record.status = 'failed';
    active.record.error = message;
    active.record.exitCode = exitCode;
    await this.persist(active.record);
    writer.publish('run.failed', message, { exitCode });
    await writer.flush();
    this.active.delete(active.record.id);
  }

  private async finishCancelled(active: ActiveAgentExecution, writer: EventWriter, exitCode?: number): Promise<void> {
    if (!this.active.has(active.record.id)) return;
    active.record.status = 'cancelled';
    active.record.exitCode = exitCode;
    await this.persist(active.record);
    writer.publish('run.cancelled', 'Standalone agent was cancelled by the operator.', { exitCode });
    await writer.flush();
    this.active.delete(active.record.id);
  }

  private async validateAndFinish(active: ActiveAgentExecution, writer: EventWriter): Promise<void> {
    active.record.status = 'validating';
    active.record.exitCode = 0;
    await this.persist(active.record);
    writer.publish('validation.started', 'Validating the target worktree and collecting changed files.');

    try {
      const git = await findExecutable(['git']);
      if (!git) throw new Error('Git executable was not found for post-agent validation');
      const head = await runCommand(git, ['rev-parse', 'HEAD'], active.record.worktreePath);
      if (head.exitCode !== 0 || head.stdout.trim() !== active.record.baseRevision) {
        throw new Error('The agent changed Git history or created a commit; standalone-agent runs must remain uncommitted');
      }
      const diffCheck = await runCommand(git, ['diff', '--check'], active.record.worktreePath);
      writer.publishOutput('validation.stdout', diffCheck.stdout.trim() || 'git diff --check passed');
      if (diffCheck.exitCode !== 0) throw new Error(diffCheck.stderr.trim() || 'git diff --check failed');
      const status = await runCommand(git, ['status', '--short'], active.record.worktreePath);
      if (status.exitCode !== 0) throw new Error(status.stderr.trim() || 'Unable to inspect changed files');
      active.record.changedFiles = parseChangedFiles(status.stdout);
      if (active.record.runtimePolicy.fileWrites === 'denied-to-model' && active.record.changedFiles.length > 0) {
        throw new Error('The agent changed files even though its definition did not request write access');
      }

      active.record.status = 'completed';
      await this.persist(active.record);
      writer.publish('validation.completed', `Collected ${active.record.changedFiles.length} changed file(s).`, {
        changedFiles: active.record.changedFiles
      });
      writer.publish('run.completed', 'Standalone agent completed. Review the isolated worktree before committing or publishing.', {
        agentName: active.record.agentName,
        worktreePath: active.record.worktreePath,
        branchName: active.record.branchName,
        changedFiles: active.record.changedFiles
      });
      await writer.flush();
      this.active.delete(active.record.id);
    } catch (error) {
      if (active.cancelRequested) {
        await this.finishCancelled(active, writer);
        return;
      }
      await this.finishFailure(active, writer, error instanceof Error ? error.message : String(error));
    }
  }
}
