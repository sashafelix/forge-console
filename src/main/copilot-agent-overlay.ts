import { promises as fs, rmSync, writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const AGENT_ROOTS = [path.join('.github', 'agents'), path.join('.claude', 'agents')];
const MAX_AGENT_FILES = 300;
const MAX_AGENT_FILE_BYTES = 1024 * 1024;

interface OverlayEntry {
  targetPath: string;
  existed: boolean;
  content?: Buffer;
  mode?: number;
}

export interface CopilotAgentOverlay {
  copiedFiles: string[];
  cleanup(): void;
}

async function regularFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (files.length >= MAX_AGENT_FILES) throw new Error(`Agent library exceeds the runtime overlay limit of ${MAX_AGENT_FILES} files`);
      if (entry.isSymbolicLink()) continue;
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile() && /\.md$/i.test(entry.name)) files.push(candidate);
    }
  };
  await visit(root);
  return files;
}

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function removeEmptyParents(start: string, stop: string): void {
  let current = path.dirname(start);
  while (within(stop, current) && current !== stop) {
    try {
      rmSync(current, { recursive: false });
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

export async function createCopilotAgentOverlay(sourceRoot: string, worktreeRoot: string): Promise<CopilotAgentOverlay> {
  const realSource = await fs.realpath(path.resolve(sourceRoot));
  const realWorktree = await fs.realpath(path.resolve(worktreeRoot));
  const entries: OverlayEntry[] = [];
  const copiedFiles: string[] = [];
  let cleaned = false;

  try {
    for (const relativeRoot of AGENT_ROOTS) {
      const sourceDirectory = path.join(realSource, relativeRoot);
      for (const sourcePath of await regularFiles(sourceDirectory)) {
        const details = await fs.lstat(sourcePath);
        if (!details.isFile() || details.isSymbolicLink()) continue;
        if (details.size > MAX_AGENT_FILE_BYTES) throw new Error(`Agent definition is too large for runtime overlay: ${sourcePath}`);

        const relativePath = path.relative(realSource, sourcePath);
        if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
          throw new Error('Agent overlay source escapes the selected agent library');
        }
        const targetPath = path.resolve(realWorktree, relativePath);
        if (!within(realWorktree, targetPath)) throw new Error('Agent overlay target escapes the isolated worktree');

        let existing: OverlayEntry = { targetPath, existed: false };
        try {
          const targetDetails = await fs.lstat(targetPath);
          if (!targetDetails.isFile() || targetDetails.isSymbolicLink()) {
            throw new Error(`Cannot overlay agent onto non-regular target: ${relativePath}`);
          }
          existing = {
            targetPath,
            existed: true,
            content: await fs.readFile(targetPath),
            mode: targetDetails.mode
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }

        const content = await fs.readFile(sourcePath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, content, { mode: details.mode & 0o777 });
        entries.push(existing);
        copiedFiles.push(relativePath);
      }
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.existed && entry.content) {
        mkdirSync(path.dirname(entry.targetPath), { recursive: true });
        writeFileSync(entry.targetPath, entry.content);
        if (entry.mode !== undefined) chmodSync(entry.targetPath, entry.mode & 0o777);
      } else if (existsSync(entry.targetPath)) {
        rmSync(entry.targetPath, { force: true });
        removeEmptyParents(entry.targetPath, realWorktree);
      }
    }
    throw error;
  }

  return {
    copiedFiles,
    cleanup() {
      if (cleaned) return;
      cleaned = true;
      for (const entry of [...entries].reverse()) {
        if (entry.existed && entry.content) {
          mkdirSync(path.dirname(entry.targetPath), { recursive: true });
          writeFileSync(entry.targetPath, entry.content);
          if (entry.mode !== undefined) chmodSync(entry.targetPath, entry.mode & 0o777);
        } else {
          rmSync(entry.targetPath, { force: true });
          removeEmptyParents(entry.targetPath, realWorktree);
        }
      }
    }
  };
}
