import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validatePipelineManifest } from '../src/shared/validation';

for (const pack of ['agent-dev-pipeline', 'jira-story-agent', 'safe-repository-change']) {
  test(`${pack} example manifest is valid`, () => {
    const manifestPath = path.resolve('packs', 'examples', pack, 'pipeline.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    const result = validatePipelineManifest(manifest);
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.ok(result.value);
  });
}

function executionFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: '1.1',
    id: 'execution-fixture',
    name: 'Execution Fixture',
    description: 'Executable pipeline validation fixture.',
    version: '1.0.0',
    inputSchema: { type: 'object', properties: {} },
    requiredCapabilities: [],
    supportedRuntimes: ['claude-code'],
    stages: [
      { id: 'change', name: 'Change', description: 'Change files.', order: 1, role: 'implementer', requiredCapabilities: [] }
    ],
    execution: {
      mode: 'runtime-prompt',
      isolation: 'git-worktree',
      promptTemplate: 'prompts/execute.md',
      maxTurns: 10,
      validationCommands: [
        {
          id: 'diff-check',
          name: 'Diff check',
          executable: 'git',
          args: ['diff', '--check'],
          cwd: '.',
          timeoutSeconds: 30,
          required: true
        }
      ]
    },
    ...overrides
  };
}

test('duplicate stage identifiers are rejected', () => {
  const result = validatePipelineManifest({
    schemaVersion: '1.0',
    id: 'bad-pack',
    name: 'Bad Pack',
    description: 'Invalid duplicate stage fixture.',
    version: '1.0.0',
    inputSchema: { type: 'object', properties: {} },
    requiredCapabilities: [],
    supportedRuntimes: ['claude-code'],
    stages: [
      { id: 'same', name: 'One', description: 'First', order: 1, role: 'a', requiredCapabilities: [] },
      { id: 'same', name: 'Two', description: 'Second', order: 2, role: 'b', requiredCapabilities: [] }
    ]
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('duplicate stage id')));
});

test('execution contracts require manifest schema 1.1', () => {
  const fixture = executionFixture({ schemaVersion: '1.0' });
  const result = validatePipelineManifest(fixture);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('execution requires schemaVersion 1.1')));
});

test('execution prompt traversal is rejected', () => {
  const fixture = executionFixture();
  (fixture.execution as Record<string, unknown>).promptTemplate = '../outside.md';
  const result = validatePipelineManifest(fixture);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('promptTemplate')));
});

test('validation shells and interpreters are rejected', () => {
  for (const executable of ['bash', 'powershell.exe', 'python3', 'node']) {
    const fixture = executionFixture();
    ((fixture.execution as { validationCommands: Array<Record<string, unknown>> }).validationCommands[0]).executable = executable;
    const result = validatePipelineManifest(fixture);
    assert.equal(result.valid, false, `${executable} should be rejected`);
    assert.ok(result.errors.some((error) => error.includes('disallowed shell or interpreter')));
  }
});

test('absolute validation executables are rejected', () => {
  const fixture = executionFixture();
  ((fixture.execution as { validationCommands: Array<Record<string, unknown>> }).validationCommands[0]).executable = '/usr/bin/git';
  const result = validatePipelineManifest(fixture);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('non-absolute executable')));
});

test('validation arguments cannot contain shell metacharacters', () => {
  const fixture = executionFixture();
  ((fixture.execution as { validationCommands: Array<Record<string, unknown>> }).validationCommands[0]).args = ['diff', '--check', '&&', 'echo'];
  const result = validatePipelineManifest(fixture);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('shell metacharacters')));
});

test('git validation is limited to read-only subcommands', () => {
  const fixture = executionFixture();
  ((fixture.execution as { validationCommands: Array<Record<string, unknown>> }).validationCommands[0]).args = ['commit', '-am', 'unsafe'];
  const result = validatePipelineManifest(fixture);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('git only for status, diff, log or show')));
});
