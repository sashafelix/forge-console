import { promises as fs, rmSync, rmdirSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { discoverAgents, readAgentDocument } from './agents';
import { assertSafeLibraryPath, copilotAgentRelativePath, libraryInstructions } from './agent-library-paths';

const NATIVE_ROOTS = [path.join('.github', 'agents'), path.join('.claude', 'agents')];
const MAX_BYTES = 32 * 1024 * 1024;
interface OverlayEntry { targetPath: string; content?: Buffer; mode?: number; }
export interface CopilotAgentOverlay { copiedFiles: string[]; cleanup(): void; }

function removeEmptyParents(start: string, stop: string): void {
  let current = path.dirname(start);
  while (current.startsWith(`${stop}${path.sep}`)) {
    try { rmdirSync(current); } catch { break; }
    current = path.dirname(current);
  }
}

/** Selected library wins for this run. Existing native definitions are restored on exit. */
export async function createCopilotAgentOverlay(sourceRoot: string, worktreeRoot: string): Promise<CopilotAgentOverlay> {
  const realSource = await fs.realpath(path.resolve(sourceRoot));
  const realWorktree = await fs.realpath(path.resolve(worktreeRoot));
  if (realSource === realWorktree) throw new Error('Agent overlays require an isolated target worktree');
  const staged = new Map<string, string>();
  const names = new Set<string>();
  let bytes = 0;
  for (const agent of await discoverAgents(realSource)) {
    const relative = copilotAgentRelativePath(agent.relativePath);
    const name = path.basename(relative).replace(/(?:\.agent)?\.md$/i, '').toLowerCase();
    if (names.has(name)) throw new Error(`Ambiguous Copilot agent filename: ${name}`);
    names.add(name);
    const { source } = await readAgentDocument(realSource, agent.relativePath);
    const content = agent.relativePath.startsWith(`agents${path.sep}`)
      ? `---\nname: ${JSON.stringify(agent.id)}\ndescription: ${JSON.stringify(agent.description)}\n---\n\n${libraryInstructions(realSource)}\nRead the full canonical agent instructions at ${agent.sourcePath} before starting. Follow that role and its required outputs.\n`
      : source;
    if ((bytes += Buffer.byteLength(content)) > MAX_BYTES) throw new Error('Agent runtime library exceeds 32 MiB');
    staged.set(relative, content);
  }

  // Back up native Markdown, including stale mirrors, before changing anything.
  const entries = new Map<string, OverlayEntry>();
  const visit = async (relative: string, depth = 0): Promise<void> => {
    if (depth > 12) throw new Error('Agent overlay nesting limit exceeded');
    const directory = path.join(realWorktree, relative);
    assertSafeLibraryPath(realWorktree, directory);
    let children;
    try { children = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    for (const child of children) {
      if (child.isSymbolicLink()) throw new Error('Agent overlay target cannot contain symlinks');
      const name = path.join(relative, child.name);
      if (child.isDirectory()) await visit(name, depth + 1);
      else if (child.isFile() && /\.md$/i.test(child.name)) {
        const targetPath = path.join(realWorktree, name);
        const info = await fs.lstat(targetPath);
        if (entries.size >= 300 || info.size > 1024 * 1024 || (bytes += info.size) > MAX_BYTES) {
          throw new Error('Existing agent definitions exceed the overlay backup limit');
        }
        entries.set(name, { targetPath, content: await fs.readFile(targetPath), mode: info.mode });
      }
    }
  };
  for (const relative of NATIVE_ROOTS) await visit(relative);
  for (const relative of staged.keys()) {
    const targetPath = path.join(realWorktree, relative);
    assertSafeLibraryPath(realWorktree, targetPath);
    if (!entries.has(relative)) {
      try {
        await fs.lstat(targetPath);
        throw new Error(`Cannot overlay agent onto non-regular target: ${relative}`);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      entries.set(relative, { targetPath });
    }
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    // Refuse changed ancestors before a restore can write outside this worktree.
    for (const entry of entries.values()) assertSafeLibraryPath(realWorktree, entry.targetPath);
    for (const entry of [...entries.values()].reverse()) {
      if (entry.content !== undefined) {
        mkdirSync(path.dirname(entry.targetPath), { recursive: true });
        writeFileSync(entry.targetPath, entry.content);
        chmodSync(entry.targetPath, entry.mode! & 0o777);
      } else {
        rmSync(entry.targetPath, { force: true });
        removeEmptyParents(entry.targetPath, realWorktree);
      }
    }
    cleaned = true;
  };
  try {
    for (const entry of entries.values()) if (entry.content !== undefined) await fs.unlink(entry.targetPath);
    for (const [relative, content] of staged) {
      const targetPath = path.join(realWorktree, relative);
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, { mode: 0o600, flag: 'wx' });
    }
  } catch (error) { cleanup(); throw error; }
  return { copiedFiles: [...staged.keys()], cleanup };
}
