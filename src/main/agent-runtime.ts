import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProcessRuntimeId } from '../shared/contracts';
import { manageAgentProcess } from './agent-processes';
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

function agentRelativePathFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/^- Agent source:\s*(.+)$/m);
  return match?.[1]?.trim();
}

function stripMarkdownSuffix(filename: string): string {
  return filename.replace(/\.agent\.md$|\.md$/i, '');
}

async function resolveCopilotAgentName(launch: AgentRuntimeLaunch): Promise<string | undefined> {
  const relativePath = agentRelativePathFromPrompt(launch.prompt);
  if (!relativePath || path.isAbsolute(relativePath)) return undefined;
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) return undefined;
  const recognizedAgentPath = normalized.startsWith(`${path.join('.github', 'agents')}${path.sep}`)
    || normalized.startsWith(`${path.join('.claude', 'agents')}${path.sep}`);
  if (!recognizedAgentPath) return undefined;

  const root = await fs.realpath(path.resolve(launch.cwd));
  let candidate: string;
  try {
    candidate = await fs.realpath(path.resolve(root, normalized));
  } catch {
    return undefined;
  }
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return undefined;

  const source = await fs.readFile(candidate, 'utf8');
  const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/m)?.[1];
  const declaredName = frontmatter?.match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim();
  return declaredName || stripMarkdownSuffix(path.basename(candidate));
}

function customAgentPrompt(prompt: string): string {
  const marker = prompt.lastIndexOf('## Operator task');
  return marker >= 0 ? prompt.slice(marker).trim() : prompt;
}

function secretEnvironmentNames(environment: Record<string, string>): string[] {
  return Object.keys(environment).filter((name) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH)/i.test(name));
}

export async function buildCopilotArgs(launch: AgentRuntimeLaunch): Promise<string[]> {
  const normalizedTools = new Set(launch.requestedTools.map((tool) => tool.toLowerCase()));
  const allowedTools = new Set<string>(['view', 'grep', 'glob']);
  const deniedTools = new Set<string>(['url', 'memory']);

  if (launch.permissions.allowWrite) {
    allowedTools.add('write');
  } else {
    deniedTools.add('write');
  }
  if (launch.permissions.allowShell) {
    allowedTools.add('shell');
  } else {
    deniedTools.add('shell');
  }
  if ([...normalizedTools].some((tool) => /^(?:ask_user|ask-user|askuserquestion|askuser)$/.test(tool))) {
    allowedTools.add('ask_user');
  }
  if (normalizedTools.has('task') || normalizedTools.has('agent')) allowedTools.add('task');

  const mcp = await readMcpConfig(launch.agentSourceRoot);
  for (const server of mcp.serverNames) allowedTools.add(server);
  const selectedAgent = await resolveCopilotAgentName(launch);
  const secrets = secretEnvironmentNames(launch.environment);

  return [
    '-p', customAgentPrompt(launch.prompt),
    '--output-format=json',
    '--no-color',
    '--no-remote',
    '--no-remote-export',
    ...(selectedAgent ? [`--agent=${selectedAgent}`] : []),
    ...(path.resolve(launch.agentSourceRoot) !== path.resolve(launch.cwd) ? ['--add-dir', launch.agentSourceRoot] : []),
    ...(mcp.path ? [`--additional-mcp-config=@${mcp.path}`, '--allow-all-mcp-server-instructions'] : []),
    `--allow-tool=${[...allowedTools].join(',')}`,
    `--deny-tool=${[...deniedTools].join(',')}`,
    ...(secrets.length > 0 ? [`--secret-env-vars=${secrets.join(',')}`] : []),
    ...(launch.sessionId ? [`--resume=${launch.sessionId}`] : [])
  ];
}

export async function spawnAgentRuntime(launch: AgentRuntimeLaunch): Promise<ChildProcessWithoutNullStreams> {
  if (!Number.isInteger(launch.maxTurns) || launch.maxTurns < 1 || launch.maxTurns > 100) {
    throw new Error('maxTurns must be from 1 to 100');
  }
  const executable = await resolveExecutable(launch.runtimeId);
  const args = launch.runtimeId === 'claude-code' ? await claudeArgs(launch) : await buildCopilotArgs(launch);
  const child = manageAgentProcess(spawn(executable, args, {
    cwd: launch.cwd,
    env: await runtimeEnvironment(launch.runtimeId, launch.environment),
    shell: requiresCommandShell(executable),
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  }));
  if (launch.runtimeId === 'claude-code') child.stdin.end(launch.prompt, 'utf8');
  else child.stdin.end();
  return child;
}
