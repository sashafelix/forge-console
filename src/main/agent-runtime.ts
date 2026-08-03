import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProcessRuntimeId } from '../shared/contracts';
import { manageAgentProcess } from './agent-processes';
import {
  prepareAgentRuntimeWorkspace,
  restoreAgentRuntimeWorkspaceSync,
  runtimeWorkspaceDetails
} from './agent-runtime-workspace';
import { applyConfiguredNetworkEnvironment } from './network-settings';
import { discoverRuntimeAdapters, requiresCommandShell, runtimeSearchPath } from './runtime';

export interface AgentRuntimeLaunch {
  runtimeId: ProcessRuntimeId;
  cwd: string;
  storagePath?: string;
  agentSourceRoot: string;
  agentRelativePath?: string;
  prompt: string;
  maxTurns: number;
  permissions: {
    allowWrite: boolean;
    allowShell: boolean;
  };
  requestedTools: string[];
  environment: Record<string, string>;
  sessionId?: string;
}

interface CopilotCapabilities {
  flags: Set<string>;
}

const COPILOT_HELP_TIMEOUT_MS = 8_000;
const MAX_HELP_OUTPUT = 512 * 1024;
const copilotCapabilityCache = new Map<string, CopilotCapabilities>();

async function resolveExecutable(runtimeId: ProcessRuntimeId): Promise<string> {
  const runtime = (await discoverRuntimeAdapters()).find((candidate) => candidate.id === runtimeId);
  if (!runtime || runtime.status !== 'available' || !runtime.executablePath) {
    throw new Error(runtime?.configurationHint ?? `Runtime executable for ${runtimeId} is unavailable`);
  }
  return runtime.executablePath;
}

async function runtimeEnvironment(runtimeId: ProcessRuntimeId, approvedEnvironment: Record<string, string>): Promise<NodeJS.ProcessEnv> {
  let env: NodeJS.ProcessEnv = {
    ...process.env,
    ...approvedEnvironment,
    PATH: runtimeSearchPath(),
    NO_COLOR: '1'
  };
  env = await applyConfiguredNetworkEnvironment(env, runtimeId);
  if (runtimeId === 'github-copilot') {
    const dedicatedToken = approvedEnvironment.COPILOT_GITHUB_TOKEN ?? process.env.COPILOT_GITHUB_TOKEN;
    if (!dedicatedToken) {
      delete env.GH_TOKEN;
      delete env.GITHUB_TOKEN;
    }
    env.GITHUB_COPILOT_PROMPT_MODE_WORKSPACE_MCP = 'true';
  }
  return env;
}

async function claudeArgs(launch: AgentRuntimeLaunch): Promise<string[]> {
  const normalizedTools = new Set(launch.requestedTools.map((tool) => tool.toLowerCase()));
  const allowedTools = ['Read', 'Glob', 'Grep'];
  if (launch.permissions.allowWrite) allowedTools.push('Write', 'Edit');
  if (launch.permissions.allowShell) allowedTools.push('Bash');
  if (normalizedTools.has('task') || normalizedTools.has('agent')) allowedTools.push('Task');
  const deniedTools = ['WebFetch', 'WebSearch'];
  if (!launch.permissions.allowWrite) deniedTools.push('Write', 'Edit');
  if (!launch.permissions.allowShell) deniedTools.push('Bash');
  return [
    '-p',
    '--input-format', 'text',
    '--output-format', 'stream-json',
    '--verbose',
    '--max-turns', String(launch.maxTurns),
    '--permission-mode', launch.permissions.allowWrite ? 'acceptEdits' : 'plan',
    '--allowedTools', [...new Set(allowedTools)].join(','),
    '--disallowedTools', deniedTools.join(','),
    ...(path.resolve(launch.agentSourceRoot) !== path.resolve(launch.cwd) ? ['--add-dir', launch.agentSourceRoot] : []),
    ...(launch.sessionId ? ['--resume', launch.sessionId] : [])
  ];
}

function customAgentPrompt(prompt: string): string {
  const marker = prompt.lastIndexOf('## Operator task');
  return marker >= 0 ? prompt.slice(marker).trim() : prompt;
}

function selectedAgentPath(launch: AgentRuntimeLaunch): string {
  const selected = launch.agentRelativePath ?? launch.prompt.match(/^- Selected agent:\s*(.+)$/m)?.[1]?.trim();
  if (!selected) throw new Error('The selected agent path was not supplied to the provider runtime');
  return selected;
}

function deriveStoragePath(cwd: string): string {
  let current = path.resolve(cwd);
  while (true) {
    const parent = path.dirname(current);
    if (path.basename(parent) === 'worktrees' && /^[0-9a-f-]{36}$/i.test(path.basename(current))) {
      return path.join(path.dirname(parent), 'runs', path.basename(current));
    }
    if (parent === current) break;
    current = parent;
  }
  throw new Error('Unable to resolve the run storage directory from the isolated worktree');
}

function secretEnvironmentNames(environment: Record<string, string>): string[] {
  return Object.keys(environment).filter((name) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH)/i.test(name));
}

