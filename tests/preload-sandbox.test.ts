import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const preloadSource = await readFile(new URL('../src/main/preload.ts', import.meta.url), 'utf8');

test('sandboxed preload has no runtime-local imports', () => {
  const runtimeImports = [...preloadSource.matchAll(/^import\s+(?!type\b)[^;]+from\s+['"]([^'"]+)['"];?/gm)]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith('.'));

  assert.deepEqual(runtimeImports, []);
});
