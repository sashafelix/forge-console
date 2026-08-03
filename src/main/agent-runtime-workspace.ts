import { copyFileSync, existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';
import { discoverAgents } from './agents';

const MANIFEST_NAME = 'runtime-workspace.json';
const BACKUP_DIRECTORY = 'runtime-workspace-backup';
const MAX_FILES = 2_000;
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;

const SUPPORT_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  path.join('.github', 'copilot-instructions.md'),
  path.join('.github', 'project-config.yaml'),
  path.join('.github', 'skills'),
  path.join('.claude', 'skills'),
  'rubric',
  'steps',
  'Reference',
  path.join('docs', 'risk-register.md'),
  path.join('docs', 'glossary.md'),
  path.join('docs', 'mcp.md'),
  path.join('docs', 'adr'),
  path.join('docs', 'agent', 'templates')
];

interface RuntimeWorkspaceEntry {
  relativePath: string;
  existed: boolean;
  backupRelativePath?: string;
}

interface RuntimeWorkspaceManifest {
  schemaVersion: '1.0';
  sourceRoot: string;
  worktreeRoot: string;
  agentId: string;
  mcpConfigPath?: string;
  entries: RuntimeWorkspaceEntry[];
  restored: boolean;
}

export interface PreparedAgentRuntimeWorkspace {
  agentId: string;
  mcpConfigPath?: string;
  injectedFiles: number;
}

function stripFrontmatter(source: string): string {
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trim();
}

function stripMarkdownSuffix(filename: string): string {
  return filename.replace(/\.agent\.md$|\.md$/i, '');
}

function displayName(value: string): string {
  return value.replace(/\s+·\s+Full pipeline$/i, '').trim();
}

function generatedAgentProfile(name: string, description: string, source: string): string {
  return ['---', `name: ${JSON.stringify(displayName(name))}`, `description: ${JSON.stringify(description)}`, 'tools:', '  - "*"', '---', '', stripFrontmatter(source), ''].join('\n');
}

function safeRelative(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath)) throw new Error('Runtime workspace path must be relative');
  const normalized = path.normalize(relativePath);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) throw new Error('Runtime workspace path escapes the worktree');
  return normalized;
}

async function exists(candidate: string): Promise<boolean> {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicJsonWrite(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, target);
}

async function collectFiles(root: string, relativePath: string): Promise<string[]> {
  const start = path.join(root, safeRelative(relativePath));
  let details;
  try {
    details = await fs.lstat(start);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (details.isSymbolicLink()) return [];
  if (details.isFile()) return [safeRelative(relativePath)];
  if (!details.isDirectory()) return [];

  const files: string[] = [];
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    const entries: Dirent[] = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= MAX_FILES) throw new Error(`Agent runtime context exceeds ${MAX_FILES} files`);
      const child = path.join(directory, entry.name);
      const childRelative = safeRelative(path.join(relativeDirectory, entry.name));
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(child, childRelative);
      else if (entry.isFile()) files.push(childRelative);
    }
  };
  await visit(start, safeRelative(relativePath));
  return files;
}

export async function prepareAgentRuntimeWorkspace(sourceRoot: string, worktreeRoot: string, storagePath: string, selectedAgentRelativePath: string): Promise<PreparedAgentRuntimeWorkspace> {
  const realSource = await fs.realpath(path.resolve(sourceRoot));
  const realWorktree = await fs.realpath(path.resolve(worktreeRoot));
  const backupRoot = path.join(storagePath, BACKUP_DIRECTORY);
  await fs.rm(backupRoot, { recursive: true, force: true });
  await fs.mkdir(backupRoot, { recursive: true, mode: 0o700 });

  const manifest: RuntimeWorkspaceManifest = { schemaVersion: '1.0', sourceRoot: realSource, worktreeRoot: realWorktree, agentId: stripMarkdownSuffix(path.basename(selectedAgentRelativePath)), entries: [], restored: false };
  const recorded = new Set<string>();
  let totalBytes = 0;

  const inject = async (relativePath: string, content: Buffer | string): Promise<void> => {
    const normalized = safeRelative(relativePath);
    const target = path.join(realWorktree, normalized);
    if (!recorded.has(normalized)) {
      recorded.add(normalized);
      const targetExists = await exists(target);
      const entry: RuntimeWorkspaceEntry = { relativePath: normalized, existed: targetExists };
      if (targetExists) {
        const details = await fs.lstat(target);
        if (!details.isFile() || details.isSymbolicLink()) throw new Error(`Cannot overlay non-file path ${normalized}`);
        const backupRelativePath = path.join('files', `${manifest.entries.length}.backup`);
        const backup = path.join(backupRoot, backupRelativePath);
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.copyFile(target, backup);
        entry.backupRelativePath = backupRelativePath;
      }
      manifest.entries.push(entry);
    }
    const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
    totalBytes += size;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Agent runtime context exceeds the 200 MB safety limit');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, { mode: 0o600 });
  };

  for (const agent of await discoverAgents(realSource)) {
    const source = await fs.readFile(agent.sourcePath, 'utf8');
    const filename = path.basename(agent.relativePath).replace(/\.md$/i, '.agent.md');
    await inject(path.join('.github', 'agents', filename), generatedAgentProfile(agent.name, agent.description, source));
  }
  for (const supportPath of SUPPORT_PATHS) {
    for (const relativeFile of await collectFiles(realSource, supportPath)) await inject(relativeFile, await fs.readFile(path.join(realSource, relativeFile)));
  }
  for (const candidate of [path.join(realSource, '.github', 'mcp.json'), path.join(realSource, '.mcp.json')]) {
    try {
      const content = await fs.readFile(candidate);
      JSON.parse(content.toString('utf8'));
      await inject('.mcp.json', content);
      manifest.mcpConfigPath = path.join(realWorktree, '.mcp.json');
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw new Error(`Unable to stage MCP configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await atomicJsonWrite(path.join(storagePath, MANIFEST_NAME), manifest);
  return { agentId: manifest.agentId, mcpConfigPath: manifest.mcpConfigPath, injectedFiles: manifest.entries.length };
}

export function restoreAgentRuntimeWorkspaceSync(storagePath: string): number {
  const manifestPath = path.join(storagePath, MANIFEST_NAME);
  if (!existsSync(manifestPath)) return 0;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as RuntimeWorkspaceManifest;
  if (manifest.schemaVersion !== '1.0' || manifest.restored) return 0;
  const backupRoot = path.join(storagePath, BACKUP_DIRECTORY);
  for (const entry of [...manifest.entries].reverse()) {
    const target = path.join(manifest.worktreeRoot, safeRelative(entry.relativePath));
    if (entry.existed && entry.backupRelativePath) {
      const parent = path.dirname(target);
      if (!existsSync(parent)) fs.mkdir(parent, { recursive: true });
      copyFileSync(path.join(backupRoot, entry.backupRelativePath), target);
    } else if (existsSync(target) && lstatSync(target).isFile()) {
      rmSync(target, { force: true });
    }
  }
  manifest.restored = true;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return manifest.entries.length;
}

export async function runtimeWorkspaceDetails(storagePath: string): Promise<PreparedAgentRuntimeWorkspace | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(storagePath, MANIFEST_NAME), 'utf8')) as RuntimeWorkspaceManifest;
    return { agentId: manifest.agentId, mcpConfigPath: manifest.mcpConfigPath, injectedFiles: manifest.entries.length };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
