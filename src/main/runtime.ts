import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants as fsConstants, promises as fs } from 'node:fs';
import path from 'node:path';
import type { RuntimeAdapterDescriptor } from '../shared/contracts';
import { PROCESS_RUNTIME_SPECS, getProcessRuntimeSpec } from '../shared/runtime-specs';

const PROBE_TIMEOUT_MS = 5_000;
const MAX_VERSION_OUTPUT = 4_096;

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

export async function findExecutable(candidates: string[], pathValue = process.env.PATH ?? ''): Promise<string | null> {
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

function requiresShell(executable: string): boolean {
  return process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable);
}

function probeVersion(executable: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      env: { ...process.env, NO_COLOR: '1' },
      shell: requiresShell(executable),
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

export async function discoverRuntimeAdapters(): Promise<RuntimeAdapterDescriptor[]> {
  const discovered: RuntimeAdapterDescriptor[] = [];

  for (const spec of PROCESS_RUNTIME_SPECS) {
    const executablePath = await findExecutable(spec.executableCandidates);
    const version = executablePath ? await probeVersion(executablePath, spec.versionArgs) : undefined;
    const isClaude = spec.id === 'claude-code';
    discovered.push({
      id: spec.id,
      name: isClaude ? 'Claude Code' : 'GitHub Copilot',
      description: isClaude
        ? 'Local process adapter using Claude Code print mode and structured streaming output.'
        : 'Local process adapter using GitHub Copilot CLI programmatic JSONL output.',
      kind: 'process',
      status: executablePath && version ? 'available' : 'unavailable',
      capabilities: isClaude
        ? ['repository.read', 'repository.write', 'command.execute', 'git.worktree', 'mcp.tools', 'structured.output']
        : ['repository.read', 'repository.write', 'command.execute', 'mcp.tools', 'structured.output'],
      executablePath: executablePath ?? undefined,
      version,
      checkedAt: new Date().toISOString(),
      configurationHint: executablePath
        ? version ? undefined : 'The executable was found but did not complete a version probe.'
        : `Install ${isClaude ? 'Claude Code' : 'GitHub Copilot CLI'} and ensure its executable is on PATH.`
    });
  }

  const bmwEndpoint = process.env.BMW_LLM_ENDPOINT?.trim();
  discovered.push({
    id: 'bmw-llm',
    name: 'BMW LLM',
    description: 'Controller-mediated HTTP adapter for the internal BMW model gateway.',
    kind: 'http',
    status: bmwEndpoint ? 'available' : 'unconfigured',
    capabilities: ['structured.output', 'mcp.tools'],
    checkedAt: new Date().toISOString(),
    configurationHint: bmwEndpoint
      ? 'Endpoint discovered from BMW_LLM_ENDPOINT; authenticated execution is implemented in a later adapter milestone.'
      : 'Configure the internal endpoint and credentials in desktop settings.'
  });

  return discovered;
}

export async function spawnRuntimePreview(runtimeId: string, cwd: string, prompt: string): Promise<ChildProcessWithoutNullStreams> {
  const spec = getProcessRuntimeSpec(runtimeId);
  if (!spec) throw new Error(`Runtime ${runtimeId} does not support local process previews`);

  const executable = await findExecutable(spec.executableCandidates);
  if (!executable) throw new Error(`Runtime executable for ${runtimeId} was not found on PATH`);

  const child = spawn(executable, spec.previewArgs, {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    shell: requiresShell(executable),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  child.stdin.end(prompt, 'utf8');
  return child;
}
