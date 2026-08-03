import type { ProcessRuntimeId } from '../shared/contracts';

export type RuntimeStream = 'stdout' | 'stderr';

export interface RuntimeOutputNotice {
  stream: RuntimeStream;
  message: string;
  error: boolean;
  final: boolean;
}

export interface RuntimeInteractionRequest {
  question: string;
  reason?: string;
  choices: string[];
  allowFreeText: boolean;
}

type JsonRecord = Record<string, unknown>;

const MAX_MESSAGE_CHARS = 2_000;
const MAX_TRACKED_MESSAGES = 40;
const INPUT_BLOCK = /```agent-input\s*([\s\S]*?)```/i;
const RESULT_BLOCK = /```agent-result\s*([\s\S]*?)```/i;
const INPUT_XML = /<agent-input>([\s\S]*?)<\/agent-input>/i;
const RESULT_XML = /<agent-result>([\s\S]*?)<\/agent-result>/i;

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
  for (const key of ['text', 'message', 'error', 'detail', 'reason', 'result', 'content', 'summary', 'question']) {
    const text = textValue(value[key]);
    if (text) return text;
  }
  return undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => textValue(entry)).filter((entry): entry is string => Boolean(entry));
}

function sanitize(message: string): string {
  return message
    .replace(/(\bAuthorization\s*[:=]\s*Bearer\s+)[A-Za-z0-9._~+\/-]{8,}/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/(\bAuthorization\s*[:=]\s*)(?!Bearer\b)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|personal[_ -]?token|password|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(X-Atlassian-[A-Za-z-]*Token\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .trim()
    .slice(0, MAX_MESSAGE_CHARS);
}

function humanize(value: string): string {
  return value.replace(/^error[_-]?/i, '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()).trim();
}

function toolDetail(input: unknown): string {
  if (!isRecord(input)) return '';
  const candidate = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.query ?? input.description ?? input.prompt;
  const text = textValue(candidate);
  if (!text) return '';
  return `: ${text.replace(/\s+/g, ' ').trim().slice(0, 280)}`;
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

function parseJsonBlock(source: string, pattern: RegExp): JsonRecord | null {
  const match = source.match(pattern);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim()) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function interactionFromRecord(record: JsonRecord): RuntimeInteractionRequest | null {
  const question = textValue(record.question ?? record.prompt ?? record.message);
  if (!question) return null;
  return {
    question,
    reason: textValue(record.reason ?? record.context),
    choices: stringArray(record.choices ?? record.options),
    allowFreeText: record.allowFreeText !== false && record.allow_free_text !== false
  };
}

function interactionFromText(source: string): RuntimeInteractionRequest | null {
  const block = parseJsonBlock(source, INPUT_BLOCK) ?? parseJsonBlock(source, INPUT_XML);
  return block ? interactionFromRecord(block) : null;
}

function resultFromText(source: string): string | undefined {
  const block = parseJsonBlock(source, RESULT_BLOCK) ?? parseJsonBlock(source, RESULT_XML);
  return block ? textValue(block.summary ?? block.result ?? block.message) : undefined;
}

function withoutContracts(source: string): string {
  return source.replace(INPUT_BLOCK, '').replace(RESULT_BLOCK, '').replace(INPUT_XML, '').replace(RESULT_XML, '').trim();
}

function sessionIdFrom(value: JsonRecord): string | undefined {
  for (const key of ['session_id', 'sessionId', 'sessionID', 'session']) {
    const candidate = value[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (isRecord(candidate)) {
      const nested = sessionIdFrom(candidate);
      if (nested) return nested;
    }
  }
  return undefined;
}

function nativeQuestionFromTool(name: string, input: unknown): RuntimeInteractionRequest | null {
  if (!/^(?:AskUserQuestion|ask_user|ask-user|askUser)$/i.test(name)) return null;
  if (!isRecord(input)) return null;
  const questions = Array.isArray(input.questions) ? input.questions : [input];
  const first = questions.find(isRecord);
  if (!first) return null;
  const question = textValue(first.question ?? first.prompt ?? first.message);
  if (!question) return null;
  const options = Array.isArray(first.options)
    ? first.options.map((option) => isRecord(option) ? textValue(option.label ?? option.value) : textValue(option)).filter((entry): entry is string => Boolean(entry))
    : stringArray(first.choices);
  return {
    question,
    reason: textValue(first.reason ?? first.description),
    choices: options,
    allowFreeText: first.allowFreeText !== false && first.allow_free_text !== false
  };
}

export class RuntimeOutputTracker {
  private readonly errors: string[] = [];
  private readonly recent: string[] = [];
  private finalMessage?: string;
  private currentSessionId?: string;
  private interaction?: RuntimeInteractionRequest;
  private completionSummary?: string;

  constructor(private readonly runtimeId: ProcessRuntimeId) {}

  consume(stream: RuntimeStream, line: string): RuntimeOutputNotice[] {
    const trimmed = line.trim();
    const resumeHint = trimmed.match(/copilot\s+--resume(?:=|\s+)([A-Za-z0-9-]{8,})/i)?.[1];
    if (resumeHint) this.currentSessionId = resumeHint;

    if (trimmed.startsWith('{')) {
      try {
        const value = JSON.parse(trimmed) as unknown;
        if (isRecord(value)) return this.consumeStructured(stream, value);
      } catch {
        // Preserve non-JSON text below.
      }
    }

    const inlineInteraction = interactionFromText(trimmed);
    if (inlineInteraction) this.interaction = inlineInteraction;
    const inlineResult = resultFromText(trimmed);
    if (inlineResult) this.completionSummary = inlineResult;
    const cleaned = withoutContracts(trimmed);
    const item = notice(stream, cleaned, stream === 'stderr');
    if (!item) return [];
    this.track(item);
    return [item];
  }

  sessionId(): string | undefined {
    return this.currentSessionId;
  }

  pendingInteraction(): RuntimeInteractionRequest | undefined {
    return this.interaction;
  }

  resultSummary(): string | undefined {
    return this.completionSummary;
  }

  hasMeaningfulOutput(): boolean {
    return Boolean(this.completionSummary);
  }

  failureMessage(exitCode?: number, fallback?: string): string {
    const detail = this.errors.at(-1) ?? this.finalMessage ?? this.recent.at(-1) ?? (fallback ? sanitize(fallback) : undefined);
    const provider = this.runtimeId === 'claude-code' ? 'Claude Code' : 'GitHub Copilot';
    const code = exitCode === undefined ? '' : ` (exit code ${exitCode})`;
    return detail ? `${provider} failed${code}: ${detail}` : `${provider} failed${code} without returning an error message.`;
  }

  private consumeStructured(stream: RuntimeStream, value: JsonRecord): RuntimeOutputNotice[] {
    const sessionId = sessionIdFrom(value);
    if (sessionId) this.currentSessionId = sessionId;
    return this.runtimeId === 'claude-code'
      ? this.consumeClaude(stream, value)
      : this.consumeGeneric(stream, value);
  }

  private consumeClaude(stream: RuntimeStream, value: JsonRecord): RuntimeOutputNotice[] {
    const notices: RuntimeOutputNotice[] = [];
    const type = typeof value.type === 'string' ? value.type : '';
    const subtype = typeof value.subtype === 'string' ? value.subtype : '';

    if (type === 'system' && subtype === 'init') {
      const item = notice(stream, 'Claude Code session started.');
      if (item) notices.push(item);
      return this.trackAll(notices);
    }

    if (type === 'assistant' && isRecord(value.message) && Array.isArray(value.message.content)) {
      for (const block of value.message.content) {
        if (!isRecord(block)) continue;
        if (block.type === 'text') {
          const raw = textValue(block.text) ?? '';
          const interaction = interactionFromText(raw);
          if (interaction) this.interaction = interaction;
          const result = resultFromText(raw);
          if (result) this.completionSummary = result;
          const cleaned = withoutContracts(raw);
          const item = notice(stream, cleaned);
          if (item) notices.push(item);
        } else if (block.type === 'tool_use') {
          const name = typeof block.name === 'string' ? block.name : 'tool';
          const question = nativeQuestionFromTool(name, block.input);
          if (question) {
            this.interaction = question;
            const item = notice(stream, `Waiting for your answer: ${question.question}`);
            if (item) notices.push(item);
          } else {
            const item = notice(stream, `${toolLabel(name)}${toolDetail(block.input)}`);
            if (item) notices.push(item);
          }
        }
      }
      return this.trackAll(notices);
    }

    if (type === 'user' && isRecord(value.message) && Array.isArray(value.message.content)) {
      for (const block of value.message.content) {
        if (!isRecord(block) || block.type !== 'tool_result' || block.is_error !== true) continue;
        const item = notice('stderr', `Workflow tool failed: ${textValue(block.content) ?? 'No error detail was returned.'}`, true);
        if (item) notices.push(item);
      }
      return this.trackAll(notices);
    }

    if (type === 'result') {
      const isError = value.is_error === true || /^error/i.test(subtype);
      const raw = textValue(value.result) ?? textValue(value.errors) ?? textValue(value.error);
      if (raw) {
        const interaction = interactionFromText(raw);
        if (interaction) this.interaction = interaction;
        const result = resultFromText(raw);
        if (result) this.completionSummary = result;
      }
      if (isError) {
        const reason = subtype ? humanize(subtype) : 'Execution failed';
        const detail = raw ? withoutContracts(raw) : '';
        const item = notice('stderr', detail ? `${reason}: ${detail}` : reason, true, true);
        if (item) notices.push(item);
      } else if (raw) {
        const cleaned = withoutContracts(raw);
        if (cleaned && cleaned !== this.recent.at(-1)) {
          const item = notice(stream, cleaned, false, true);
          if (item) notices.push(item);
        }
        this.finalMessage = this.completionSummary ?? (cleaned || this.finalMessage);
      }
      return this.trackAll(notices);
    }

    const explicitError = textValue(value.error) ?? (value.is_error === true ? textValue(value.message) : undefined);
    if (explicitError) {
      const item = notice('stderr', explicitError, true);
      if (item) notices.push(item);
    }
    return this.trackAll(notices);
  }

  private consumeGeneric(stream: RuntimeStream, value: JsonRecord): RuntimeOutputNotice[] {
    const notices: RuntimeOutputNotice[] = [];
    const type = typeof value.type === 'string' ? value.type : '';
    const explicitError = textValue(value.error) ?? (value.success === false ? textValue(value.message) : undefined);
    if (explicitError) {
      const item = notice('stderr', explicitError, true, /result|final/i.test(type));
      if (item) notices.push(item);
      return this.trackAll(notices);
    }

    const tool = typeof value.tool === 'string' ? value.tool : typeof value.tool_name === 'string' ? value.tool_name : undefined;
    if (tool) {
      const question = nativeQuestionFromTool(tool, value.input ?? value.arguments);
      if (question) {
        this.interaction = question;
        const item = notice(stream, `Waiting for your answer: ${question.question}`);
        if (item) notices.push(item);
      } else {
        const item = notice(stream, `${toolLabel(tool)}${toolDetail(value.input ?? value.arguments)}`);
        if (item) notices.push(item);
      }
      return this.trackAll(notices);
    }

    const raw = textValue(value.result) ?? textValue(value.message) ?? textValue(value.content);
    if (raw) {
      const interaction = interactionFromText(raw);
      if (interaction) this.interaction = interaction;
      const result = resultFromText(raw);
      if (result) this.completionSummary = result;
      const cleaned = withoutContracts(raw);
      if (cleaned) {
        const item = notice(stream, cleaned, false, /result|final/i.test(type));
        if (item) notices.push(item);
      }
    }
    return this.trackAll(notices);
  }

  private trackAll(notices: RuntimeOutputNotice[]): RuntimeOutputNotice[] {
    for (const item of notices) this.track(item);
    return notices;
  }

  private track(item: RuntimeOutputNotice): void {
    if (item.error) this.push(this.errors, item.message);
    this.push(this.recent, item.message);
    if (item.final) this.finalMessage = item.message;
  }

  private push(target: string[], value: string): void {
    if (!value || target.at(-1) === value) return;
    target.push(value);
    if (target.length > MAX_TRACKED_MESSAGES) target.splice(0, target.length - MAX_TRACKED_MESSAGES);
  }
}
