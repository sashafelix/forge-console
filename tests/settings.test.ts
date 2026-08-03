import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultSettings, validateSettings } from '../src/shared/settings';

const inheritedNetwork = {
  proxyMode: 'inherit' as const,
  httpProxy: '',
  httpsProxy: '',
  noProxy: '',
  caCertificatePath: ''
};

test('default settings contain no runtime overrides and inherit launcher networking', () => {
  assert.deepEqual(defaultSettings(), {
    schemaVersion: '1.1',
    runtimeExecutableOverrides: {},
    network: inheritedNetwork
  });
});

test('valid process runtime executable overrides are accepted and legacy settings migrate', () => {
  assert.deepEqual(validateSettings({
    schemaVersion: '1.0',
    runtimeExecutableOverrides: {
      'claude-code': '/opt/homebrew/bin/claude',
      'github-copilot': '/usr/local/bin/copilot'
    }
  }), {
    schemaVersion: '1.1',
    runtimeExecutableOverrides: {
      'claude-code': '/opt/homebrew/bin/claude',
      'github-copilot': '/usr/local/bin/copilot'
    },
    network: inheritedNetwork
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
