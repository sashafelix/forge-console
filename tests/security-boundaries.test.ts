import assert from 'node:assert/strict';
import test from 'node:test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerTrustedSender, assertTrustedSender } from '../src/main/trusted-senders';
import { childEnvironment } from '../src/main/child-environment';
import { approvedOpenDirectory } from '../src/main/path-scope';
import { redactEvidence } from '../src/shared/redaction-preview';

test('IPC requires the registered window, exact page and main frame', () => {
  const frame = { url: 'file:///app/index.html#cockpit', routingId: 1, processId: 20 };
  const event = { sender: { id: 10, mainFrame: frame }, senderFrame: frame };
  assert.throws(() => assertTrustedSender(event), /registered/);
  const unregister = registerTrustedSender(10, ['file:///app/index.html']);
  assert.doesNotThrow(() => assertTrustedSender(event));
  for (const change of [{ url: 'file:///tmp/index.html' }, { routingId: 2 }, { processId: 21 },
                        { url: 'https://attacker.example.test' }, { url: 'file:///app/index.html?other' }]) {
    assert.throws(() => assertTrustedSender({ ...event, senderFrame: { ...frame, ...change } }));
  }
  unregister(); assert.throws(() => assertTrustedSender(event));
});

test('child environments exclude unrelated credentials and code injection', () => {
  const inherited = { PATH: '/bin', HOME: '/home/example', AWS_SECRET_ACCESS_KEY: 'unrelated-secret',
    NODE_OPTIONS: '--require=bad', PYTHONPATH: '/injected', OPENAI_API_KEY: 'unapproved-key',
    ANTHROPIC_API_KEY: 'native-runtime-key', COPILOT_GITHUB_TOKEN: 'copilot-key' };
  const plain = childEnvironment(inherited);
  assert.deepEqual(plain, { PATH: '/bin', HOME: '/home/example' });
  assert.equal(childEnvironment(inherited, {}, 'claude-code').ANTHROPIC_API_KEY, 'native-runtime-key');
  assert.equal(childEnvironment(inherited, { OPENAI_API_KEY: 'approved-key' }).OPENAI_API_KEY, 'approved-key');
  assert.throws(() => childEnvironment(inherited, { NODE_OPTIONS: '--require=bad' }), /inject/);
});

test('open-folder refuses files, arbitrary directories and symlink escapes', async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'folder-scope-'));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root,'selected')); await fs.mkdir(path.join(root,'outside'));
  await fs.writeFile(path.join(root,'selected','run.exe'),'fixture');
  assert.equal(await approvedOpenDirectory(path.join(root,'selected'), [path.join(root,'selected')]), path.join(root,'selected'));
  await assert.rejects(approvedOpenDirectory(path.join(root,'selected','run.exe'), [root]), /directories only/);
  await assert.rejects(approvedOpenDirectory(path.join(root,'outside'), [path.join(root,'selected')]), /native picker/);
  if (process.platform !== 'win32') {
    await fs.symlink(path.join(root,'outside'),path.join(root,'selected','escape'));
    await assert.rejects(approvedOpenDirectory(path.join(root,'selected','escape'), [path.join(root,'selected')]), /native picker/);
  }
});

test('redaction preview hides recognised and exact known values without changing the original', () => {
  const original = 'Authorization: Bearer abcdefghijklmnop\npassword=secret12345\nplain-value-private\n';
  const result = redactEvidence(original, ['plain-value-private']);
  assert.equal(result.redactions, 3);
  assert.doesNotMatch(result.text, /abcdefghijklmnop|secret12345|plain-value-private/);
  assert.match(original, /secret12345/);
});
