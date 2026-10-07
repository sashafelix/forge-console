import assert from 'node:assert/strict';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ProviderRegistry, readBoundedJson, type CredentialVault } from '../src/main/provider-registry';
import type { ProviderFetch } from '../src/main/provider-protocols';
import { exportConfiguration, newModel, newProfile, newProvider, validateConfiguration } from '../src/shared/providers';

function vault(available = true): CredentialVault {
  const key = randomBytes(32);
  return { available: () => available, encrypt(value) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), body]); },
    decrypt(value) { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8'); } };
}

test('host credentials require the exact provider binding and remain absent from public views', async (context) => {
  const { registry, provider, profile, view } = await setup(context);
  const authenticated = { ...provider, auth:{ mode:'bearer' as const, header:'Authorization',credentialRef:'env:HOST_MODEL_KEY' } };
  const saved = await registry.saveProvider({ expectedRevision:view.revision,provider:authenticated,secret:'host-fixture-private-key' });
  const configuration = exportConfiguration(profile,[authenticated]);
  assert.deepEqual(await registry.environmentForBindings(configuration),{ HOST_MODEL_KEY:'host-fixture-private-key' });
  configuration.providers[0].baseUrl = 'https://changed.example.test/v1';
  assert.deepEqual(await registry.environmentForBindings(configuration),{});
  assert.doesNotMatch(JSON.stringify(saved),/host-fixture-private-key/);
});
async function setup(context: { after(fn: () => Promise<void>): void }, fetcher: ProviderFetch = async () => Response.json({ choices: [{ message: { content: 'PROBE_OK' } }] }), available = true) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-registry-')); context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const registry = new ProviderRegistry(directory, vault(available), fetcher);
  const provider = newProvider('test-provider', 'ollama');
  let view = await registry.saveProvider({ expectedRevision: 0, provider });
  const profile = newProfile('test-profile', 'Test profile');
  profile.models = [{ ...newModel('test-model', provider.id), name: 'Test model', model: 'test-model' }];
  profile.routes.forEach((r) => { r.models = ['test-model']; });
  view = await registry.saveProfile({ expectedRevision: view.revision, profile });
  return { directory, registry, provider, profile, view };
}

test('multiple providers persist, credentials are encrypted and never exported or returned', async (context) => {
  const { directory, registry, view } = await setup(context);
  const cloud = newProvider('cloud-provider', 'openai');
  const saved = await registry.saveProvider({ expectedRevision: view.revision, provider: cloud, secret: 'a-secret-value' });
  assert.equal(saved.providers.length, 2); assert.equal(saved.credentials[cloud.id], true);
  assert.doesNotMatch(JSON.stringify(saved), /a-secret-value|secretSlots/);
  assert.doesNotMatch(await fs.readFile(path.join(directory, 'model-providers.json'), 'utf8'), /a-secret-value/);
  assert.equal((await fs.readFile(path.join(directory, 'model-providers.secrets'))).includes(Buffer.from('a-secret-value')), false);
  const exported = await registry.exportProfile('test-profile', saved.revision);
  assert.equal(exported.providers.length, 1); assert.doesNotMatch(JSON.stringify(exported), /a-secret-value/);
});
test('auth-free local profiles work without a keyring; saving a key fails without mutating metadata', async (context) => {
  const { registry, view } = await setup(context, undefined, false);
  await assert.rejects(registry.saveProvider({ expectedRevision: view.revision, provider: newProvider('cloud', 'openai'), secret: 'key' }), /Secure credential/);
  assert.equal((await registry.list()).providers.length, 1);
});
test('stale writes and referenced-provider deletion are rejected', async (context) => {
  const { registry, provider, view } = await setup(context);
  await assert.rejects(registry.saveProvider({ expectedRevision: 0, provider }), /another window/);
  await assert.rejects(registry.remove('provider', provider.id, view.revision), /referenced/);
  await assert.rejects(registry.exportProfile('test-profile', 0), /another window/);
  assert.equal((await registry.list()).revision, view.revision);
});
test('a provider locality change cannot introduce external fallback into a local-only profile', async (context) => {
  const { registry, provider, profile, view } = await setup(context);
  const saved = await registry.saveProfile({ expectedRevision: view.revision, profile: { ...profile, localOnly: true } });
  await assert.rejects(registry.saveProvider({ expectedRevision: saved.revision, provider: { ...provider, baseUrl: 'https://cloud.example/v1', locality: 'external' } }), /Local-only/);
  assert.equal((await registry.list()).providers[0].locality, 'local');
});
test('import creates fresh IDs and no credential bindings or diagnostic attestations', async (context) => {
  const { registry, provider, profile, view } = await setup(context);
  const imported = await registry.importProfile(exportConfiguration(profile, [provider]), view.revision);
  const added = imported.profiles.at(-1)!;
  assert.notEqual(added.id, profile.id); assert.notEqual(added.models[0].providerId, provider.id);
  assert.equal(imported.credentials[added.models[0].providerId], false); assert.equal(imported.diagnostics.length, 0);
  assert.doesNotThrow(() => validateConfiguration(exportConfiguration(added, imported.providers)));
});
test('editing a model or credential invalidates previous probe results', async (context) => {
  const { registry, provider, profile } = await setup(context);
  let view = await registry.probe({ profileId: profile.id, modelId: 'test-model', kinds: ['generation'] }, 'probe-one');
  assert.equal(view.diagnostics[0].results[0].status, 'passed');
  const authenticated = { ...provider, auth: { mode: 'bearer' as const, header: 'Authorization', credentialRef: 'env:TEST_KEY' } };
  view = await registry.saveProvider({ expectedRevision: view.revision, provider: authenticated, secret: 'new-key' });
  assert.equal(view.diagnostics.length, 0);
  view = await registry.probe({ profileId: profile.id, modelId: 'test-model', kinds: ['generation'] }, 'probe-two');
  assert.equal(view.diagnostics.length, 1);
  view = await registry.saveProfile({ expectedRevision: view.revision, profile: { ...profile, name: 'Edited' } });
  assert.equal(view.diagnostics.length, 0);
});
test('in-flight diagnostics cannot overwrite a changed configuration', async (context) => {
  let release: (response: Response) => void = () => undefined;
  let started: () => void = () => undefined; const entered = new Promise<void>((resolve) => { started = resolve; });
  const { registry, provider, profile, view } = await setup(context, () => new Promise<Response>((resolve) => { release = resolve; started(); }));
  const pending = registry.probe({ profileId: profile.id, modelId: 'test-model', kinds: ['generation'] }, 'in-flight');
  await entered;
  await registry.saveProvider({ expectedRevision: view.revision, provider: { ...provider, name: 'Changed during test' } });
  release(Response.json({ choices: [{ message: { content: 'PROBE_OK' } }] }));
  await assert.rejects(pending, /another window/); assert.equal((await registry.list()).diagnostics.length, 0);
});
test('import reader refuses excessive files and malformed JSON', async (context) => {
  const { directory } = await setup(context);
  const file = path.join(directory, 'import.json');
  await fs.writeFile(file, ' '.repeat(2 * 1024 * 1024 + 1)); await assert.rejects(readBoundedJson(file), /limit/);
  await fs.writeFile(file, 'invalid'); await assert.rejects(readBoundedJson(file), SyntaxError);
});
