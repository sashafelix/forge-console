import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ProcessRuntimeId, RuntimeAdapterDescriptor } from '../shared/contracts';
import { PROCESS_RUNTIME_SPECS, buildExecutionArgs, getProcessRuntimeSpec } from '../shared/runtime-specs';
import { buildSearchPath } from '../shared/search-paths';
import { listConnections } from './connections';
import { loadSettings } from './settings';

const PROBE_TIMEOUT_MS = 5_000;
const MAX_VERSION_OUTPUT = 4_096;

export function runtimeSearchPath(): string {
  return buildSearchPath(process.env.PATH ?? '', os.homedir(), process.platform, path.delimiter);
}

function executableExtensions(): string[] {
  if (process.platform !== 'win32') return [''];
  const configured = process.env.PATHEXT?.split(';').filter(Boolean) ?? ['.EXE', '.CMD', '.BAT', '.COM'];
  return ['', ...configured.map((extension) => extension.toLowerCase())];
}

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate, process.platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK);
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

export async function findExecutable(candidates: string[], pathValue = runtimeSearchPath()): Promise<string | null> {
  const pathEntries = pathValue.split(path.delimiter).filter(Boolean);
  const extensions = executableExtensions();

  for (const candidate of candidates) {
    if (path.isAbsolute(candidate) && await isExecutable(candidate)) return candidate;
    for (const directory of pathEntries) {
      for (const extension of extensions) {
        const resolved = path.join(directory, process.platform === 'win32' ? `${candidate}${extension}` : candidate);
        if (await isExecutable(resolved)) return resolved;
      }
    }
  }
  return null;
}

export function requiresCommandShell(executable: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
}

function probeVersion(executable: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      env: { ...process.env, PATH: runtimeSearchPath(), NO_COLOR: '1' },
      shell: requiresCommandShell(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_VERSION_OUTPUT) output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);

    const timeout = setTimeout(() => child.kill(), PROBE_TIMEOUT_MS);
    child.once('error', () => {
      clearTimeout(timeout);
      resolve(undefined);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      const version = output.trim().split(/\r?\n/, 1)[0]?.trim();
      resolve(code === 0 && version ? version : undefined);
    });
  });
}

async function resolveRuntimeExecutable(runtimeId: ProcessRuntimeId): Promise<{ path: string | null; source?: 'configured' | 'path' }> {
  const spec = getProcessRuntimeSpec(runtimeId);
  if (!spec) return { path: null };
  const settings = await loadSettings();
  const override = settings.runtimeExecutableOverrides[runtimeId];
  if (override && await isExecutable(override)) return { path: override, source: 'configured' };
  const discovered = await findExecutable(spec.executableCandidates);
  return { path: discovered, source: discovered ? 'path' : undefined };
}

export async function discoverRuntimeAdapters(): Promise<RuntimeAdapterDescriptor[]> {
  const discovered: RuntimeAdapterDescriptor[] = [];
  const settings = await loadSettings();

  for (const spec of PROCESS_RUNTIME_SPECS) {
    const resolved = await resolveRuntimeExecutable(spec.id);
    const version = resolved.path ? await probeVersion(resolved.path, spec.versionArgs) : undefined;
    const isClaude = spec.id === 'claude-code';
    const configuredButInvalid = Boolean(settings.runtimeExecutableOverrides[spec.id] && resolved.source !== 'configured');
    discovered.push({
      id: spec.id,
      name: isClaude ? 'Claude Code' : 'GitHub Copilot',
      description: isClaude
        ? 'Local process adapter using Claude Code print mode and structured streaming output.'
        : 'Local process adapter using GitHub Copilot CLI programmatic JSONL output.',
      kind: 'process',
      status: resolved.path && version ? 'available' : 'unavailable',
      capabilities: isClaude
        ? ['repository.read', 'repository.write', 'command.execute', 'git.worktree', 'mcp.tools', 'structured.output']
        : ['repository.read', 'repository.write', 'command.execute', 'mcp.tools', 'structured.output'],
      executablePath: resolved.path ?? settings.runtimeExecutableOverrides[spec.id],
      executableSource: resolved.source,
      version,
      checkedAt: new Date().toISOString(),
      configurationHint: resolved.path
        ? version ? undefined : 'The executable was found but did not complete a version probe.'
        : configuredButInvalid
          ? 'The configured executable no longer exists or is not executable.'
          : `Install ${isClaude ? 'Claude Code' : 'GitHub Copilot CLI'} or choose its executable manually.`
    });
  }

  const bmw = (await listConnections()).find((connection) => connection.id === 'bmw-llm');
  discovered.push({
    id: 'bmw-llm',
    name: 'BMW LLM',
    description: 'Controller-mediated HTTP adapter for the internal BMW model gateway.',
    kind: 'http',
    status: bmw?.configured ? 'unavailable' : 'unconfigured',
    capabilities: ['structured.output', 'mcp.tools'],
    checkedAt: new Date().toISOString(),
    configurationHint: bmw?.configured
      ? `Configured for ${bmw.model ?? 'the selected model'}; HTTP execution is not enabled yet.`
      : 'Configure the internal endpoint, model and credential in Connections.'
  });

  return discovered;
}

