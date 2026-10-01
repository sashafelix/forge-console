import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildProjectProfile, emptyProjectProfileDraft, validateProjectProfileDraft } from '../src/shared/project-profile';
import { writeProjectProfile } from '../src/main/project-profile';

const draft = { ...emptyProjectProfileDraft(), projectId: 'example', issuedBy: 'Example operator',
  stack: 'Python\r\nPython\nTypeScript', test: 'python -m unittest', constraints: 'Keep compatibility' };

test('exports the existing pipeline project-facts contract without execution authority', () => {
  const profile = buildProjectProfile(draft, '2026-10-01T09:00:00Z');
  assert.deepEqual(profile, {
    schema_version: '1.0', project_id: 'example', profile_version: '1',
    provenance: { source: 'operator', issued_by: 'Example operator', issued_at: '2026-10-01T09:00:00Z', source_ref: null },
    project: { root: '.', stack: ['Python', 'TypeScript'], frameworks: [],
      commands: { build: [], test: ['python -m unittest'], lint: [] },
      architecture: { style: null, source_of_truth: null }, modules: [], environment: null },
    decisions: {}, constraints: ['Keep compatibility']
  });
});

test('rejects malformed, excessive and authority-bearing renderer input', () => {
  for (const value of [null, [], {}, { ...draft, model: 'override' }, { ...draft, approvals: [] },
    { ...draft, stack: [] }, { ...draft, stack: ' '.repeat(8001) }, { ...draft, root: 'a\0b' },
    { ...draft, issuedBy: ' ' }, { ...draft, root: 'one\ntwo' }]) {
    assert.ok(validateProjectProfileDraft(value).length);
    assert.throws(() => buildProjectProfile(value));
  }
});

test('saves only a new file, keeps commands inert and preserves existing bytes', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-config-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'profile.json');
  const sentinel = path.join(directory, 'not-executed');
  await writeProjectProfile(destination, { ...draft, test: `touch ${sentinel}` });
  const before = await fs.readFile(destination, 'utf8');
  assert.equal(JSON.parse(before).project.commands.test[0], `touch ${sentinel}`);
  await assert.rejects(fs.stat(sentinel), { code: 'ENOENT' });
  await assert.rejects(writeProjectProfile(destination, draft), { code: 'EEXIST' });
  assert.equal(await fs.readFile(destination, 'utf8'), before);
});

test('invalid input cannot create a file', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-invalid-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, 'profile.json');
  await assert.rejects(writeProjectProfile(destination, { ...draft, runtime: 'execute' }));
  await assert.rejects(fs.stat(destination), { code: 'ENOENT' });
});
