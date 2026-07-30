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

function runCommand(executable: string, args: string[], cwd: string, timeoutMs = GIT_TIMEOUT_MS): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, PATH: runtimeSearchPath(), NO_COLOR: '1' },
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
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
  for (const field of ['taskId', 'storyId', 'sourceKey', 'issueKey']) {
    const value = inputs[field];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return 'task';
}

export interface PreparedWorktree {
  repositoryRoot: string;
  worktreePath: string;
  workingDirectory: string;
  branchName: string;
  baseRevision: string;
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

  const revision = (await runCommand(git, ['rev-parse', 'HEAD'], repositoryRoot)).stdout.trim();
  if (!/^[0-9a-f]{40,64}$/i.test(revision)) throw new Error('Git HEAD did not resolve to a commit');

  const worktreeRoot = path.join(app.getPath('userData'), 'worktrees');
  await fs.mkdir(worktreeRoot, { recursive: true });
  const worktreePath = path.join(worktreeRoot, runId);
  const branchName = `agent-pipeline/${safeBranchSegment(taskIdentifier(inputs))}-${runId.slice(0, 8)}`;
  await runCommand(git, ['check-ref-format', '--branch', branchName], repositoryRoot);

  try {
    await runCommand(git, ['worktree', 'add', '-b', branchName, worktreePath, revision], repositoryRoot);
    const resolvedWorktree = await fs.realpath(worktreePath);
    const workingDirectory = relativeProject && relativeProject !== '.'
      ? path.join(resolvedWorktree, relativeProject)
      : resolvedWorktree;
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
    await fs.rm(worktreePath, { recursive: true, force: true });
    throw error;
  }
}
