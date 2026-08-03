import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import type { AgentDefinition, AgentInputDefinition, Capability, ProcessRuntimeId } from '../shared/contracts';

const MAX_AGENT_FILES = 250;
const MAX_AGENT_FILE_BYTES = 768 * 1024;
const AGENT_DIRECTORIES = ['agents', path.join('.github', 'agents'), path.join('.claude', 'agents')];
const SUPPORTED_RUNTIMES: ProcessRuntimeId[] = ['claude-code', 'github-copilot'];

function humanize(value: string): string {
  return value.replace(/[._-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function scalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function parseInlineArray(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((entry): entry is string => typeof entry === 'string');
  } catch {
    // Fall through to the permissive parser.
  }
  return trimmed.replace(/^\[|\]$/g, '').split(',').map((entry) => scalar(entry)).filter(Boolean);
}

function parseFrontmatter(source: string): Record<string, string | string[]> {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result: Record<string, string | string[]> = {};
  for (let index = 0; index < lines.length; index += 1) {
    const keyMatch = lines[index].match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!keyMatch) continue;
    const [, key, rawValue] = keyMatch;
    if (rawValue === '>' || rawValue === '|') {
      const values: string[] = [];
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1;
        values.push(lines[index].trim());
      }
      result[key] = values.join(rawValue === '>' ? ' ' : '\n').trim();
    } else {
      result[key] = key === 'tools' ? parseInlineArray(rawValue) : scalar(rawValue);
    }
  }
  return result;
}

function isAgentDocument(sourcePath: string, source: string): boolean {
  const filename = path.basename(sourcePath);
  if (/^readme\.md$/i.test(filename)) return false;
  if (/\.agent\.md$/i.test(filename)) return true;
  const frontmatter = parseFrontmatter(source);
  return typeof frontmatter.name === 'string'
    && frontmatter.name.trim().length > 0
    && (typeof frontmatter.description === 'string' || Array.isArray(frontmatter.tools));
}

