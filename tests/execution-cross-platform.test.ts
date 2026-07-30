import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePipelineManifest } from '../src/shared/validation';

function fixture() {
  return {
    schemaVersion: '1.1',
    id: 'windows-path-fixture',
    name: 'Windows Path Fixture',
    description: 'Cross-platform absolute path validation fixture.',
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
          id: 'check',
          name: 'Check',
          executable: 'git',
          args: ['diff', '--check'],
          timeoutSeconds: 30,
          required: true
        }
      ]
    }
  };
}

test('Windows drive-letter executable is rejected on non-Windows CI', () => {
  const manifest = fixture();
  manifest.execution.validationCommands[0].executable = 'C:\\Tools\\git.exe';
  const result = validatePipelineManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('non-absolute executable')));
});

test('Windows UNC executable is rejected on non-Windows CI', () => {
  const manifest = fixture();
  manifest.execution.validationCommands[0].windowsExecutable = '\\\\server\\share\\tool.cmd';
  const result = validatePipelineManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('non-absolute executable')));
});

test('Windows absolute prompt template is rejected on non-Windows CI', () => {
  const manifest = fixture();
  manifest.execution.promptTemplate = 'C:\\packs\\prompt.md';
  const result = validatePipelineManifest(manifest);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes('promptTemplate')));
});