function collectHelp(executable: string): Promise<CopilotCapabilities> {
  const cached = copilotCapabilityCache.get(executable);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--help'], {
      env: { ...process.env, PATH: runtimeSearchPath(), NO_COLOR: '1' },
      shell: requiresCommandShell(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const append = (chunk: Buffer) => {
      if (output.length < MAX_HELP_OUTPUT) output += chunk.toString('utf8');
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    const timeout = setTimeout(() => child.kill(), COPILOT_HELP_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Unable to inspect the installed GitHub Copilot CLI: ${error.message}`));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code !== 0 || !output.trim()) {
        reject(new Error('The installed GitHub Copilot CLI did not return usable --help output'));
        return;
      }
      const flags = new Set<string>();
      for (const match of output.matchAll(/(^|[\s,])(--[a-z0-9][a-z0-9-]*)\b/gim)) flags.add(match[2]);
      const capabilities = { flags };
      copilotCapabilityCache.set(executable, capabilities);
      resolve(capabilities);
    });
  });
}

function requireFlag(capabilities: CopilotCapabilities, flag: string): void {
  if (!capabilities.flags.has(flag)) throw new Error(`The installed GitHub Copilot CLI does not support ${flag}. Update Copilot CLI or choose Claude Code for this run.`);
}

function optionalFlag(capabilities: CopilotCapabilities, flag: string, value?: string): string[] {
  if (!capabilities.flags.has(flag)) return [];
  return [value === undefined ? flag : `${flag}=${value}`];
}

export async function buildCopilotArgs(launch: AgentRuntimeLaunch, executable?: string): Promise<string[]> {
  const resolvedExecutable = executable ?? await resolveExecutable('github-copilot');
  const capabilities = await collectHelp(resolvedExecutable);
  requireFlag(capabilities, '--agent');
  requireFlag(capabilities, '--allow-tool');
  const storagePath = launch.storagePath ?? deriveStoragePath(launch.cwd);
  const workspace = await runtimeWorkspaceDetails(storagePath);
  if (!workspace) throw new Error('The staged agent runtime workspace is missing');

  const allowedPermissions = new Set<string>(['read']);
  const deniedPermissions = new Set<string>(['url', 'memory']);
  if (launch.permissions.allowWrite) allowedPermissions.add('write');
  else deniedPermissions.add('write');
  if (launch.permissions.allowShell) allowedPermissions.add('shell');
  else deniedPermissions.add('shell');

  if (workspace.mcpConfigPath) {
    const config = JSON.parse(await fs.readFile(workspace.mcpConfigPath, 'utf8')) as { mcpServers?: Record<string, unknown> };
    for (const server of Object.keys(config.mcpServers ?? {})) allowedPermissions.add(server);
  }

  const args = [
    '-p', customAgentPrompt(launch.prompt),
    ...optionalFlag(capabilities, '--output-format', 'json'),
    ...optionalFlag(capabilities, '--no-banner'),
    ...optionalFlag(capabilities, '--no-color'),
    `--agent=${workspace.agentId}`,
    `--allow-tool=${[...allowedPermissions].join(',')}`
  ];
  if (capabilities.flags.has('--deny-tool') && deniedPermissions.size > 0) args.push(`--deny-tool=${[...deniedPermissions].join(',')}`);
  if (path.resolve(launch.agentSourceRoot) !== path.resolve(launch.cwd) && capabilities.flags.has('--add-dir')) args.push(`--add-dir=${launch.agentSourceRoot}`);
  if (workspace.mcpConfigPath && capabilities.flags.has('--additional-mcp-config')) args.push(`--additional-mcp-config=@${workspace.mcpConfigPath}`);
  const secrets = secretEnvironmentNames(launch.environment);
  if (secrets.length > 0 && capabilities.flags.has('--secret-env-vars')) args.push(`--secret-env-vars=${secrets.join(',')}`);
  if (launch.sessionId) {
    requireFlag(capabilities, '--resume');
    args.push(`--resume=${launch.sessionId}`);
  }
  return args;
}

export async function spawnAgentRuntime(launch: AgentRuntimeLaunch): Promise<ChildProcessWithoutNullStreams> {
  if (!Number.isInteger(launch.maxTurns) || launch.maxTurns < 1 || launch.maxTurns > 100) throw new Error('maxTurns must be from 1 to 100');
  const storagePath = launch.storagePath ?? deriveStoragePath(launch.cwd);
  await prepareAgentRuntimeWorkspace(launch.agentSourceRoot, launch.cwd, storagePath, selectedAgentPath(launch));

  try {
    const executable = await resolveExecutable(launch.runtimeId);
    const args = launch.runtimeId === 'claude-code' ? await claudeArgs(launch) : await buildCopilotArgs({ ...launch, storagePath }, executable);
    const child = manageAgentProcess(spawn(executable, args, {
      cwd: launch.cwd,
      env: await runtimeEnvironment(launch.runtimeId, launch.environment),
      shell: requiresCommandShell(executable),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }));
    child.prependOnceListener('close', () => {
      restoreAgentRuntimeWorkspaceSync(storagePath);
    });
    if (launch.runtimeId === 'claude-code') child.stdin.end(launch.prompt, 'utf8');
    else child.stdin.end();
    return child;
  } catch (error) {
    restoreAgentRuntimeWorkspaceSync(storagePath);
    throw error;
  }
}

export function clearCopilotCapabilityCache(): void {
  copilotCapabilityCache.clear();
}