function runtimeEnvironment(
  runtimeId: string,
  approvedEnvironment: Record<string, string>
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...approvedEnvironment,
    PATH: runtimeSearchPath(),
    NO_COLOR: '1'
  };

  if (runtimeId === 'github-copilot') {
    const dedicatedToken = approvedEnvironment.COPILOT_GITHUB_TOKEN ?? process.env.COPILOT_GITHUB_TOKEN;
    if (!dedicatedToken) {
      // Copilot CLI checks generic GitHub token variables before its OAuth token in the
      // operating-system keychain. Corporate shells commonly export a GH_TOKEN or
      // GITHUB_TOKEN for unrelated tooling; those values can silently override a valid
      // `copilot login` session. Prefer the keychain/GitHub CLI fallback unless a
      // dedicated Copilot token was explicitly supplied.
      delete env.GH_TOKEN;
      delete env.GITHUB_TOKEN;
    }
  }

  return env;
}

async function spawnRuntime(
  runtimeId: string,
  cwd: string,
  prompt: string,
  args: string[],
  environment: Record<string, string> = {}
): Promise<ChildProcessWithoutNullStreams> {
  const spec = getProcessRuntimeSpec(runtimeId);
  if (!spec) throw new Error(`Runtime ${runtimeId} does not support local process sessions`);
  const resolved = await resolveRuntimeExecutable(spec.id);
  if (!resolved.path) throw new Error(`Runtime executable for ${runtimeId} was not found or configured`);

  const child = spawn(resolved.path, args, {
    cwd,
    env: runtimeEnvironment(runtimeId, environment),
    shell: requiresCommandShell(resolved.path),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.end(prompt, 'utf8');
  return child;
}

export async function spawnRuntimePreview(runtimeId: string, cwd: string, prompt: string): Promise<ChildProcessWithoutNullStreams> {
  const spec = getProcessRuntimeSpec(runtimeId);
  if (!spec) throw new Error(`Runtime ${runtimeId} does not support local process previews`);
  return spawnRuntime(runtimeId, cwd, prompt, spec.previewArgs);
}

export async function spawnRuntimeExecution(
  runtimeId: ProcessRuntimeId,
  cwd: string,
  prompt: string,
  maxTurns: number
): Promise<ChildProcessWithoutNullStreams> {
  return spawnRuntime(runtimeId, cwd, prompt, buildExecutionArgs(runtimeId, maxTurns));
}

function buildAgentExecutionArgs(
  runtimeId: ProcessRuntimeId,
  maxTurns: number,
  permissions: { allowWrite: boolean; allowShell: boolean }
): string[] {
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw new Error('maxTurns must be from 1 to 100');
  if (runtimeId === 'claude-code') {
    const allowedTools = ['Read', 'Glob', 'Grep'];
    if (permissions.allowWrite) allowedTools.push('Write', 'Edit');
    if (permissions.allowShell) allowedTools.push('Bash');
    const deniedTools = ['WebFetch', 'WebSearch'];
    if (!permissions.allowWrite) deniedTools.push('Write', 'Edit');
    if (!permissions.allowShell) deniedTools.push('Bash');
    return [
      '-p',
      '--input-format', 'text',
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', String(maxTurns),
      '--permission-mode', permissions.allowWrite ? 'acceptEdits' : 'plan',
      '--allowedTools', allowedTools.join(','),
      '--disallowedTools', deniedTools.join(',')
    ];
  }

  const availableTools = ['view', 'grep', 'glob'];
  const allowedTools: string[] = [];
  const deniedTools = ['url', 'memory'];
  if (permissions.allowWrite) {
    availableTools.push('edit', 'create', 'apply_patch');
    allowedTools.push('write');
  } else {
    deniedTools.push('write');
  }
  if (permissions.allowShell) {
    availableTools.push('shell');
    allowedTools.push('shell');
  } else {
    deniedTools.push('shell');
  }

  return [
    '--output-format=json',
    '--no-ask-user',
    '--no-color',
    '--no-remote',
    '--no-remote-export',
    `--available-tools=${availableTools.join(',')}`,
    ...(allowedTools.length > 0 ? [`--allow-tool=${allowedTools.join(',')}`] : []),
    `--deny-tool=${deniedTools.join(',')}`
  ];
}

export async function spawnAgentRuntimeExecution(
  runtimeId: ProcessRuntimeId,
  cwd: string,
  prompt: string,
  maxTurns: number,
  permissions: { allowWrite: boolean; allowShell: boolean },
  environment: Record<string, string>
): Promise<ChildProcessWithoutNullStreams> {
  return spawnRuntime(runtimeId, cwd, prompt, buildAgentExecutionArgs(runtimeId, maxTurns, permissions), environment);
}
