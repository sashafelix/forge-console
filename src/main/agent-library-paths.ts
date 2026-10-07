import { lstatSync } from 'node:fs';
import path from 'node:path';

export const AGENT_DIRECTORIES = ['agents', path.join('.github', 'agents'), path.join('.claude', 'agents')];

export function requireNativeAgentExecutable(executable: string, platform: NodeJS.Platform = process.platform): void {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
    throw new Error('Agent instructions cannot be passed safely through a Windows batch launcher. Choose the native CLI .exe in Pipeline configuration → CLI runtimes.');
  }
}

export function agentDirectoryPriority(relativePath: string): number {
  return AGENT_DIRECTORIES.findIndex((directory) => relativePath.startsWith(`${directory}${path.sep}`));
}

export function safeAgentRelativePath(relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((part) => part === '..')) {
    throw new Error('Agent path escapes its source repository');
  }
  const normalized = path.normalize(relativePath);
  if (agentDirectoryPriority(normalized) < 0 || !/\.md$/i.test(normalized)) {
    throw new Error('Agent definitions must be stored under agents, .github/agents or .claude/agents');
  }
  return normalized;
}

/** Check every existing component, including directory roots, before reading or writing. */
export function assertSafeLibraryPath(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    throw new Error('Agent path escapes its selected directory');
  }
  let current = root;
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Agent library paths cannot contain symlinks');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function copilotAgentRelativePath(relativePath: string): string {
  const normalized = safeAgentRelativePath(relativePath);
  return agentDirectoryPriority(normalized) === 0
    ? path.join('.github', 'agents', path.basename(normalized).replace(/(?:\.agent)?\.md$/i, '.agent.md'))
    : normalized;
}

export function libraryInstructions(root: string): string {
  return `Agent library root: ${root}\nRead AGENTS.md there when present. Resolve agents/, skills/ and library docs/ references from that root. Load only relevant skills/<name>/SKILL.md files; skills inherit the current permissions. The working directory is the target repository.\n`;
}
