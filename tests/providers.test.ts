import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { exportConfiguration, newProvider, validateConfiguration, validateProfile, validateProvider } from '../src/shared/providers';

export const fixture = () => validateConfiguration(JSON.parse(readFileSync(new URL('./fixtures/runtime-configuration.json', import.meta.url), 'utf8')));

test('versioned runtime configuration round trips without credentials or probe attestations', () => {
  const config = fixture();
  assert.deepEqual(exportConfiguration(config.profile, config.providers), config);
  for (const key of ['secret', 'apiKey', 'diagnostics', 'approved', 'execution', 'stage_order']) {
    assert.throws(() => validateConfiguration({ ...config, [key]: 'untrusted' }));
  }
  assert.throws(() => validateConfiguration({ ...config, schema_version: 'future' }));
});

test('local-only applies to every binding including fallbacks', () => {
  const config = fixture(); config.profile.localOnly = true;
  assert.throws(() => validateConfiguration(config), /Local-only/);
  config.profile.models = config.profile.models.slice(0, 1);
  config.profile.routes.forEach((r) => { r.models = [config.profile.models[0].id]; });
  config.providers = config.providers.slice(0, 1);
  assert.doesNotThrow(() => validateConfiguration(config));
});

test('authentication-free localhost and explicit LAN HTTP work, unsafe URLs and headers fail', () => {
  const provider = newProvider('local', 'ollama');
  assert.doesNotThrow(() => validateProvider(provider));
  provider.baseUrl = 'http://192.168.1.20:11434/v1';
  assert.throws(() => validateProvider(provider), /HTTP/);
  provider.allowInsecureHttp = true;
  assert.doesNotThrow(() => validateProvider(provider));
  for (const baseUrl of ['file:///tmp/config', 'ftp://localhost/a', 'https://user:key@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#key']) {
    assert.throws(() => validateProvider({ ...provider, baseUrl }));
  }
  for (const header of ['Host', 'content-Length', 'Cookie', 'bad\r\nheader']) {
    assert.throws(() => validateProvider({ ...provider, auth: { ...provider.auth, header } }));
  }
  assert.throws(() => validateProvider({ ...provider, locality: 'external' }));
});

test('roles, models and provider references are explicit and unique; drafts cannot export incomplete routes', () => {
  const config = fixture();
  for (const change of [
    (c: typeof config) => { c.profile.routes[0].role = c.profile.routes[1].role; },
    (c: typeof config) => { c.profile.routes[0].models = ['unknown']; },
    (c: typeof config) => { c.profile.routes[0].models.push(c.profile.routes[0].models[0]); },
    (c: typeof config) => { c.profile.models[0].providerId = 'missing'; },
    (c: typeof config) => { c.providers[0].auth = { mode: 'bearer', header: 'Authorization', credentialRef: 'sk-secret' }; }
  ]) { const copy = structuredClone(config); change(copy); assert.throws(() => validateConfiguration(copy)); }
  config.profile.routes[0].models = [];
  assert.doesNotThrow(() => validateProfile(config.profile, config.providers, false));
  assert.throws(() => exportConfiguration(config.profile, config.providers));
});