function isOrchestrator(name: string, sourcePath: string, source: string): boolean {
  const identity = `${name} ${path.basename(sourcePath)}`;
  if (/\borchestrat(?:or|e|ion)\b/i.test(identity)) return true;
  if (/^#{1,3}\s+.*\b(?:orchestrator|full pipeline)\b/im.test(source)) return true;
  if (/\b(?:stage execution|stage transitions|for each stage|invoke only the declared owner|bounded remediation and closure)\b/i.test(source)) return true;
  return /\bPREPARE\b[\s\S]{0,300}(?:→|->)[\s\S]{0,300}\b(?:VERIFY|CONVERGE)\b/i.test(source);
}

function isInteractiveAgent(name: string, sourcePath: string, source: string): boolean {
  const identity = `${name} ${path.basename(sourcePath)}`;
  return /\b(?:story[-_ ]?intake|intake|interview|conversation|chat)\b/i.test(identity)
    || /\b(?:ask_user|AskUserQuestion|ask one (?:purposeful )?question at a time|wait for (?:the )?(?:operator|user|human|product owner)|operator response|user response|human response|clarifying question|approve,? amend,? or deny|explicit approval command)\b/i.test(source);
}

function inferredOrchestratorTools(source: string, orchestrator: boolean): string[] {
  if (!orchestrator) return [];
  const inferred = new Set<string>(['Task']);
  if (/```(?:bash|sh|shell|powershell|cmd)\b|\b(?:python3?|npm|npx|git)\s+[A-Za-z0-9_.\/-]+/i.test(source)) inferred.add('Bash');
  if (/\b(?:implement|refactor|create|write|edit|modify|green)\b/i.test(source)) {
    inferred.add('Write');
    inferred.add('Edit');
  }
  return [...inferred];
}

function extractInputs(source: string, orchestrator: boolean): AgentInputDefinition[] {
  const names = new Set<string>();
  for (const match of source.matchAll(/\$\{input:([A-Za-z][A-Za-z0-9_.-]*)\}/g)) names.add(match[1]);
  const inputs = [...names].sort().map((name) => ({
    name,
    title: humanize(name),
    description: `Value substituted for \${input:${name}} in the agent instructions.`,
    required: true
  }));
  if (!names.has('task') && (orchestrator || names.size === 0)) {
    inputs.unshift({
      name: 'task',
      title: orchestrator ? 'Workflow task' : 'Task',
      description: orchestrator
        ? 'Describe the outcome needed from the complete workflow, for example: Review NSCNL-123456.'
        : 'Describe what this specialist should do.',
      required: true
    });
  }
  return inputs;
}

function extractSectionBullets(source: string, heading: string): string[] {
  const start = source.search(new RegExp(`^##\\s+${heading}\\s*$`, 'im'));
  if (start < 0) return [];
  const afterHeading = source.slice(start).replace(/^##[^\r\n]*(?:\r?\n)?/, '');
  const nextHeading = afterHeading.search(/^##\s+/m);
  const section = nextHeading >= 0 ? afterHeading.slice(0, nextHeading) : afterHeading;
  return section.split(/\r?\n/).map((line) => line.match(/^\s*-\s+(.+)$/)?.[1]?.trim()).filter((value): value is string => Boolean(value));
}

function requestedCapabilities(tools: string[], source: string, interactive: boolean): Capability[] {
  const normalized = new Set(tools.map((tool) => tool.toLowerCase()));
  const capabilities = new Set<Capability>(['repository.read', 'structured.output', 'git.worktree']);
  if (['edit', 'create', 'write', 'apply_patch'].some((tool) => normalized.has(tool))) capabilities.add('repository.write');
  if (['bash', 'shell', 'terminal'].some((tool) => normalized.has(tool))) capabilities.add('command.execute');
  if (/\bjira\b|ATC_JIRA_TOKEN/i.test(source)) capabilities.add('jira.read');
  if (/\bconfluence\b|ATC_CONFLUENCE_TOKEN/i.test(source)) capabilities.add('confluence.read');
  if (/\bmcp\b/i.test(source)) capabilities.add('mcp.tools');
  if (interactive) capabilities.add('user.input');
  return [...capabilities];
}

function requiredEnvironment(source: string): string[] {
  const variables = new Set<string>();
  for (const match of source.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g)) variables.add(match[1]);
  return [...variables].sort();
}

function inferredMaxTurns(source: string): number {
  const declared = source.match(/(?:~|about\s+)?(\d{1,3})\s+tool calls/i)?.[1];
  return declared ? Math.max(1, Math.min(100, Number(declared))) : 30;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'agent';
}

function parseAgent(sourceRoot: string, sourcePath: string, source: string): AgentDefinition {
  const frontmatter = parseFrontmatter(source);
  const filename = path.basename(sourcePath).replace(/\.agent\.md$|\.md$/i, '');
  const rawName = typeof frontmatter.name === 'string' && frontmatter.name.trim() ? frontmatter.name.trim() : filename;
  const orchestrator = isOrchestrator(rawName, sourcePath, source);
  const interactive = isInteractiveAgent(rawName, sourcePath, source);
  const name = orchestrator ? `${rawName} · Full pipeline` : rawName;
  const declaredTools = Array.isArray(frontmatter.tools) ? frontmatter.tools.map((tool) => tool.trim()).filter(Boolean) : [];
  const tools = [...new Set([...declaredTools, ...inferredOrchestratorTools(source, orchestrator)])];
  const capabilities = requestedCapabilities(tools, source, interactive);
  return {
    id: safeId(rawName),
    name,
    version: typeof frontmatter.version === 'string' && frontmatter.version.trim() ? frontmatter.version.trim() : 'unversioned',
    description: typeof frontmatter.description === 'string' && frontmatter.description.trim() ? frontmatter.description.trim() : `Standalone agent discovered at ${path.relative(sourceRoot, sourcePath)}.`,
    sourceRoot,
    sourcePath,
    relativePath: path.relative(sourceRoot, sourcePath),
    tools,
    inputs: extractInputs(source, orchestrator),
    writes: extractSectionBullets(source, 'Writes'),
    requiredEnvironment: requiredEnvironment(source),
    requestedCapabilities: capabilities,
    shellRequested: capabilities.includes('command.execute'),
    networkRequested: /https?:\/\/|\bcurl\b|\bwget\b|\bjira\b|\bconfluence\b/i.test(source),
    writeRequested: capabilities.includes('repository.write'),
    interactive,
    maxTurns: inferredMaxTurns(source),
    supportedRuntimes: SUPPORTED_RUNTIMES
  };
}

function assertRelativeAgentPath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Agent path must be relative to its source repository');
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('Agent path escapes its source repository');
}

export async function resolveAgentDefinition(sourceRoot: string, relativePath: string): Promise<{ definition: AgentDefinition; source: string }> {
  assertRelativeAgentPath(relativePath);
  const realRoot = await fs.realpath(path.resolve(sourceRoot));
  const realPath = await fs.realpath(path.resolve(realRoot, relativePath));
  if (realPath !== realRoot && !realPath.startsWith(`${realRoot}${path.sep}`)) throw new Error('Agent path escapes its source repository');
  const details = await fs.lstat(realPath);
  if (!details.isFile() || details.isSymbolicLink()) throw new Error('Agent definition must be a regular file');
  if (details.size > MAX_AGENT_FILE_BYTES) throw new Error('Agent definition is too large');
  let source = await fs.readFile(realPath, 'utf8');
  if (!isAgentDocument(realPath, source)) throw new Error('Selected Markdown file is not a valid agent definition');
  const definition = parseAgent(realRoot, realPath, source);
  if (definition.inputs.some((input) => input.name === 'task') && !/\$\{input:task\}/.test(source)) {
    source = `${source.trim()}\n\n## Operator task\n\n\${input:task}\n`;
  }
  return { definition, source };
}

async function collectAgentFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (files.length >= MAX_AGENT_FILES) throw new Error(`Agent library exceeds the limit of ${MAX_AGENT_FILES} agent files`);
      const candidate = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && /\.md$/i.test(entry.name) && !/^readme\.md$/i.test(entry.name)) files.push(candidate);
    }
  };
  for (const relativeDirectory of AGENT_DIRECTORIES) await visit(path.join(root, relativeDirectory));
  return [...new Set(files)].sort();
}

export async function discoverAgents(sourceRoot: string): Promise<AgentDefinition[]> {
  const realRoot = await fs.realpath(path.resolve(sourceRoot));
  const files = await collectAgentFiles(realRoot);
  const agents: AgentDefinition[] = [];
  for (const sourcePath of files) {
    const details = await fs.lstat(sourcePath);
    if (details.size > MAX_AGENT_FILE_BYTES) continue;
    const source = await fs.readFile(sourcePath, 'utf8');
    if (!isAgentDocument(sourcePath, source)) continue;
    agents.push(parseAgent(realRoot, sourcePath, source));
  }
  return agents.sort((left, right) => left.name.localeCompare(right.name) || left.relativePath.localeCompare(right.relativePath));
}
