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
  for (const relative of ['AGENTS.md', 'skills/skill-review/SKILL.md', 'docs/conventions/testing.md']) {
    await bridge.configure(root,probe.stdout.trim());
    await fs.mkdir(path.dirname(path.join(root,relative)),{ recursive:true });
    await fs.writeFile(path.join(root,relative),'New trusted guidance\n');
    await assert.rejects(bridge.doctor(),/Forge code or Python changed/);
    await bridge.configure(root,probe.stdout.trim());
    await fs.appendFile(path.join(root,relative),'Changed guidance\n');
    await assert.rejects(bridge.doctor(),/Forge code or Python changed/);
  }
});
