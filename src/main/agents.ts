import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  AgentDefinition,
  CreateRunDraftRequest,
  PipelineManifest,
  PrepareAgentExecutionRequest,
  ProjectSelection
} from '../shared/contracts';
import type { ResolvedPipelinePack } from './packs';

const AGENT_FILE_SUFFIX = '.agent.md';
const MAX_AGENT_FILES = 250;
const MAX_AGENT_BYTES = 1024 * 1024;
const SEARCH_DIRECTORIES = ['agents', '.github/agents', '.claude/agents'];

interface ParsedAgent {
  name: string;
  version: string;
  description: string;
  tools: string[];
  body: string;
}

function parseStringArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return [];
  try {
    const parsed = JSON.parse(trimmed.replaceAll("'", '"')) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseFrontmatter(source: string, fallbackName: string): ParsedAgent {
  if (!source.startsWith('---\n')) {
    return { name: fallbackName, version: '0.0.0', description: '', tools: [], body: source };
  }
  const end = source.indexOf('\n---\n', 4);
  if (end < 0) throw new Error(`Agent ${fallbackName} has unterminated frontmatter`);
  const header = source.slice(4, end);
  const body = source.slice(end + 5).trim();
  const values = new Map<string, string>();
  let multilineKey: string | null = null;
  for (const rawLine of header.split(/\r?\n/)) {
    const match = rawLine.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
    if (match) {
      multilineKey = match[2] === '>' || match[2] === '|' ? match[1] : null;
      values.set(match[1], multilineKey ? '' : match[2].replace(/^['"]|['"]$/g, ''));
      continue;
    }
    if (multilineKey && rawLine.trim()) {
      values.set(multilineKey, `${values.get(multilineKey) ?? ''} ${rawLine.trim()}`.trim());
    }
  }
  return {
    name: values.get('name') || fallbackName,
    version: values.get('version') || '0.0.0',
    description: values.get('description') || '',
    tools: parseStringArray(values.get('tools') || '[]'),
    body
  };
}

function extractInputs(body: string): string[] {
  return [...new Set([...body.matchAll(/\$\{input:([a-zA-Z][a-zA-Z0-9_-]*)\}/g)].map((match) => match[1]))].sort();
}

function extractWrites(body: string): string[] {
  const section = body.match(/## Writes\s*\n([\s\S]*?)(?=\n## |$)/i)?.[1] ?? '';
  return section.split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s+`([^`]+)`/)?.[1])
    .filter((entry): entry is string => Boolean(entry));
}

function networkRequired(body: string): boolean {
  return /https?:\/\//i.test(body) || /\b(curl|jira|confluence|mcp)\b/i.test(body);
}

async function projectSelection(directory: string): Promise<ProjectSelection> {
  const resolved = await fs.realpath(path.resolve(directory));
  let isGitRepository = false;
  try {
    const gitEntry = await fs.stat(path.join(resolved, '.git'));
    isGitRepository = gitEntry.isDirectory() || gitEntry.isFile();
  } catch {
    isGitRepository = false;
  }
  return { name: path.basename(resolved), path: resolved, isGitRepository };
}

async function collectAgentFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  for (const relativeDirectory of SEARCH_DIRECTORIES) {
    const directory = path.join(root, relativeDirectory);
    let entries: Array<import('node:fs').Dirent>;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isFile() && entry.name.endsWith(AGENT_FILE_SUFFIX)) files.push(path.join(directory, entry.name));
      if (files.length > MAX_AGENT_FILES) throw new Error(`Agent library exceeds ${MAX_AGENT_FILES} agent files`);
    }
  }
  return files.sort();
}

export async function discoverAgents(sourceRepository: ProjectSelection): Promise<AgentDefinition[]> {
  const source = await projectSelection(sourceRepository.path);
  const root = await fs.realpath(source.path);
  const definitions: AgentDefinition[] = [];
  for (const file of await collectAgentFiles(root)) {
    const realFile = await fs.realpath(file);
    if (!realFile.startsWith(`${root}${path.sep}`)) throw new Error('Agent file escapes the selected library');
    const details = await fs.stat(realFile);
    if (details.size > MAX_AGENT_BYTES) throw new Error(`Agent file is larger than ${MAX_AGENT_BYTES} bytes: ${realFile}`);
    const fallbackName = path.basename(realFile, AGENT_FILE_SUFFIX);
    const parsed = parseFrontmatter(await fs.readFile(realFile, 'utf8'), fallbackName);
    const tools = parsed.tools.map((tool) => tool.toLowerCase());
    definitions.push({
      id: `${parsed.name}@${parsed.version}`,
      name: parsed.name,
      version: parsed.version,
      description: parsed.description,
      sourcePath: path.relative(root, realFile).replaceAll('\\', '/'),
      sourceRepository: source,
      tools: parsed.tools,
      inputs: extractInputs(parsed.body),
      writes: extractWrites(parsed.body),
      requiresShell: tools.includes('bash') || tools.includes('shell'),
      requiresNetwork: networkRequired(parsed.body)
    });
  }
  return definitions.sort((a, b) => a.name.localeCompare(b.name));
}

function substituteInputs(body: string, inputs: Record<string, unknown>): string {
  return body.replace(/\$\{input:([a-zA-Z][a-zA-Z0-9_-]*)\}/g, (_match, key: string) => {
    const value = inputs[key];
    if (value === undefined || value === null || String(value).trim() === '') throw new Error(`Missing required agent input: ${key}`);
    return String(value);
  });
}

function safeId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'agent';
}

export async function createAgentExecutionPack(request: PrepareAgentExecutionRequest): Promise<{
  request: CreateRunDraftRequest;
  pack: ResolvedPipelinePack;
}> {
  const target = await projectSelection(request.targetProject.path);
  if (!target.isGitRepository) throw new Error('The target code repository must be a Git repository');
  const sourceRoot = await fs.realpath(request.agent.sourceRepository.path);
  const sourceFile = await fs.realpath(path.join(sourceRoot, request.agent.sourcePath));
  if (!sourceFile.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('Agent source escapes the selected library');
  const parsed = parseFrontmatter(await fs.readFile(sourceFile, 'utf8'), request.agent.name);
  const renderedAgent = substituteInputs(parsed.body, request.inputs);

  const directory = path.join(app.getPath('userData'), 'generated-agent-packs', randomUUID());
  await fs.mkdir(directory, { recursive: true });
  const promptTemplate = 'agent-prompt.md';
  const guardrails = [
    `You are running the standalone agent ${parsed.name} from ${request.agent.sourceRepository.name}.`,
    `The target code repository is {{workingDirectory}}.`,
    'Follow the agent definition below exactly.',
    '',
    renderedAgent,
    '',
    'Desktop workbench constraints:',
    '- Do not modify production source code when the agent definition forbids it.',
    '- Do not commit, push, merge, deploy, or alter Git metadata.',
    '- Keep all generated files inside the isolated target worktree.',
    '- Finish with a concise summary of evidence, generated artifacts, and unresolved questions.'
  ].join('\n');
  await fs.writeFile(path.join(directory, promptTemplate), guardrails, { encoding: 'utf8', mode: 0o600 });

  const inputProperties = Object.fromEntries(request.agent.inputs.map((name) => [name, {
    type: 'string' as const,
    title: name.replaceAll('-', ' ').replaceAll('_', ' ')
  }]));
  const id = `agent-${safeId(parsed.name)}`;
  const manifest: PipelineManifest = {
    schemaVersion: '1.1',
    id,
    name: parsed.name,
    description: parsed.description || `Standalone agent loaded from ${request.agent.sourceRepository.name}`,
    version: parsed.version,
    inputSchema: { type: 'object', required: request.agent.inputs, properties: inputProperties },
    requiredCapabilities: ['repository.read', 'repository.write', 'git.worktree', ...(request.agent.requiresShell ? ['command.execute' as const] : [])],
    supportedRuntimes: ['claude-code', 'github-copilot'],
    stages: [{
      id: 'agent',
      name: parsed.name,
      description: parsed.description || 'Run the selected standalone agent',
      order: 1,
      role: parsed.name,
      requiredCapabilities: ['repository.read', 'repository.write']
    }],
    execution: {
      mode: 'runtime-prompt',
      isolation: 'git-worktree',
      promptTemplate,
      maxTurns: 40,
      validationCommands: [{
        id: 'diff-check',
        name: 'Git diff integrity',
        executable: 'git',
        args: ['diff', '--check'],
        timeoutSeconds: 60,
        required: true
      }],
      modelShell: request.agent.requiresShell ? 'allowed' : 'denied',
      modelNetwork: request.agent.requiresNetwork ? 'allowed' : 'denied'
    }
  };
  return {
    request: {
      project: target,
      pipelineId: manifest.id,
      pipelineVersion: manifest.version,
      runtimeId: request.runtimeId,
      inputs: request.inputs
    },
    pack: { manifest, directory }
  };
}
