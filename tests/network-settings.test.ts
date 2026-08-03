import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { defaultSettings, validateSettings } from '../src/shared/settings';

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('existing 1.0 settings migrate to 1.1 with inherited networking', () => {
  const settings = validateSettings({
    schemaVersion: '1.0',
    runtimeExecutableOverrides: {}
  });

  assert.equal(settings.schemaVersion, '1.1');
  assert.deepEqual(settings.network, {
    proxyMode: 'inherit',
    httpProxy: '',
    httpsProxy: '',
    noProxy: '',
    caCertificatePath: ''
  });
  assert.deepEqual(defaultSettings(), settings);
});

test('manual proxy settings are normalized without credentials', () => {
  const settings = validateSettings({
    schemaVersion: '1.1',
    runtimeExecutableOverrides: {},
    network: {
      proxyMode: 'manual',
      httpProxy: 'http://proxy.example:8080/',
      httpsProxy: 'https://secure-proxy.example:8443/',
      noProxy: 'localhost,.example.net',
      caCertificatePath: '/tmp/corporate.pem'
    }
  });

  assert.equal(settings.network.httpProxy, 'http://proxy.example:8080');
  assert.equal(settings.network.httpsProxy, 'https://secure-proxy.example:8443');
  assert.equal(settings.network.noProxy, 'localhost,.example.net');
});

test('manual proxy mode requires a proxy URL and rejects embedded credentials', () => {
  assert.throws(() => validateSettings({
    schemaVersion: '1.1',
    runtimeExecutableOverrides: {},
    network: { proxyMode: 'manual', httpProxy: '', httpsProxy: '', noProxy: '', caCertificatePath: '' }
  }), /requires an HTTP or HTTPS proxy URL/);

  assert.throws(() => validateSettings({
    schemaVersion: '1.1',
    runtimeExecutableOverrides: {},
    network: { proxyMode: 'manual', httpProxy: 'http://user:password@proxy.example:8080', httpsProxy: '', noProxy: '', caCertificatePath: '' }
  }), /must not contain a username or password/);
});

test('network settings are applied to providers and Electron service tests', async () => {
  const runtime = await source('src/main/runtime.ts');
  const network = await source('src/main/network-settings.ts');
  const connections = await source('src/main/connections.ts');
  const ipc = await source('src/main/ipc.ts');

  assert.match(runtime, /applyConfiguredNetworkEnvironment/);
  assert.match(network, /HTTP_PROXY/);
  assert.match(network, /HTTPS_PROXY/);
  assert.match(network, /NODE_EXTRA_CA_CERTS/);
  assert.match(network, /session\.defaultSession\.setProxy/);
  assert.match(connections, /await applyElectronNetworkSettings\(\)/);
  assert.match(ipc, /clearRuntimePreflightCache\(\)/);
  assert.match(ipc, /testRuntimeConnection\(runtimeId/);
});

test('Connections exposes proxy modes and provider-specific tests', async () => {
  const workbench = await source('src/renderer/ConnectionsWorkbench.tsx');
  const preload = await source('src/main/preload.ts');

  for (const text of [
    'NETWORK &amp; PROXY',
    'Inherit proxy variables from the shell',
    'Use the operating-system proxy',
    'Use manually configured proxy URLs',
    'Test Claude Code',
    'Test GitHub Copilot'
  ]) {
    assert.match(workbench, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(preload, /saveNetworkSettings/);
  assert.match(preload, /selectNetworkCaCertificate/);
  assert.match(preload, /testRuntimeConnection/);
});
