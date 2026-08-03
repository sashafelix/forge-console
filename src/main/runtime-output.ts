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
const MAX_RAW_LINE_CHARS = 65_536;
const MAX_TRACKED_MESSAGES = 40;
const MAX_JSON_DEPTH = 10;
const INPUT_BLOCK = /```agent-input\s*([\s\S]*?)```/i;
const RESULT_BLOCK = /```agent-result\s*([\s\S]*?)```/i;
const INPUT_XML = /<agent-input>([\s\S]*?)<\/agent-input>/i;
const RESULT_XML = /<agent-result>([\s\S]*?)<\/agent-result>/i;
const SENSITIVE_KEY = /(?:authorization|cookie|password|secret|token|api[_-]?key|credential)/i;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function redactValue(value: unknown, key = '', depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return '[REDACTED]';
  if (depth > MAX_JSON_DEPTH) return '[TRUNCATED]';
  if (typeof value === 'string') return sanitize(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactValue(entry, '', depth + 1));
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).slice(0, 200).map(([entryKey, entryValue]) => [entryKey, redactValue(entryValue, entryKey, depth + 1)])
  );
}

export function redactRuntimeLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return '';
  try {
    return JSON.stringify(redactValue(JSON.parse(trimmed) as unknown)).slice(0, MAX_RAW_LINE_CHARS);
  } catch {
    return sanitize(trimmed).slice(0, MAX_RAW_LINE_CHARS);
  }
}

function directString(record: JsonRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const joined = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).join('\n').trim();
      if (joined) return joined;
    }
  }
  return undefined;
}

function deepString(value: unknown, keys: string[], depth = 0): string | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined;
  if (isRecord(value)) {
    const direct = directString(value, keys);
    if (direct) return direct;
    const preferredContainers = ['data', 'payload', 'message', 'response', 'result', 'output', 'content', 'event', 'details'];
    for (const key of preferredContainers) {
      if (key in value) {
        const nested = deepString(value[key], keys, depth + 1);
        if (nested) return nested;
      }
    }
    for (const nestedValue of Object.values(value)) {
      const nested = deepString(nestedValue, keys, depth + 1);
      if (nested) return nested;
    }
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = deepString(entry, keys, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function textValue(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const values = value.map(textValue).filter((entry): entry is string => Boolean(entry));
    return values.length > 0 ? values.join('\n') : undefined;
  }
  if (!isRecord(value)) return undefined;
  return deepString(value, ['text', 'content', 'message', 'response', 'output', 'result', 'summary', 'question', 'delta', 'reason', 'detail']);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => textValue(entry)).filter((entry): entry is string => Boolean(entry));
}

