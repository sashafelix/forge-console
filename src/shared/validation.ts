import path from 'node:path';
import type { PipelineManifest } from './contracts';

export interface ValidationResult<T> {
  valid: boolean;
  errors: string[];
  value?: T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAbsoluteOnAnyPlatform(value: string): boolean {
  return path.posix.isAbsolute(value) || path.win32.isAbsolute(value);
}

function portableBasename(value: string): string {
  return path.posix.basename(value.replaceAll('\\', '/'));
}

function safeRelativePath(value: unknown): value is string {
  if (!nonEmptyString(value) || isAbsoluteOnAnyPlatform(value) || value.includes('\0') || /[\r\n]/.test(value)) return false;
  return !value.replaceAll('\\', '/').split('/').some((segment) => segment === '..' || segment === '');
}

const DISALLOWED_VALIDATION_EXECUTABLES = new Set([
  'sh', 'bash', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe',
  'sudo', 'su', 'rm', 'del', 'erase', 'format', 'diskpart', 'curl', 'wget', 'ssh', 'scp',
  'python', 'python3', 'node', 'ruby', 'perl'
]);
const ALLOWED_GIT_VALIDATIONS = new Set(['status', 'diff', 'log', 'show']);
const SHELL_META_PATTERN = /[&|<>^%!()"'`$;]/;

function validateExecution(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('execution must be an object');
    return;
  }
  if (value.mode !== 'runtime-prompt') errors.push('execution.mode must be runtime-prompt');
  if (value.isolation !== 'git-worktree') errors.push('execution.isolation must be git-worktree');
  if (!safeRelativePath(value.promptTemplate)) errors.push('execution.promptTemplate must be a safe relative path');
  if (!Number.isInteger(value.maxTurns) || Number(value.maxTurns) < 1 || Number(value.maxTurns) > 100) {
    errors.push('execution.maxTurns must be an integer from 1 to 100');
  }

  if (!Array.isArray(value.validationCommands) || value.validationCommands.length > 20) {
    errors.push('execution.validationCommands must be an array with at most 20 commands');
    return;
  }

  const ids = new Set<string>();
  for (const [index, command] of value.validationCommands.entries()) {
    const prefix = `execution.validationCommands[${index}]`;
    if (!isRecord(command)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }
    if (!nonEmptyString(command.id)) errors.push(`${prefix}.id must be non-empty`);
    if (!nonEmptyString(command.name)) errors.push(`${prefix}.name must be non-empty`);
    if (nonEmptyString(command.id)) {
      if (ids.has(command.id)) errors.push(`duplicate validation command id: ${command.id}`);
      ids.add(command.id);
    }

    for (const field of ['executable', 'windowsExecutable'] as const) {
      const executable = command[field];
      if (field === 'windowsExecutable' && executable === undefined) continue;
      if (!nonEmptyString(executable) || /[\s\0]/.test(executable) || isAbsoluteOnAnyPlatform(executable)) {
        errors.push(`${prefix}.${field} must be one non-absolute executable path without whitespace`);
        continue;
      }
      if ((executable.includes('/') || executable.includes('\\') || executable.startsWith('.')) && !safeRelativePath(executable)) {
        errors.push(`${prefix}.${field} must be a safe relative executable path`);
      }
      const base = portableBasename(executable).toLowerCase();
      if (DISALLOWED_VALIDATION_EXECUTABLES.has(base)) errors.push(`${prefix}.${field} uses a disallowed shell or interpreter`);
    }

    if (!Array.isArray(command.args) || command.args.length > 64 || !command.args.every((arg) =>
      typeof arg === 'string' && arg.length <= 512 && !/[\0\r\n]/.test(arg) && !SHELL_META_PATTERN.test(arg)
    )) {
      errors.push(`${prefix}.args must contain at most 64 bounded strings without control or shell metacharacters`);
    }
    const base = nonEmptyString(command.executable) ? portableBasename(command.executable).toLowerCase() : '';
    if (base === 'git' && (!Array.isArray(command.args) || !ALLOWED_GIT_VALIDATIONS.has(String(command.args[0])))) {
      errors.push(`${prefix} may use git only for status, diff, log or show validation`);
    }
    if (command.cwd !== undefined && command.cwd !== '.' && !safeRelativePath(command.cwd)) {
      errors.push(`${prefix}.cwd must be a safe relative path`);
    }
    if (!Number.isInteger(command.timeoutSeconds) || Number(command.timeoutSeconds) < 1 || Number(command.timeoutSeconds) > 1800) {
      errors.push(`${prefix}.timeoutSeconds must be an integer from 1 to 1800`);
    }
    if (typeof command.required !== 'boolean') errors.push(`${prefix}.required must be boolean`);
  }
}

export function validatePipelineManifest(value: unknown): ValidationResult<PipelineManifest> {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ['manifest must be an object'] };
  }

  for (const field of ['id', 'name', 'description', 'version']) {
    if (!nonEmptyString(value[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (value.schemaVersion !== '1.0' && value.schemaVersion !== '1.1') errors.push('schemaVersion must be 1.0 or 1.1');

  if (!isRecord(value.inputSchema) || value.inputSchema.type !== 'object' || !isRecord(value.inputSchema.properties)) {
    errors.push('inputSchema must be an object schema with properties');
  }

  if (!Array.isArray(value.requiredCapabilities) || !value.requiredCapabilities.every(nonEmptyString)) {
    errors.push('requiredCapabilities must be a string array');
  }
  if (!Array.isArray(value.supportedRuntimes) || !value.supportedRuntimes.every(nonEmptyString)) {
    errors.push('supportedRuntimes must be a string array');
  }

  if (!Array.isArray(value.stages) || value.stages.length === 0) {
    errors.push('stages must be a non-empty array');
  } else {
    const ids = new Set<string>();
    const orders = new Set<number>();
    for (const [index, stage] of value.stages.entries()) {
      if (!isRecord(stage)) {
        errors.push(`stages[${index}] must be an object`);
        continue;
      }
      if (!nonEmptyString(stage.id)) errors.push(`stages[${index}].id must be non-empty`);
      if (!nonEmptyString(stage.name)) errors.push(`stages[${index}].name must be non-empty`);
      if (!nonEmptyString(stage.description)) errors.push(`stages[${index}].description must be non-empty`);
      if (!nonEmptyString(stage.role)) errors.push(`stages[${index}].role must be non-empty`);
      if (!Number.isInteger(stage.order) || Number(stage.order) < 1) errors.push(`stages[${index}].order must be a positive integer`);
      if (!Array.isArray(stage.requiredCapabilities) || !stage.requiredCapabilities.every(nonEmptyString)) {
        errors.push(`stages[${index}].requiredCapabilities must be a string array`);
      }
      if (nonEmptyString(stage.id)) {
        if (ids.has(stage.id)) errors.push(`duplicate stage id: ${stage.id}`);
        ids.add(stage.id);
      }
      if (Number.isInteger(stage.order)) {
        const order = Number(stage.order);
        if (orders.has(order)) errors.push(`duplicate stage order: ${order}`);
        orders.add(order);
      }
    }
  }

  if (value.execution !== undefined) {
    if (value.schemaVersion !== '1.1') errors.push('execution requires schemaVersion 1.1');
    validateExecution(value.execution, errors);
  }

  return errors.length === 0
    ? { valid: true, errors, value: value as unknown as PipelineManifest }
    : { valid: false, errors };
}
