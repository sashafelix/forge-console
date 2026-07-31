import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import type { AgentDefinition, AgentInputDefinition, Capability, ProcessRuntimeId } from '../shared/contracts';

const MAX_FILES = 250;
const MAX_BYTES = 768 * 1024;
const DIRECTORIES = ['agents', path.join('.github', 'agents'), path.join('.claude', 'agents')];
const MCP_FILES = [path.join('.github', 'mcp.json'), '.mcp.json', path.join('.vscode', 'mcp.json')];
const RUNTIMES: ProcessRuntimeId[] = ['claude-code', 'github-copilot'];

function humanize(value: string): string {
  return value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function frontmatter(source: string): Record<string, string | string[]> {
  const block = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!block) return {};
  const result: Record<string, string | string[]> = {};
  for (const line of block.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim().replace(/^['"]|['"]$/g, '');
    result[match[1]] = match[1] === 'tools'
      ? value.replace(/^\[|\]$/g, '').split(',').map((entry) => entry.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
      : value;
  }
  return result;
}

function section(source: string, heading: string): string {
  const match = source.match(new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s+|$)`, 'im'));
  return match?.[1]?.trim() ?? '';
}

function bullets(source: string, heading: string): string[] {
  return section(source, heading).split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function variables(source: string): string[] {
  return [...new Set([...source.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g)].map((match) => match[1]))].sort();
}

async function repositoryVariables(root: string): Promise<string[]> {
  const found = new Set<string>();
  for (const relative of MCP_FILES) {
    try {
      for (const name of variables(await fs.readFile(path.join(root, relative), 'utf8'))) found.add(name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return [...found].sort();
}

function inputs(source: string): AgentInputDefinition[] {
  const explicit = [...new Set([...source.matchAll(/\$\{input:([A-Za-z][A-Za-z0-9_.-]*)\}/g)].map((match) => match[1]))].sort();
  if (explicit.length > 0) {
    return explicit.map((name) => ({
      name,
      title: humanize(name),
      description: `Value substituted for \${input:${name}} in the agent instructions.`,
      required: true
    }));
  }
  const examples = bullets(source, 'Inputs').slice(0, 4);
  return [{
    name: 'instruction',
    title: 'Operator instruction',
    description: examples.length > 0 ? `Tell the workflow what to do. Examples: ${examples.join(' · ')}` : 'Tell the workflow exactly what to do.',
    required: true
  }];
}

function capabilities(source: string, tools: string[], writes: string[]): Capability[] {
  const normalized = tools.map((tool) => tool.toLowerCase());
  const result = new Set<Capability>(['repository.read', 'structured.output', 'git.worktree']);
  if (writes.length > 0 || normalized.some((tool) => ['edit', 'create', 'write', 'apply_patch'].includes(tool))) result.add('repository.write');
  if (normalized.some((tool) => ['bash', 'shell', 'terminal'].includes(tool))) result.add('command.execute');
  if (/\bjira\b/i.test(source)) result.add('jira.read');
  if (/\bconfluence\b/i.test(source)) result.add('confluence.read');
  if (/\bmcp\b/i.test(source)) result.add('mcp.tools');
  return [...result];
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function isAgentFile(file: string, source: string): boolean {
  const name = path.basename(file);
  if (/^readme(?:\.agent)?\.md$/i.test(name)) return false;
  if (/\.agent\.md$/i.test(name)) return true;
  const meta = frontmatter(source);
  return typeof meta.name === 'string' || Array.isArray(meta.tools) || /^#\s+Agent\s*:/im.test(source);
}

function parseAgent(root: string, file: string, source: string, repositoryEnvironment: string[]): AgentDefinition {
  const meta = frontmatter(source);
  const filename = path.basename(file).replace(/\.agent\.md$|\.md$/i, '');
  const heading = source.match(/^#\s+Agent\s*:\s*(.+)$/im)?.[1]?.trim();
  const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim() : heading || filename;
  const tools = Array.isArray(meta.tools) ? [...new Set(meta.tools)] : [];
  const writes = bullets(source, 'Writes');
  const requestedCapabilities = capabilities(source, tools, writes);
  const requiredEnvironment = new Set(variables(source));
  if (/\bjira\b|\bconfluence\b|\bmcp\b/i.test(source)) repositoryEnvironment.forEach((value) => requiredEnvironment.add(value));
  const relativePath = path.relative(root, file);
  const purpose = section(source, 'Purpose').replace(/\s+/g, ' ').trim();
  const declaredTurns = source.match(/(?:~|about\s+)?(\d{1,3})\s+tool calls/i)?.[1];
  return {
    id: safeId(name),
    name,
    version: typeof meta.version === 'string' && meta.version.trim() ? meta.version.trim() : 'unversioned',
    description: typeof meta.description === 'string' && meta.description.trim() ? meta.description.trim() : purpose.slice(0, 360) || `Agent discovered at ${relativePath}.`,
    sourceRoot: root,
    sourcePath: file,
    relativePath,
    tools,
    inputs: inputs(source),
    writes,
    requiredEnvironment: [...requiredEnvironment].sort(),
    requestedCapabilities,
    shellRequested: requestedCapabilities.includes('command.execute'),
    networkRequested: /https?:\/\/|\bcurl\b|\bwget\b|\bjira\b|\bconfluence\b|\bmcp\b/i.test(source),
    writeRequested: requestedCapabilities.includes('repository.write'),
    maxTurns: declaredTurns ? Math.max(1, Math.min(100, Number(declaredTurns))) : 30,
    supportedRuntimes: RUNTIMES
  };
}

function assertRelative(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Agent path must be relative to its source repository');
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('Agent path escapes its source repository');
}

export async function resolveAgentDefinition(sourceRoot: string, relativePath: string): Promise<{ definition: AgentDefinition; source: string }> {
  assertRelative(relativePath);
  const root = await fs.realpath(path.resolve(sourceRoot));
  const file = await fs.realpath(path.resolve(root, relativePath));
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) throw new Error('Agent path escapes its source repository');
  const details = await fs.lstat(file);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('Agent definition must be a regular file');
  if (details.size > MAX_BYTES) throw new Error('Agent definition is too large');
  const original = await fs.readFile(file, 'utf8');
  if (!isAgentFile(file, original)) throw new Error('Selected file is not an agent definition');
  const definition = parseAgent(root, file, original, await repositoryVariables(root));
  const source = definition.inputs.some((input) => input.name === 'instruction')
    ? `${original.trim()}\n\n## Operator request\n\${input:instruction}\n`
    : original;
  return { definition, source };
}

async function collect(root: string): Promise<string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (result.length >= MAX_FILES) throw new Error(`Agent library exceeds the limit of ${MAX_FILES} files`);
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) result.push(candidate);
    }
  };
  for (const directory of DIRECTORIES) await visit(path.join(root, directory));
  return [...new Set(result)].sort();
}

export async function discoverAgents(sourceRoot: string): Promise<AgentDefinition[]> {
  const root = await fs.realpath(path.resolve(sourceRoot));
  const environment = await repositoryVariables(root);
  const result: AgentDefinition[] = [];
  for (const file of await collect(root)) {
    const details = await fs.lstat(file);
    if (details.size > MAX_BYTES) continue;
    const source = await fs.readFile(file, 'utf8');
    if (isAgentFile(file, source)) result.push(parseAgent(root, file, source, environment));
  }
  return result.sort((left, right) => left.name.localeCompare(right.name) || left.relativePath.localeCompare(right.relativePath));
}
