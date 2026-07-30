import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildSearchPath, defaultSearchDirectories } from '../src/shared/search-paths';

test('macOS runtime search directories include Apple Silicon Homebrew and user CLI locations', () => {
  const directories = defaultSearchDirectories('/Users/frank', 'darwin');
  assert.ok(directories.includes('/opt/homebrew/bin'));
  assert.ok(directories.includes('/usr/local/bin'));
  assert.ok(directories.includes(path.join('/Users/frank', '.local', 'bin')));
  assert.ok(directories.includes(path.join('/Users/frank', '.volta', 'bin')));
  assert.ok(directories.includes(path.join('/Users/frank', 'Library', 'pnpm')));
});

test('Linux runtime search directories include common local binary locations', () => {
  const directories = defaultSearchDirectories('/home/frank', 'linux');
  assert.ok(directories.includes('/usr/local/bin'));
  assert.ok(directories.includes(path.join('/home/frank', '.local', 'bin')));
  assert.ok(directories.includes(path.join('/home/frank', '.local', 'share', 'pnpm')));
});

test('search path preserves inherited entries and removes duplicates', () => {
  const value = buildSearchPath('/custom/bin:/usr/local/bin', '/Users/frank', 'darwin', ':');
  const entries = value.split(':');
  assert.equal(entries[0], '/custom/bin');
  assert.equal(entries.filter((entry) => entry === '/usr/local/bin').length, 1);
  assert.ok(entries.includes('/opt/homebrew/bin'));
});
