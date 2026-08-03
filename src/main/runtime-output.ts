import type { ProcessRuntimeId } from '../shared/contracts';

export type RuntimeStream = 'stdout' | 'stderr';

export interface RuntimeOutputNotice {
  stream: RuntimeStream;
  message: string;
  error: boolean;
  final: boolean;
}

type JsonRecord = Record<string, unknown>;

const MAX_MESSAGE_CHARS = 2_000;
const MAX_TRACKED_MESSAGES = 20;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const values = value.map(textValue).filter((entry): entry is string => Boolean(entry));
    return values.length > 0 ? values.join('\n') : undefined;
  }
  if (!isRecord(value)) return undefined;
  for (const key of ['text', 'message', 'error', 'detail', 'reason', 'result', 'content']) {
    const text = textValue(value[key]);
    if (text) return text;
  }
  return undefined;
}

function sanitize(message: string): string {
  return message
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/((?:authorization|api[_ -]?key|access[_ -]?token|personal[_ -]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(X-Atlassian-[A-Za-z-]*Token\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

function humanize(value: string): string {
  return value.replace(/^error[_-]?/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()).trim();
}

function toolDetail(name: string, input: unknown): string {
  if (!isRecord(input)) return '';
  const candidate = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.description ?? input.prompt;
  const text = textValue(candidate);
  if (!text) return '';
  const compact = text.replace(/\s+/g, ' ').trim();
  return `: ${compact.slice(0, 280)}`;
}

function toolLabel(name: string): string {
  if (/^(Task|Agent)$/i.test(name)) return 'Delegating workflow step';
  if (/^Bash$/i.test(name)) return 'Running command';
  if (/^(Read|Glob|Grep)$/i.test(name)) return 'Inspecting repository';
  if (/^(Write|Edit)$/i.test(name)) return 'Updating isolated worktree';
  return `Using ${name}`;
}

function notice(stream: RuntimeStream, message: string, error = false, final = false): RuntimeOutputNotice | null {
  const cleaned = sanitize(message);
  return cleaned ? { stream: error ? 'stderr' : stream, message: cleaned, error, final } : null;
}

function claudeNotices(value: JsonRecord, stream: RuntimeStream): RuntimeOutputNotice[] {
  const notices: RuntimeOutputNotice[] = [];
  const type = typeof value.type === 'string' ? value.type : '';
  const subtype = typeof value.subtype === 'string' ? value.subtype : '';

  if (type === 'system' && subtype === 'init') {
    const item = notice(stream, 'Claude Code session started.');
    return item ? [item] : [];
  }

  if (type === 'assistant' && isRecord(value.message) && Array.isArray(value.message.content)) {
    for (const block of value.message.content) {
      if (!isRecord(block)) continue;
      if (block.type === 'text') {
        const item = notice(stream, textValue(block.text) ?? '');
        if (item) notices.push(item);
      } else if (block.type === 'tool_use') {
        const name = typeof block.name === 'string' ? block.name : 'tool';
        const item = notice(stream, `${toolLabel(name)}${toolDetail(name, block.input)}`);
        if (item) notices.push(item);
      }
    }
    return notices;
  }

  if (type === 'user' && isRecord(value.message) && Array.isArray(value.message.content)) {
    for (const block of value.message.content) {
      if (!isRecord(block) || block.type !== 'tool_result' || block.is_error !== true) continue;
      const item = notice('stderr', `Workflow tool failed: ${textValue(block.content) ?? 'No error detail was returned.'}`, true);
      if (item) notices.push(item);
    }
    return notices;
  }

  if (type === 'result') {
    const isError = value.is_error === true || /^error/i.test(subtype);
    const detail = textValue(value.result) ?? textValue(value.errors) ?? textValue(value.error);
    if (isError) {
      const reason = subtype ? humanize(subtype) : 'Execution failed';
      const item = notice('stderr', detail ? `${reason}: ${detail}` : reason, true, true);
      return item ? [item] : [];
    }
    const item = notice(stream, detail ? `Completed: ${detail}` : 'Claude Code completed successfully.', false, true);
    return item ? [item] : [];
  }

  const explicitError = textValue(value.error) ?? (value.is_error === true ? textValue(value.message) : undefined);
  if (explicitError) {
    const item = notice('stderr', explicitError, true);
    return item ? [item] : [];
  }

  return [];
}

function genericJsonNotices(value: JsonRecord, stream: RuntimeStream): RuntimeOutputNotice[] {
  const type = typeof value.type === 'string' ? value.type : '';
  const explicitError = textValue(value.error) ?? (value.success === false ? textValue(value.message) : undefined);
  if (explicitError) {
    const item = notice('stderr', explicitError, true, /result|final/i.test(type));
    return item ? [item] : [];
  }

  const tool = typeof value.tool === 'string' ? value.tool : typeof value.tool_name === 'string' ? value.tool_name : undefined;
  if (tool) {
    const item = notice(stream, `${toolLabel(tool)}${toolDetail(tool, value.input ?? value.arguments)}`);
    return item ? [item] : [];
  }

  if (/result|final|assistant/i.test(type)) {
    const text = textValue(value.result) ?? textValue(value.message) ?? textValue(value.content);
    const item = notice(stream, text ? `Completed: ${text}` : 'Runtime completed.', false, true);
    return item ? [item] : [];
  }

  const message = textValue(value.message);
  if (message && !/^\{/.test(message)) {
    const item = notice(stream, message);
    return item ? [item] : [];
  }

  return [];
}

function parseStructuredLine(runtimeId: ProcessRuntimeId, stream: RuntimeStream, line: string): RuntimeOutputNotice[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const value = JSON.parse(trimmed) as unknown;
    if (!isRecord(value)) return [];
    return runtimeId === 'claude-code' ? claudeNotices(value, stream) : genericJsonNotices(value, stream);
  } catch {
    return null;
  }
}

export class RuntimeOutputTracker {
  private readonly errors: string[] = [];
  private readonly recent: string[] = [];
  private finalMessage?: string;

  constructor(private readonly runtimeId: ProcessRuntimeId) {}

  consume(stream: RuntimeStream, line: string): RuntimeOutputNotice[] {
    const structured = parseStructuredLine(this.runtimeId, stream, line);
    const notices = structured ?? (() => {
      const item = notice(stream, line, stream === 'stderr');
      return item ? [item] : [];
    })();

    for (const item of notices) {
      if (item.error) this.push(this.errors, item.message);
      this.push(this.recent, item.message);
      if (item.final) this.finalMessage = item.message;
    }
    return notices;
  }

  failureMessage(exitCode?: number, fallback?: string): string {
    const detail = this.errors.at(-1) ?? this.finalMessage ?? this.recent.at(-1) ?? (fallback ? sanitize(fallback) : undefined);
    const provider = this.runtimeId === 'claude-code' ? 'Claude Code' : 'GitHub Copilot';
    const code = exitCode === undefined ? '' : ` (exit code ${exitCode})`;
    return detail ? `${provider} failed${code}: ${detail}` : `${provider} failed${code} without returning an error message.`;
  }

  resultMessage(): string | undefined {
    return this.finalMessage;
  }

  private push(target: string[], value: string): void {
    if (!value || target.at(-1) === value) return;
    target.push(value);
    if (target.length > MAX_TRACKED_MESSAGES) target.splice(0, target.length - MAX_TRACKED_MESSAGES);
  }
}
