import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertWorkbenchExecutionAllowed } from '../shared/pipeline-boundary';
import type {
  AgentConversationMessage,
  AgentExecutionRequest,
  AgentExecutionRun,
  AgentQuestion,
  ProcessRuntimeId,
  ReplyToAgentExecutionRequest,
  RunEvent,
  RunEventType
} from '../shared/contracts';
import { spawnAgentRuntime } from './agent-runtime';
import { resolveAgentDefinition } from './agents';
import { resolveAgentEnvironment } from './connections';
import { findExecutable, runtimeSearchPath } from './runtime';
import { RuntimeOutputTracker, type RuntimeInteractionRequest, type RuntimeStream } from './runtime-output';
import { createIsolatedWorktree, discardPreparedWorktree, type PreparedWorktree } from './worktrees';

const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/i;
const MAX_EVENT_LINE_CHARS = 16_384;
const MAX_OUTPUT_EVENTS = 5_000;
const MAX_CHANGED_FILES = 500;
const MAX_INTERACTIONS = 50;

interface ActiveAgentExecution {
  child: ChildProcessWithoutNullStreams;
  record: AgentExecutionRun;
  cancelRequested: boolean;
  interactionCaptured: boolean;
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

function conversationMessage(role: AgentConversationMessage['role'], content: string, questionId?: string): AgentConversationMessage {
  return { id: randomUUID(), role, content: content.trim(), timestamp: new Date().toISOString(), questionId };
}

function normalizeRecord(record: AgentExecutionRun): AgentExecutionRun {
  return {
    ...record,
    conversation: Array.isArray(record.conversation) ? record.conversation : [],
    interactionCount: Number.isInteger(record.interactionCount) ? record.interactionCount : 0,
    changedFiles: Array.isArray(record.changedFiles) ? record.changedFiles : [],
    runtimePolicy: {
      ...record.runtimePolicy,
      interactive: record.runtimePolicy?.interactive === true
    }
  };
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

function interactionContract(interactive: boolean): string[] {
  return [
    'Desktop conversation contract:',
    '- This run is controlled by a workbench that can pause, show a question to the operator, and resume the same provider session.',
    '- Never invent a human decision, approval, business fact, or missing requirement.',
    '- When a human answer or approval is required, stop before taking the guarded action.',
    '- Prefer the runtime ask-user tool when available. Otherwise end the turn with exactly one fenced block in this form:',
    '```agent-input',
    '{"question":"One clear question","reason":"Why this is needed","choices":[],"allowFreeText":true}',
    '```',
    '- Ask one purposeful question at a time. Do not put multiple unrelated questions into one message.',
    '- After the operator replies, continue from the same state and do not repeat already answered questions.',
    '- When the requested workflow is genuinely complete, end with exactly one fenced block in this form:',
    '```agent-result',
    '{"summary":"What was completed and where the result is stored","artifacts":["relative/path"],"nextSteps":[]}',
    '```',
    interactive
      ? '- This agent is explicitly interactive. Reaching a question or approval boundary means WAITING FOR INPUT, not completion.'
      : '- Ask only when the task cannot be completed safely without a human answer.'
  ];
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
      ? '- Network access may occur only through approved MCP/service tools required by the task.'
      : '- Network access is not requested; do not access external services.'
  ];

  return [
    rendered.trim(),
    '',
    'Desktop execution context:',
    `- Agent source repository: ${definition.sourceRoot}`,
    `- Selected agent: ${definition.relativePath}`,
    `- Target repository worktree: ${workingDirectory}`,
    '- Read AGENTS.md, CLAUDE.md, .github/copilot-instructions.md, invoked agent definitions, skills, and policy files from the agent source repository when they exist.',
    '- If the runtime cannot invoke a named sub-agent natively, open the corresponding definition under .github/agents, agents, or .claude/agents and execute that stage contract directly in this same session. Do not silently skip the stage.',
    '- Use the repository MCP configuration for Jira, Confluence, and other declared services. A missing required service is a blocking error, not permission to fabricate data.',
    ...permissions,
    '- Do not access files outside the isolated worktree or agent source repository except through explicitly approved service calls.',
    '- Do not modify Git metadata, create commits, push, merge, publish, deploy, or access production systems.',
    '- Never print credentials, tokens, authorization headers, or secret environment-variable values.',
    ...interactionContract(definition.interactive)
  ].join('\n');
}

function resumePrompt(question: AgentQuestion, reply: string): string {
  return [
    'The operator answered the pending workbench question.',
    `Question: ${question.question}`,
    `Answer: ${reply}`,
    '',
    'Treat this answer as authoritative only for the question shown above. Continue the existing workflow from the exact paused state. Follow the desktop conversation contract: ask the next single question if more human input is required, otherwise complete the work and emit agent-result.'
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

function questionFrom(interaction: RuntimeInteractionRequest): AgentQuestion {
  return {
    id: randomUUID(),
    question: interaction.question,
    reason: interaction.reason,
    choices: interaction.choices,
    allowFreeText: interaction.allowFreeText,
    requestedAt: new Date().toISOString()
  };
}

export class AgentExecutionController {
  private readonly active = new Map<string, ActiveAgentExecution>();

  async prepare(request: AgentExecutionRequest, emitToRenderer: (event: RunEvent) => void): Promise<AgentExecutionRun> {
    assertWorkbenchExecutionAllowed(request.agentId, request.agentRelativePath);
    if (!isProcessRuntimeId(request.runtimeId)) throw new Error(`Runtime ${request.runtimeId} does not support local agent execution`);
    if (!request.targetProject?.isGitRepository) throw new Error('A target Git repository is required');

    const resolved = await resolveAgentDefinition(request.agentSourceRoot, request.agentRelativePath);
    assertWorkbenchExecutionAllowed(resolved.definition.id, resolved.definition.relativePath);
    if (resolved.definition.id !== request.agentId) throw new Error('Selected agent no longer matches its source definition');
    if (!resolved.definition.supportedRuntimes.includes(request.runtimeId)) {
      throw new Error(`Agent ${resolved.definition.name} does not support runtime ${request.runtimeId}`);
    }

    const id = randomUUID();
    const storagePath = path.join(runRoot(), id);
    await fs.mkdir(storagePath, { recursive: true });
    const writer = await createEventWriter(id, storagePath, emitToRenderer);
    writer.publish('run.started', `Preparing ${resolved.definition.name}`);

    let worktree: PreparedWorktree | undefined;
    let committed = false;
    try {
      renderAgentPrompt(resolved.source, resolved.definition, request.inputs, '<isolated-worktree>');
      worktree = await createIsolatedWorktree(request.targetProject, id, request.inputs);
      writer.publish('worktree.created', `Created safe target-code worktree ${worktree.branchName}`, {
        worktreePath: worktree.worktreePath,
        workingDirectory: worktree.workingDirectory,
        branchName: worktree.branchName,
        baseRevision: worktree.baseRevision
      });

      const prompt = renderAgentPrompt(resolved.source, resolved.definition, request.inputs, worktree.workingDirectory);
      await fs.writeFile(path.join(storagePath, 'prompt.txt'), prompt, { encoding: 'utf8', mode: 0o600 });
      const environment = await resolveAgentEnvironment(resolved.definition.requiredEnvironment);
      const now = new Date().toISOString();
      const initialTask = String(request.inputs.task ?? Object.values(request.inputs).find((value) => String(value ?? '').trim()) ?? resolved.definition.description);
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
        conversation: [conversationMessage('user', initialTask)],
        interactionCount: 0,
        runtimePolicy: {
          fileWrites: resolved.definition.writeRequested ? 'worktree-only' : 'denied-to-model',
          shell: resolved.definition.shellRequested ? 'allowed-to-model' : 'denied-to-model',
          network: resolved.definition.networkRequested ? 'allowed-through-approved-tools' : 'denied-to-model',
          interactive: resolved.definition.interactive,
          maxTurns: resolved.definition.maxTurns,
          requestedTools: resolved.definition.tools,
          declaredWrites: resolved.definition.writes,
          requiredEnvironment: resolved.definition.requiredEnvironment,
          missingEnvironment: environment.missing
        },
        changedFiles: []
      };
      await atomicJsonWrite(path.join(storagePath, 'run.json'), record);
      writer.publish('approval.required', 'The task is prepared and requires explicit operator approval.', {
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
    const record = await this.getRequired(runId);
    if (record.status !== 'awaiting_approval') throw new Error(`Agent execution cannot start from status ${record.status}`);
    const prompt = await fs.readFile(path.join(record.storagePath, 'prompt.txt'), 'utf8');
    record.approvedAt = new Date().toISOString();
    return this.runTurn(record, prompt, undefined, 'execution.started', 'Approved task started', emitToRenderer);
  }

  async reply(request: ReplyToAgentExecutionRequest, emitToRenderer: (event: RunEvent) => void): Promise<AgentExecutionRun> {
    assertRunId(request.runId);
    const reply = request.reply.trim();
    if (!reply) throw new Error('A reply is required');
    const record = await this.getRequired(request.runId);
    if (record.status !== 'waiting_for_input' || !record.pendingQuestion) {
      throw new Error(`Agent execution is not waiting for input; current status is ${record.status}`);
    }
    if (request.questionId && request.questionId !== record.pendingQuestion.id) throw new Error('The pending question changed; refresh the run before replying');
    if (!record.pendingQuestion.allowFreeText && record.pendingQuestion.choices.length > 0 && !record.pendingQuestion.choices.includes(reply)) {
      throw new Error('Choose one of the available answers');
    }
    if (record.interactionCount >= MAX_INTERACTIONS) throw new Error(`Interaction limit of ${MAX_INTERACTIONS} reached`);

    const question = record.pendingQuestion;
    record.conversation.push(conversationMessage('user', reply, question.id));
    record.pendingQuestion = undefined;
    record.interactionCount += 1;
    const writer = await createEventWriter(record.id, record.storagePath, emitToRenderer);
    writer.publish('interaction.replied', 'Your answer was sent to the workflow.', { questionId: question.id });
    await writer.flush();

    let prompt = resumePrompt(question, reply);
    if (!record.providerSessionId) {
      const original = await fs.readFile(path.join(record.storagePath, 'prompt.txt'), 'utf8');
      prompt = `${original}\n\nPrevious workbench conversation:\n${record.conversation.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n')}\n\n${prompt}`;
    }
    return this.runTurn(record, prompt, record.providerSessionId, 'execution.resumed', 'Workflow resumed with your answer', emitToRenderer);
  }

  async get(runId: string): Promise<AgentExecutionRun | null> {
    assertRunId(runId);
    const active = this.active.get(runId);
    if (active) return normalizeRecord({ ...active.record });
    try {
      return normalizeRecord(JSON.parse(await fs.readFile(path.join(runRoot(), runId, 'run.json'), 'utf8')) as AgentExecutionRun);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async getLatest(): Promise<AgentExecutionRun | null> {
    let directories: string[];
    try {
      directories = await fs.readdir(runRoot());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    const records = (await Promise.all(directories.filter((entry) => RUN_ID_PATTERN.test(entry)).map(async (entry) => {
      try {
        return normalizeRecord(JSON.parse(await fs.readFile(path.join(runRoot(), entry, 'run.json'), 'utf8')) as AgentExecutionRun);
      } catch {
        return null;
      }
    }))).filter((record): record is AgentExecutionRun => Boolean(record));
    return records.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0] ?? null;
  }

  async getEvents(runId: string): Promise<RunEvent[]> {
    assertRunId(runId);
    try {
      return (await fs.readFile(path.join(runRoot(), runId, 'events.jsonl'), 'utf8'))
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as RunEvent)
        .sort((left, right) => left.sequence - right.sequence);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
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
    if (!record || !['awaiting_approval', 'waiting_for_input'].includes(record.status)) return false;
    const writer = await createEventWriter(runId, record.storagePath, emitToRenderer);
    await discardPreparedWorktree({
      repositoryRoot: record.repositoryRoot,
      worktreePath: record.worktreePath,
      workingDirectory: record.workingDirectory,
      branchName: record.branchName,
      baseRevision: record.baseRevision
    });
    record.status = 'cancelled';
    record.pendingQuestion = undefined;
    await this.persist(record);
    writer.publish('run.cancelled', 'The task and its isolated worktree were discarded.');
    await writer.flush();
    return true;
  }

  private async getRequired(runId: string): Promise<AgentExecutionRun> {
    if (this.active.has(runId)) throw new Error('Agent execution is already active');
    const record = await this.get(runId);
    if (!record) throw new Error('Agent execution was not found');
    assertWorkbenchExecutionAllowed(record.agentId, record.agentRelativePath);
    if (!isProcessRuntimeId(record.runtimeId)) throw new Error(`Runtime ${record.runtimeId} does not support local agent execution`);
    return record;
  }

  private async runTurn(
    record: AgentExecutionRun,
    prompt: string,
    sessionId: string | undefined,
    eventType: 'execution.started' | 'execution.resumed',
    eventMessage: string,
    emitToRenderer: (event: RunEvent) => void
  ): Promise<AgentExecutionRun> {
    const environment = await resolveAgentEnvironment(record.runtimePolicy.requiredEnvironment);
    record.runtimePolicy.missingEnvironment = environment.missing;
    if (environment.missing.length > 0) {
      await this.persist(record);
      throw new Error(`Required environment variables are not configured: ${environment.missing.join(', ')}`);
    }

    record.worktreePath = await fs.realpath(record.worktreePath);
    record.workingDirectory = await fs.realpath(record.workingDirectory);
    if (record.workingDirectory !== record.worktreePath && !record.workingDirectory.startsWith(`${record.worktreePath}${path.sep}`)) {
      throw new Error('Agent working directory escapes the isolated worktree');
    }

    const writer = await createEventWriter(record.id, record.storagePath, emitToRenderer);
    record.status = 'running';
    record.error = undefined;
    record.exitCode = undefined;
    await this.persist(record);
    writer.publish(eventType, eventMessage, {
      agentName: record.agentName,
      worktreePath: record.worktreePath,
      providerSessionId: sessionId ? '[PRESENT]' : undefined,
      shell: record.runtimePolicy.shell,
      network: record.runtimePolicy.network
    });

    try {
      const child = await spawnAgentRuntime({
        runtimeId: record.runtimeId,
        cwd: record.workingDirectory,
        agentSourceRoot: record.agentSourceRoot,
        prompt,
        maxTurns: record.runtimePolicy.maxTurns,
        permissions: {
          allowWrite: record.runtimePolicy.fileWrites === 'worktree-only',
          allowShell: record.runtimePolicy.shell === 'allowed-to-model'
        },
        requestedTools: record.runtimePolicy.requestedTools,
        environment: environment.values,
        sessionId
      });
      const output = new RuntimeOutputTracker(record.runtimeId);
      const active: ActiveAgentExecution = { child, record, cancelRequested: false, interactionCaptured: false, output };
      this.active.set(record.id, active);

      const consume = (stream: RuntimeStream, line: string) => {
        publishRuntimeLine(output, writer, stream, line);
        if (output.pendingInteraction() && !active.interactionCaptured) {
          active.interactionCaptured = true;
          windowlessKill(child);
        }
      };
      const stdout = createLineConsumer((line) => consume('stdout', line));
      const stderr = createLineConsumer((line) => consume('stderr', line));
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
      child.once('error', (error) => { void this.finishFailure(active, writer, output.failureMessage(undefined, error.message)); });
      child.once('close', (code) => {
        stdout.flush();
        stderr.flush();
        if (active.cancelRequested) void this.finishCancelled(active, writer, code ?? undefined);
        else if (output.pendingInteraction()) void this.finishWaiting(active, writer, output.pendingInteraction()!);
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

  private async persist(record: AgentExecutionRun): Promise<void> {
    record.updatedAt = new Date().toISOString();
    await atomicJsonWrite(path.join(record.storagePath, 'run.json'), record);
  }

  private async finishWaiting(active: ActiveAgentExecution, writer: EventWriter, interaction: RuntimeInteractionRequest): Promise<void> {
    if (!this.active.has(active.record.id)) return;
    const question = questionFrom(interaction);
    active.record.providerSessionId = active.output.sessionId() ?? active.record.providerSessionId;
    active.record.pendingQuestion = question;
    active.record.status = 'waiting_for_input';
    active.record.resultSummary = undefined;
    active.record.conversation.push(conversationMessage('assistant', question.question, question.id));
    await this.persist(active.record);
    writer.publish('interaction.requested', question.question, {
      questionId: question.id,
      reason: question.reason,
      choices: question.choices,
      allowFreeText: question.allowFreeText,
      resumableSession: Boolean(active.record.providerSessionId)
    });
    await writer.flush();
    this.active.delete(active.record.id);
  }

  private async finishFailure(active: ActiveAgentExecution, writer: EventWriter, message: string, exitCode?: number): Promise<void> {
    if (!this.active.has(active.record.id)) return;
    active.record.providerSessionId = active.output.sessionId() ?? active.record.providerSessionId;
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
    active.record.pendingQuestion = undefined;
    await this.persist(active.record);
    writer.publish('run.cancelled', 'The task was cancelled by the operator.', { exitCode });
    await writer.flush();
    this.active.delete(active.record.id);
  }

  private async validateAndFinish(active: ActiveAgentExecution, writer: EventWriter): Promise<void> {
    active.record.providerSessionId = active.output.sessionId() ?? active.record.providerSessionId;
    active.record.resultSummary = active.output.resultSummary();
    active.record.status = 'validating';
    active.record.exitCode = 0;
    await this.persist(active.record);
    writer.publish('validation.started', 'Validating the target worktree and collecting results.');

    try {
      const git = await findExecutable(['git']);
      if (!git) throw new Error('Git executable was not found for post-agent validation');
      const head = await runCommand(git, ['rev-parse', 'HEAD'], active.record.worktreePath);
      if (head.exitCode !== 0 || head.stdout.trim() !== active.record.baseRevision) {
        throw new Error('The agent changed Git history or created a commit; workbench runs must remain uncommitted');
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
      if (active.record.runtimePolicy.declaredWrites.length > 0 && active.record.changedFiles.length === 0) {
        throw new Error(`The provider exited successfully but the workflow produced none of its declared artefacts. Expected outputs include: ${active.record.runtimePolicy.declaredWrites.slice(0, 4).join(', ')}`);
      }
      if (active.record.changedFiles.length === 0 && !active.output.hasMeaningfulOutput()) {
        throw new Error('The provider exited successfully without producing a result, asking a question, or changing any files');
      }

      active.record.status = 'completed';
      if (active.record.resultSummary) active.record.conversation.push(conversationMessage('assistant', active.record.resultSummary));
      await this.persist(active.record);
      writer.publish('validation.completed', `Collected ${active.record.changedFiles.length} changed file(s).`, {
        changedFiles: active.record.changedFiles
      });
      writer.publish('run.completed', active.record.resultSummary ?? 'The workflow completed. Review the isolated results before committing or publishing.', {
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

function windowlessKill(child: ChildProcessWithoutNullStreams): void {
  setTimeout(() => {
    if (!child.killed) child.kill();
  }, 25);
}
