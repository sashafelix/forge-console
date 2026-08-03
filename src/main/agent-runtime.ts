import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProcessRuntimeId } from '../shared/contracts';
import { applyConfiguredNetworkEnvironment } from './network-settings';
import { discoverRuntimeAdapters, requiresCommandShell, runtimeSearchPath } from './runtime';

export interface AgentRuntimeLaunch {
  runtimeId: ProcessRuntimeId;
  cwd: string;
  agentSourceRoot: string;
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

interface McpConfig {
  path?: string;
  serverNames: string[];
}

async function resolveExecutable(runtimeId: ProcessRuntimeId): Promise<string> {
  const runtime = (await discoverRuntimeAdapters()).find((candidate) => candidate.id === runtimeId);
  if (!runtime || runtime.status !== 'available' || !runtime.executablePath) {
    throw new Error(runtime?.configurationHint ?? `Runtime executable for ${runtimeId} is unavailable`);
  }
  return runtime.executablePath;
}

async function readMcpConfig(agentSourceRoot: string): Promise<McpConfig> {
  const candidates = [
    path.join(agentSourceRoot, '.github', 'mcp.json'),
    path.join(agentSourceRoot, '.mcp.json')
  ];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(await fs.readFile(candidate, 'utf8')) as { mcpServers?: Record<string, unknown> };
      return { path: candidate, serverNames: Object.keys(parsed.mcpServers ?? {}) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Unable to read MCP configuration ${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { serverNames: [] };
}

async function runtimeEnvironment(
  runtimeId: ProcessRuntimeId,
  approvedEnvironment: Record<string, string>
): Promise<NodeJS.ProcessEnv> {
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
  }
  return env;
}

async function claudeArgs(launch: AgentRuntimeLaunch): Promise<string[]> {
  const normalizedTools = new Set(launch.requestedTools.map((tool) => tool.toLowerCase()));
  const allowedTools = ['Read', 'Glob', 'Grep'];
  if (launch.permissions.allowWrite) allowedTools.push('Write', 'Edit');
  if (launch.permissions.allowShell) allowedTools.push('Bash');
  if (normalizedTools.has('task') || normalizedTools.has('agent')) allowedTools.push('Task');

  const mcp = await readMcpConfig(launch.agentSourceRoot);
  for (const server of mcp.serverNames) allowedTools.push(`mcp__${server}__*`);

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
    ...(mcp.path ? ['--mcp-config', mcp.path] : []),
    ...(launch.sessionId ? ['--resume', launch.sessionId] : [])
  ];
}

function copilotArgs(launch: AgentRuntimeLaunch): string[] {
  const availableTools = ['view', 'grep', 'glob'];
  const allowedTools: string[] = [];
  const deniedTools = ['url', 'memory'];

  if (launch.permissions.allowWrite) {
    availableTools.push('edit', 'create', 'apply_patch');
    allowedTools.push('write');
  } else {
    deniedTools.push('write');
  }
  if (launch.permissions.allowShell) {
    availableTools.push('shell');
    allowedTools.push('shell');
  } else {
    deniedTools.push('shell');
  }

  return [
    '--output-format=json',
    '--no-color',
    '--no-remote',
    '--no-remote-export',
    `--available-tools=${availableTools.join(',')}`,
    ...(allowedTools.length > 0 ? [`--allow-tool=${allowedTools.join(',')}`] : []),
    `--deny-tool=${deniedTools.join(',')}`,
    ...(launch.sessionId ? [`--resume=${launch.sessionId}`] : [])
  ];
}

export async function spawnAgentRuntime(launch: AgentRuntimeLaunch): Promise<ChildProcessWithoutNullStreams> {
  if (!Number.isInteger(launch.maxTurns) || launch.maxTurns < 1 || launch.maxTurns > 100) {
    throw new Error('maxTurns must be from 1 to 100');
  }
  const executable = await resolveExecutable(launch.runtimeId);
  const args = launch.runtimeId === 'claude-code' ? await claudeArgs(launch) : copilotArgs(launch);
  const child = spawn(executable, args, {
    cwd: launch.cwd,
    env: await runtimeEnvironment(launch.runtimeId, launch.environment),
    shell: requiresCommandShell(executable),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.stdin.end(launch.prompt, 'utf8');
  return child;
}
