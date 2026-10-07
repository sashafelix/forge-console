import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { ForgeBridge } from '../src/main/forge-bridge';
import { childEnvironment } from '../src/main/child-environment';

test('host selection pins executable code and input bytes before a diagnostic', async (context) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(),'forge-bridge-'));
  context.after(() => fs.rm(directory,{ recursive:true,force:true }));
  const root = path.join(directory,'trusted-host');
  for (const folder of ['scripts','agents','docs/agent']) await fs.mkdir(path.join(root,folder),{ recursive:true });
  const script = path.join(root,'scripts/forge-host.py');
  await fs.writeFile(script,"import json\nprint(json.dumps({'ready':True,'host_version':'1.0','sandbox':{'ready':True},'routes':[],'execution_authority':False}))\n");
  const probe = spawnSync(process.platform === 'win32' ? 'python' : 'python3',['-c','import sys; print(sys.executable)'],
                          { encoding:'utf8',env:childEnvironment() });
  assert.equal(probe.status,0);
  const bridge = new ForgeBridge(path.join(directory,'console-data'));
  await bridge.configure(root,probe.stdout.trim());
  const paths = { configuration:path.join(directory,'configuration.json'),policy:path.join(directory,'policy.json'),
    inventory:path.join(directory,'inventory.json'),facts:path.join(directory,'facts.json') };
  const configuration = JSON.parse(await fs.readFile(new URL('./fixtures/runtime-configuration.json',import.meta.url),'utf8'));
  await fs.writeFile(paths.configuration,JSON.stringify(configuration));
  await fs.writeFile(paths.policy,JSON.stringify({ schema_version:'1.0',source_paths:['src'],test_paths:['tests'],commands:{ tests:['python3','-m','unittest','-v'] },image:'sha256:'+'a'.repeat(64) }));
  await fs.writeFile(paths.inventory,JSON.stringify({ schema_version:'1.0',registrations:[] }));
  await fs.writeFile(paths.facts,JSON.stringify({ story_id:'EXAMPLE',facts:{ risk_tags:[] } }));
  await bridge.selectInputs(paths);
  assert.equal((await bridge.doctor()).ready,true);
  await fs.appendFile(paths.policy,' ');
  await assert.rejects(bridge.doctor(),/inputs changed/);
  await bridge.selectInputs(paths);
  await fs.appendFile(script,'# changed host\n');
  await assert.rejects(bridge.doctor(),/Forge code or Python changed/);
  for (const relative of ['AGENTS.md', 'skills/skill-review/SKILL.md', 'docs/conventions/testing.md',
    'examples/first-change/create_demo.py', 'examples/first-change/facts.json', 'examples/governed-host/execution-policy.json']) {
    await bridge.configure(root,probe.stdout.trim());
    await fs.mkdir(path.dirname(path.join(root,relative)),{ recursive:true });
    await fs.writeFile(path.join(root,relative),'New trusted guidance\n');
    await assert.rejects(bridge.doctor(),/Forge code or Python changed/);
    await bridge.configure(root,probe.stdout.trim());
    await fs.appendFile(path.join(root,relative),'Changed guidance\n');
    await assert.rejects(bridge.doctor(),/Forge code or Python changed/);
  }
});

test('pilot creation uses the pinned host without credentials or activating draft inputs', async (context) => {
  if (process.platform === 'win32') return context.skip('Native governed execution requires macOS/Linux.');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-pilot-bridge-'));
  context.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'trusted-host');
  for (const folder of ['scripts', 'agents', 'docs/agent']) await fs.mkdir(path.join(root, folder), { recursive: true });
  await fs.writeFile(path.join(root, 'scripts/forge-host.py'), [
    'import json, pathlib, sys',
    'assert sys.argv[1] == "pilot"',
    'output = sys.argv[sys.argv.index("--output") + 1]',
    'pathlib.Path("called.json").write_text(json.dumps(sys.argv[1:]))',
    'print(json.dumps({"kind":"forge-pilot", "schema_version":"1.0", "ready":False, "execution_authority":False, "root":output}))'
  ].join('\n'));
  const probe = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8', env: childEnvironment() });
  assert.equal(probe.status, 0);
  let credentialReads = 0;
  const bridge = new ForgeBridge(path.join(directory, 'data'), async () => { credentialReads++; return {}; });
  const configuration = path.join(directory, 'configuration.json');
  await fs.copyFile(new URL('./fixtures/runtime-configuration.json', import.meta.url), configuration);
  const output = path.join(directory, 'new pilot');
  await assert.rejects(bridge.createPilot(configuration, output, 'sha256:' + 'a'.repeat(64)), /Select a trusted Forge/);
  await bridge.configure(root, probe.stdout.trim());
  for (const image of ['python:latest', 'sha256:' + '0'.repeat(64), 'sha256:' + 'a'.repeat(64) + '; echo unexpected']) {
    await assert.rejects(bridge.createPilot(configuration, output, image), /immutable Docker image ID/);
  }
  await assert.rejects(fs.stat(path.join(root, 'called.json')), { code: 'ENOENT' });
  const result = await bridge.createPilot(configuration, output, 'sha256:' + 'a'.repeat(64));
  assert.equal(result.ready, false);
  assert.equal((await bridge.setup()).inputs, null);
  assert.equal(credentialReads, 0);
  const args = JSON.parse(await fs.readFile(path.join(root, 'called.json'), 'utf8'));
  assert.deepEqual(args, ['pilot', '--configuration', configuration, '--image', 'sha256:' + 'a'.repeat(64), '--output', output]);
});
