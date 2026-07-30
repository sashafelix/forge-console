import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, validateSettings } from '../src/shared/settings';

test('default settings contain no runtime overrides', () => {
  assert.deepEqual(defaultSettings(), {
    schemaVersion: '1.0',
    runtimeExecutableOverrides: {}
  });
});

test('valid process runtime executable overrides are accepted', () => {
  assert.deepEqual(validateSettings({
    schemaVersion: '1.0',
    runtimeExecutableOverrides: {
      'claude-code': '/opt/homebrew/bin/claude',
      'github-copilot': '/usr/local/bin/copilot'
    }
  }), {
    schemaVersion: '1.0',
    runtimeExecutableOverrides: {
      'claude-code': '/opt/homebrew/bin/claude',
      'github-copilot': '/usr/local/bin/copilot'
    }
  });
});

test('unknown runtime settings are rejected', () => {
  assert.throws(() => validateSettings({
    schemaVersion: '1.0',
    runtimeExecutableOverrides: { 'unknown-runtime': '/tmp/tool' }
  }), /Unsupported runtime override/);
});

test('empty executable paths are rejected', () => {
  assert.throws(() => validateSettings({
    schemaVersion: '1.0',
    runtimeExecutableOverrides: { 'claude-code': '  ' }
  }), /must be a non-empty path/);
});
