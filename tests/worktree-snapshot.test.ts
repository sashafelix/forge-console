import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('isolated worktrees are based on an ephemeral snapshot of the current checkout', async () => {
  const worktrees = await source('src/main/worktrees.ts');

  assert.match(worktrees, /GIT_INDEX_FILE/);
  assert.match(worktrees, /\['read-tree', headRevision\]/);
  assert.match(worktrees, /\['add', '-A', '--', '\.'\]/);
  assert.match(worktrees, /\['write-tree'\]/);
  assert.match(worktrees, /\['commit-tree', tree, '-p', headRevision/);
  assert.match(worktrees, /const revision = await createRepositorySnapshot/);
  assert.match(worktrees, /\['worktree', 'add', '-b', branchName, worktreePath, revision\]/);
});

test('snapshot creation does not change the selected repository index or branch', async () => {
  const worktrees = await source('src/main/worktrees.ts');

  assert.match(worktrees, /temporary index|real index/i);
  assert.doesNotMatch(worktrees, /git', 'commit/);
  assert.doesNotMatch(worktrees, /stash', 'push/);
  assert.doesNotMatch(worktrees, /checkout', '-b/);
  assert.match(worktrees, /await fs\.rm\(indexPath, \{ force: true \}\)/);
});