function humanize(value: string): string {
  return value.replace(/^error[_-]?/i, '').replace(/[._-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase()).trim();
}

function toolDetail(input: unknown): string {
  if (!isRecord(input)) return '';
  const candidate = input.command ?? input.file_path ?? input.filePath ?? input.path ?? input.pattern ?? input.query ?? input.description ?? input.prompt ?? input.arguments;
  const text = textValue(candidate);
  if (!text) return '';
  return `: ${text.replace(/\s+/g, ' ').trim().slice(0, 280)}`;
}

function toolLabel(name: string): string {
  if (/^(Task|Agent|task|write_agent)$/i.test(name)) return 'Delegating workflow step';
  if (/^(Bash|shell|bash|powershell)$/i.test(name)) return 'Running command';
  if (/^(Read|view|Glob|glob|Grep|grep|rg)$/i.test(name)) return 'Inspecting repository';
  if (/^(Write|Edit|write|edit|create|apply_patch)$/i.test(name)) return 'Updating isolated worktree';
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
  const question = textValue(record.question ?? record.prompt ?? record.message ?? record.content);
  if (!question) return null;
  return {
    question,
    reason: textValue(record.reason ?? record.context ?? record.description),
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

function sessionIdFrom(value: unknown, depth = 0): string | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined;
  if (isRecord(value)) {
    for (const [key, candidate] of Object.entries(value)) {
      if (/^(?:session[_-]?id|conversation[_-]?id|task[_-]?id)$/i.test(key)
        && typeof candidate === 'string' && candidate.trim().length >= 8) {
        return candidate.trim();
      }
    }
    for (const candidate of Object.values(value)) {
      const nested = sessionIdFrom(candidate, depth + 1);
      if (nested) return nested;
    }
  } else if (Array.isArray(value)) {
    for (const candidate of value) {
      const nested = sessionIdFrom(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function eventTypeFrom(value: JsonRecord): string {
  return directString(value, ['type', 'eventType', 'event_type', 'event', 'kind'])
    ?? (isRecord(value.data) ? directString(value.data, ['type', 'eventType', 'event_type', 'event', 'kind']) : undefined)
    ?? '';
}

interface ToolCall {
  name: string;
  input?: unknown;
}

function toolCallFrom(value: unknown, depth = 0): ToolCall | null {
  if (depth > MAX_JSON_DEPTH) return null;
  if (isRecord(value)) {
    const name = directString(value, ['tool', 'tool_name', 'toolName']);
    if (name) return { name, input: value.input ?? value.arguments ?? value.args ?? value.parameters };

    const type = directString(value, ['type', 'eventType', 'event_type', 'event', 'kind']) ?? '';
    const named = directString(value, ['name']);
    if (named && /tool|function/i.test(type)) return { name: named, input: value.input ?? value.arguments ?? value.args ?? value.parameters };

    for (const candidate of Object.values(value)) {
      const nested = toolCallFrom(candidate, depth + 1);
      if (nested) return nested;
    }
  } else if (Array.isArray(value)) {
    for (const candidate of value) {
      const nested = toolCallFrom(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  return null;
}

function nativeQuestionFromTool(name: string, input: unknown): RuntimeInteractionRequest | null {
  if (!/^(?:AskUserQuestion|ask_user|ask-user|askUser)$/i.test(name)) return null;
  if (!isRecord(input)) return null;
  const questions = Array.isArray(input.questions) ? input.questions : [input];
  const first = questions.find(isRecord);
  if (!first) return null;
  const question = textValue(first.question ?? first.prompt ?? first.message ?? first.content);
  if (!question) return null;
  const options = Array.isArray(first.options)
    ? first.options.map((option) => isRecord(option) ? textValue(option.label ?? option.value) : textValue(option)).filter((entry): entry is string => Boolean(entry))
    : stringArray(first.choices);
  return {
    question,
    reason: textValue(first.reason ?? first.description ?? first.context),
    choices: options,
    allowFreeText: first.allowFreeText !== false && first.allow_free_text !== false
  };
}

function roleFrom(value: unknown, depth = 0): string | undefined {
  if (depth > MAX_JSON_DEPTH) return undefined;
  if (isRecord(value)) {
    const role = directString(value, ['role', 'author']);
    if (role) return role;
    for (const candidate of Object.values(value)) {
      const nested = roleFrom(candidate, depth + 1);
      if (nested) return nested;
    }
  } else if (Array.isArray(value)) {
    for (const candidate of value) {
      const nested = roleFrom(candidate, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function assistantTextFrom(value: JsonRecord, eventType: string): string | undefined {
  const role = roleFrom(value)?.toLowerCase();
  const assistantLike = role === 'assistant' || /assistant|response|result|completion|message/i.test(eventType);
  if (!assistantLike) return undefined;
  return deepString(value, ['text', 'content', 'message', 'response', 'output', 'result', 'summary', 'delta']);
}

function explicitErrorFrom(value: JsonRecord, eventType: string): string | undefined {
  const failed = value.success === false || value.ok === false || /error|failed|failure/i.test(eventType);
  if (!failed) return undefined;
  return deepString(value, ['error', 'errorMessage', 'error_message', 'message', 'detail', 'reason']);
}

function looksLikeQuestion(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /\?\s*$/.test(trimmed)
    || /^(?:what|which|who|where|when|why|how|do|does|did|is|are|can|could|would|should|please choose|please confirm)\b/i.test(trimmed);
}

export class RuntimeOutputTracker {
  private readonly errors: string[] = [];
  private readonly recent: string[] = [];
  private finalMessage?: string;
  private currentSessionId?: string;
  private interaction?: RuntimeInteractionRequest;
  private completionSummary?: string;
  private lastAssistantResponse?: string;

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
    if (stream === 'stdout' && cleaned) this.lastAssistantResponse = cleaned;
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

  assistantResponse(): string | undefined {
    return this.lastAssistantResponse;
  }

  inferredInteractiveQuestion(): RuntimeInteractionRequest | undefined {
    const response = this.lastAssistantResponse?.trim();
    if (!response || !looksLikeQuestion(response)) return undefined;
    return { question: response, choices: [], allowFreeText: true };
  }

  hasMeaningfulOutput(): boolean {
    return Boolean(this.completionSummary);
  }

  failureMessage(exitCode?: number, fallback?: string): string {
    const detail = this.errors.at(-1) ?? this.finalMessage ?? this.lastAssistantResponse ?? this.recent.at(-1) ?? (fallback ? sanitize(fallback) : undefined);
    const provider = this.runtimeId === 'claude-code' ? 'Claude Code' : 'GitHub Copilot';
    const code = exitCode === undefined ? '' : ` (exit code ${exitCode})`;
    return detail ? `${provider} failed${code}: ${detail}` : `${provider} failed${code} without returning an error message.`;
  }

  private consumeStructured(stream: RuntimeStream, value: JsonRecord): RuntimeOutputNotice[] {
    const sessionId = sessionIdFrom(value);
    if (sessionId) this.currentSessionId = sessionId;
    return this.runtimeId === 'claude-code'
      ? this.consumeClaude(stream, value)
      : this.consumeCopilot(stream, value);
  }

  private consumeClaude(stream: RuntimeStream, value: JsonRecord): RuntimeOutputNotice[] {
    const notices: RuntimeOutputNotice[] = [];
    const type = eventTypeFrom(value);
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
          this.captureAssistantText(raw);
          const cleaned = withoutContracts(raw);
          const item = notice(stream, cleaned);
          if (item) notices.push(item);
        } else if (block.type === 'tool_use') {
          const name = typeof block.name === 'string' ? block.name : 'tool';
          this.captureToolInteraction(name, block.input, stream, notices);
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
      if (raw) this.captureAssistantText(raw);
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

    const explicitError = explicitErrorFrom(value, type);
    if (explicitError) {
      const item = notice('stderr', explicitError, true);
      if (item) notices.push(item);
    }
    return this.trackAll(notices);
  }

  private consumeCopilot(stream: RuntimeStream, value: JsonRecord): RuntimeOutputNotice[] {
    const notices: RuntimeOutputNotice[] = [];
    const type = eventTypeFrom(value);
    const explicitError = explicitErrorFrom(value, type);
    if (explicitError) {
      const item = notice('stderr', explicitError, true, /result|final|complete|end/i.test(type));
      if (item) notices.push(item);
      return this.trackAll(notices);
    }

    const tool = toolCallFrom(value);
    if (tool) {
      this.captureToolInteraction(tool.name, tool.input, stream, notices);
      return this.trackAll(notices);
    }

    const raw = assistantTextFrom(value, type);
    if (raw) {
      this.captureAssistantText(raw);
      const cleaned = withoutContracts(raw);
      if (cleaned) {
        const item = notice(stream, cleaned, false, /result|final|complete|end/i.test(type));
        if (item) notices.push(item);
      }
      return this.trackAll(notices);
    }

    if (type && /warning|blocked|permission|mcp/i.test(type)) {
      const detail = deepString(value, ['message', 'detail', 'reason', 'status']);
      const item = notice(stream, detail ? `${humanize(type)}: ${detail}` : humanize(type), /error|blocked|denied/i.test(type));
      if (item) notices.push(item);
    }
    return this.trackAll(notices);
  }

  private captureAssistantText(raw: string): void {
    const interaction = interactionFromText(raw);
    if (interaction) this.interaction = interaction;
    const result = resultFromText(raw);
    if (result) this.completionSummary = result;
    const cleaned = withoutContracts(raw);
    if (cleaned) this.lastAssistantResponse = cleaned;
  }

  private captureToolInteraction(name: string, input: unknown, stream: RuntimeStream, notices: RuntimeOutputNotice[]): void {
    const question = nativeQuestionFromTool(name, input);
    if (question) {
      this.interaction = question;
      const item = notice(stream, `Waiting for your answer: ${question.question}`);
      if (item) notices.push(item);
    } else {
      const item = notice(stream, `${toolLabel(name)}${toolDetail(input)}`);
      if (item) notices.push(item);
    }
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
