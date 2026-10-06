import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { childEnvironment } from './child-environment';
import type { ProcessRuntimeId } from '../shared/contracts';
import { manageAgentProcess } from './agent-processes';
import { createCopilotAgentOverlay } from './copilot-agent-overlay';
import { applyConfiguredNetworkEnvironment } from './network-settings';
import { discoverRuntimeAdapters, requiresCommandShell, runtimeSearchPath } from './runtime';

export interface AgentRuntimeLaunch {
  runtimeId: ProcessRuntimeId;
  cwd: string;
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

interface McpConfig {
  path?: string;
  serverNames: string[];
}

interface CopilotCliCapabilities {
  options: Set<string>;
  helpText: string;
}

const COPILOT_HELP_TIMEOUT_MS = 8_000;
const MAX_HELP_OUTPUT = 256 * 1024;
const copilotCapabilityCache = new Map<string, Promise<CopilotCliCapabilities>>();

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
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new Error(`Unable to read MCP configuration ${candidate}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { serverNames: [] };
}

async function runtimeEnvironment(
  runtimeId: ProcessRuntimeId,
  approvedEnvironment: Record<string, string>
): Promise<NodeJS.ProcessEnv> {
  let env: NodeJS.ProcessEnv = {
    ...childEnvironment(process.env, approvedEnvironment, runtimeId),
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

function stripMarkdownSuffix(filename: string): string {
  return filename.replace(/\.agent\.md$|\.md$/i, '');
}

function agentRelativePathFromPrompt(prompt: string): string | undefined {
  return prompt.match(/^- Selected agent:\s*(.+)$/m)?.[1]?.trim();
}

function safeAgentRelativePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Copilot agent path must be relative to its repository');
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('Copilot agent path escapes its repository');
  const githubAgents = path.join('.github', 'agents');
  const claudeAgents = path.join('.claude', 'agents');
  if (normalized !== githubAgents && normalized !== claudeAgents
    && !normalized.startsWith(`${githubAgents}${path.sep}`)
    && !normalized.startsWith(`${claudeAgents}${path.sep}`)) {
    throw new Error('Copilot custom agents must be stored under .github/agents or .claude/agents');
  }
  return normalized;
}

async function resolveCopilotAgentId(launch: AgentRuntimeLaunch): Promise<string> {
  const requestedPath = launch.agentRelativePath ?? agentRelativePathFromPrompt(launch.prompt);
  if (!requestedPath) throw new Error('The selected Copilot agent path was not supplied to the runtime');
  const relativePath = safeAgentRelativePath(requestedPath);
  const worktreeRoot = await fs.realpath(path.resolve(launch.cwd));
  let worktreeAgentPath: string;
  try {
    worktreeAgentPath = await fs.realpath(path.resolve(worktreeRoot, relativePath));
  } catch {
    throw new Error(`The selected Copilot agent ${relativePath} could not be staged into the isolated target worktree.`);
  }
  if (worktreeAgentPath !== worktreeRoot && !worktreeAgentPath.startsWith(`${worktreeRoot}${path.sep}`)) {
    throw new Error('Copilot agent path escapes the isolated target worktree');
  }
  const details = await fs.stat(worktreeAgentPath);
  if (!details.isFile()) throw new Error('Selected Copilot agent definition is not a file');
  return stripMarkdownSuffix(path.basename(worktreeAgentPath));
}

function customAgentPrompt(prompt: string): string {
  const marker = prompt.lastIndexOf('## Operator task');
  return marker >= 0 ? prompt.slice(marker).trim() : prompt;
}

function secretEnvironmentNames(environment: Record<string, string>): string[] {
  return Object.keys(environment).filter((name) => /(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH)/i.test(name));
}

function collectHelpCapabilities(executable: string, environment: NodeJS.ProcessEnv): Promise<CopilotCliCapabilities> {
  const cached = copilotCapabilityCache.get(executable);
  if (cached) return cached;

  const probe = new Promise<CopilotCliCapabilities>((resolve) => {
    const child = spawn(executable, ['--help'], {
      env: environment,
      shell: requiresCommandShell(executable),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    const collect = (chunk: Buffer) => {
      if (output.length < MAX_HELP_OUTPUT) output += chunk.toString('utf8');
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timeout = setTimeout(() => child.kill(), COPILOT_HELP_TIMEOUT_MS);
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      const options = new Set(output.match(/--[a-z0-9][a-z0-9-]*/gi) ?? []);
      resolve({ options, helpText: output });
    };
    child.once('error', finish);
    child.once('close', finish);
  });
  copilotCapabilityCache.set(executable, probe);
  return probe;
}

function supports(capabilities: CopilotCliCapabilities | undefined, option: string): boolean {
  return !capabilities || capabilities.options.has(option);
}

function requireOption(capabilities: CopilotCliCapabilities | undefined, option: string, purpose: string): void {
  if (!supports(capabilities, option)) {
    throw new Error(`The installed GitHub Copilot CLI does not support ${option}, which is required to ${purpose}. Update the CLI or choose Claude Code.`);
  }
}

function optionalFlag(args: string[], capabilities: CopilotCliCapabilities | undefined, option: string): void {
  if (supports(capabilities, option)) args.push(option);
}

export async function buildCopilotArgs(
  launch: AgentRuntimeLaunch,
  capabilities?: CopilotCliCapabilities
): Promise<string[]> {
  requireOption(capabilities, '--agent', 'run repository custom agents');
  requireOption(capabilities, '--allow-tool', 'approve non-interactive tool use');
  requireOption(capabilities, '--deny-tool', 'enforce denied tool permissions');

  const allowedPermissions = new Set<string>(['read']);
  const deniedPermissions = new Set<string>(['url', 'memory']);
  if (launch.permissions.allowWrite) allowedPermissions.add('write');
  else deniedPermissions.add('write');
  if (launch.permissions.allowShell) allowedPermissions.add('shell');
  else deniedPermissions.add('shell');

  const mcp = await readMcpConfig(launch.agentSourceRoot);
  for (const server of mcp.serverNames) allowedPermissions.add(server);

  const selectedAgent = await resolveCopilotAgentId(launch);
  const secrets = secretEnvironmentNames(launch.environment);
  const args: string[] = [];

  if (supports(capabilities, '--prompt')) args.push('--prompt', customAgentPrompt(launch.prompt));
  else args.push('-p', customAgentPrompt(launch.prompt));
  if (supports(capabilities, '--output-format')) args.push('--output-format=json');
  optionalFlag(args, capabilities, '--no-banner');
  optionalFlag(args, capabilities, '--no-color');
  optionalFlag(args, capabilities, '--no-remote');
  optionalFlag(args, capabilities, '--no-remote-export');
  args.push(`--agent=${selectedAgent}`);

  if (path.resolve(launch.agentSourceRoot) !== path.resolve(launch.cwd) && supports(capabilities, '--add-dir')) {
    args.push('--add-dir', launch.agentSourceRoot);
  }
  if (mcp.path) {
    requireOption(capabilities, '--additional-mcp-config', 'load the selected repository MCP configuration');
    args.push(`--additional-mcp-config=@${mcp.path}`);
    optionalFlag(args, capabilities, '--allow-all-mcp-server-instructions');
  }

  args.push(`--allow-tool=${[...allowedPermissions].join(',')}`);
  args.push(`--deny-tool=${[...deniedPermissions].join(',')}`);
  if (secrets.length > 0 && supports(capabilities, '--secret-env-vars')) args.push(`--secret-env-vars=${secrets.join(',')}`);
  if (launch.sessionId) {
    requireOption(capabilities, '--resume', 'resume an interactive workflow conversation');
    args.push(`--resume=${launch.sessionId}`);
  }
  return args;
}

export async function spawnAgentRuntime(launch: AgentRuntimeLaunch): Promise<ChildProcessWithoutNullStreams> {
  if (!Number.isInteger(launch.maxTurns) || launch.maxTurns < 1 || launch.maxTurns > 100) {
    throw new Error('maxTurns must be from 1 to 100');
  }
  const executable = await resolveExecutable(launch.runtimeId);
  const environment = await runtimeEnvironment(launch.runtimeId, launch.environment);
  const overlay = launch.runtimeId === 'github-copilot'
    ? await createCopilotAgentOverlay(launch.agentSourceRoot, launch.cwd)
    : undefined;

  try {
    const args = launch.runtimeId === 'claude-code'
      ? await claudeArgs(launch)
      : await buildCopilotArgs(launch, await collectHelpCapabilities(executable, environment));
    const child = manageAgentProcess(spawn(executable, args, {
      cwd: launch.cwd,
      env: environment,
      shell: requiresCommandShell(executable),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    }));

    // Registered before controller listeners, so validation observes the restored
    // worktree rather than temporary local agent definitions.
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      overlay?.cleanup();
    };
    child.once('close', cleanup);
    child.once('error', cleanup);

    if (launch.runtimeId === 'claude-code') child.stdin.end(launch.prompt, 'utf8');
    else child.stdin.end();
    return child;
  } catch (error) {
    overlay?.cleanup();
    throw error;
  }
}
