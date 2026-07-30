import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { validatePipelineManifest } from '../src/shared/validation';

for (const pack of ['agent-dev-pipeline', 'jira-story-agent']) {
  test(`${pack} example manifest is valid`, () => {
    const manifestPath = path.resolve('packs', 'examples', pack, 'pipeline.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
    const result = validatePipelineManifest(manifest);
    assert.equal(result.valid, true, result.errors.join('\n'));
    assert.ok(result.value);
  });
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
