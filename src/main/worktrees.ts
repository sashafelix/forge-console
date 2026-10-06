import { app } from 'electron';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { ProjectSelection } from '../shared/contracts';
import { findExecutable, runtimeSearchPath } from './runtime';

const GIT_TIMEOUT_MS = 60_000;

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CommandOptions {
  environment?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

function runCommand(executable: string, args: string[], cwd: string, options: CommandOptions = {}): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: {
        ...process.env,
        PATH: runtimeSearchPath(),
        NO_COLOR: '1',
        ...(options.environment ?? {})
      },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => child.kill(), options.timeoutMs ?? GIT_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      const exitCode = code ?? -1;
      if (exitCode !== 0) {
        reject(new Error(`Command failed: ${executable} ${args.join(' ')}\n${stderr.trim()}`));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}

function safeBranchSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return normalized || 'task';
}

function taskIdentifier(inputs: Record<string, unknown>): string {
  for (const field of ['taskId', 'storyId', 'sourceKey', 'issueKey', 'ticket']) {
    const value = inputs[field];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'task';
}

function snapshotIdentity(runId: string): NodeJS.ProcessEnv {
  return {
    GIT_AUTHOR_NAME: 'Forge Console',
    GIT_AUTHOR_EMAIL: 'agent-pipeline-ui@localhost',
    GIT_COMMITTER_NAME: 'Forge Console',
    GIT_COMMITTER_EMAIL: 'agent-pipeline-ui@localhost',
    GIT_AUTHOR_DATE: new Date().toISOString(),
    GIT_COMMITTER_DATE: new Date().toISOString(),
    AGENT_PIPELINE_RUN_ID: runId
  };
}

async function createRepositorySnapshot(
  git: string,
  repositoryRoot: string,
  headRevision: string,
  runId: string
): Promise<string> {
  const snapshotRoot = path.join(app.getPath('userData'), 'snapshots');
  await fs.mkdir(snapshotRoot, { recursive: true });
  const indexPath = path.join(snapshotRoot, `${runId}.index`);
  const environment: NodeJS.ProcessEnv = {
    ...snapshotIdentity(runId),
    GIT_INDEX_FILE: indexPath
  };

  try {
    // Build an index from HEAD, then overlay the exact current working-copy state.
    // This includes tracked modifications and non-ignored untracked files, while
    // leaving the user's real index, branch, refs and working tree untouched.
    await runCommand(git, ['read-tree', headRevision], repositoryRoot, { environment });
    await runCommand(git, ['add', '-A', '--', '.'], repositoryRoot, { environment });
    const tree = (await runCommand(git, ['write-tree'], repositoryRoot, { environment })).stdout.trim();
    if (!/^[0-9a-f]{40,64}$/i.test(tree)) throw new Error('Git snapshot tree did not resolve correctly');

    const snapshot = (await runCommand(
      git,
      ['commit-tree', tree, '-p', headRevision, '-m', `Forge Console snapshot ${runId}`],
      repositoryRoot,
      { environment }
    )).stdout.trim();
    if (!/^[0-9a-f]{40,64}$/i.test(snapshot)) throw new Error('Git snapshot commit did not resolve correctly');
    return snapshot;
  } finally {
    await fs.rm(indexPath, { force: true });
    await fs.rm(`${indexPath}.lock`, { force: true });
  }
}

export interface PreparedWorktree {
  repositoryRoot: string;
  worktreePath: string;
  workingDirectory: string;
  branchName: string;
  baseRevision: string;
}

export async function discardPreparedWorktree(worktree: PreparedWorktree): Promise<void> {
  const git = await findExecutable(['git']);
  if (!git) {
    await fs.rm(worktree.worktreePath, { recursive: true, force: true });
    return;
  }
  try {
    await runCommand(git, ['worktree', 'remove', '--force', worktree.worktreePath], worktree.repositoryRoot);
  } catch {
    await fs.rm(worktree.worktreePath, { recursive: true, force: true });
  }
  try {
    await runCommand(git, ['branch', '-D', worktree.branchName], worktree.repositoryRoot);
  } catch {
    // The branch may not have been created or may already have been removed.
  }
}

export async function createIsolatedWorktree(
  project: ProjectSelection,
  runId: string,
  inputs: Record<string, unknown>
): Promise<PreparedWorktree> {
  if (!project.isGitRepository) throw new Error('Isolated execution requires a Git repository');
  const git = await findExecutable(['git']);
  if (!git) throw new Error('Git executable was not found');

  const selectedPath = await fs.realpath(path.resolve(project.path));
  const rootResult = await runCommand(git, ['rev-parse', '--show-toplevel'], selectedPath);
  const repositoryRoot = await fs.realpath(rootResult.stdout.trim());
  const relativeProject = path.relative(repositoryRoot, selectedPath);
  if (relativeProject.startsWith('..') || path.isAbsolute(relativeProject)) {
    throw new Error('Selected project path is outside the resolved Git repository root');
  }

  const headRevision = (await runCommand(git, ['rev-parse', 'HEAD'], repositoryRoot)).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(headRevision)) throw new Error('Git HEAD did not resolve to a commit');
  const revision = await createRepositorySnapshot(git, repositoryRoot, headRevision, runId);

  const worktreeRoot = path.join(app.getPath('userData'), 'worktrees');
  await fs.mkdir(worktreeRoot, { recursive: true });
  const worktreePath = path.join(worktreeRoot, runId);
  const branchName = `agent-pipeline/${safeBranchSegment(taskIdentifier(inputs))}-${runId.slice(0, 8)}`;
  await runCommand(git, ['check-ref-format', '--branch', branchName], repositoryRoot);

  try {
    await runCommand(git, ['worktree', 'add', '-b', branchName, worktreePath, revision], repositoryRoot);
    const resolvedWorktree = await fs.realpath(worktreePath);
    const workingCandidate = relativeProject && relativeProject !== '.'
      ? path.join(resolvedWorktree, relativeProject)
      : resolvedWorktree;
    const workingDirectory = await fs.realpath(workingCandidate);
    if (workingDirectory !== resolvedWorktree && !workingDirectory.startsWith(`${resolvedWorktree}${path.sep}`)) {
      throw new Error('The selected project subdirectory escapes the isolated worktree');
    }
    const workingDetails = await fs.stat(workingDirectory);
    if (!workingDetails.isDirectory()) throw new Error('The selected project subdirectory does not exist in the worktree');
    return {
      repositoryRoot,
      worktreePath: resolvedWorktree,
      workingDirectory,
      branchName,
      baseRevision: revision
    };
  } catch (error) {
    const partial: PreparedWorktree = {
      repositoryRoot,
      worktreePath,
      workingDirectory: worktreePath,
      branchName,
      baseRevision: revision
    };
    await discardPreparedWorktree(partial);
    throw error;
  }
}
