/** Native-owned registration and CLI bridge. Bundle imports have no executable handle. */
import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { ForgeAction, ForgeDoctor, ForgePilot, ForgeRunSnapshot, ForgeSetup, HostView, ForgeStage } from '../shared/forge';
import type { ProjectSelection } from '../shared/contracts';
import { validateConfiguration } from '../shared/providers';
import { childEnvironment } from './child-environment';
import { inspectBundle, boundedFile, readEvents } from './bundle-reader';
import { redactEvidence } from '../shared/redaction-preview';
import { assertSafeLibraryPath } from './agent-library-paths';

type HostRegistration = NonNullable<ForgeSetup['host']>;
type InputRegistration = { paths: Record<'configuration'|'policy'|'inventory'|'facts', string>; hashes: Record<string,string>; view: NonNullable<ForgeSetup['inputs']> };
type RecordEntry = { id: string; root: string; source: 'managed'|'imported'; host?: HostRegistration; inputs?: InputRegistration; summary?: ForgeRunSnapshot };
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const ID = /^[a-f0-9-]{36}$/;

async function jsonFile(filename: string): Promise<any> {
  const bytes = await boundedFile(path.dirname(filename), path.basename(filename));
  if (bytes.length > 2 * 1024 * 1024) throw new Error('Select a regular JSON file, at most 2 MiB.');
  return JSON.parse(bytes.toString('utf8'));
}
async function fingerprint(root: string, python: string) {
  const digest = createHash('sha256');
  let count = 0, bytes = 0;
  async function file(relative: string) {
    const target = path.join(root, relative);
    assertSafeLibraryPath(root, target);
    const info = await fs.lstat(target);
    if (!info.isFile()) throw new Error('Trusted host inputs must be regular files.');
    if (++count > 2000 || info.size > 4*1024*1024 || (bytes += info.size) > 32*1024*1024) throw new Error('Host registration size limit exceeded.');
    digest.update(relative + '\0' + info.size + '\0').update(await fs.readFile(target));
  }
  async function walk(folder: string, depth = 0) {
    if (depth > 10) throw new Error('Host registration nesting limit exceeded.');
    assertSafeLibraryPath(root, path.join(root, folder));
    digest.update('directory:' + folder + '\0');
    for (const entry of (await fs.readdir(path.join(root, folder))).sort()) {
      if (entry === '__pycache__') continue;
      const relative = folder + '/' + entry;
      const info = await fs.lstat(path.join(root, relative));
      if (info.isSymbolicLink()) throw new Error('Trusted host files cannot be symlinks.');
      if (info.isDirectory()) await walk(relative, depth + 1);
      else if (info.isFile() && /\.(py|json|md)$/.test(entry)) {
        await file(relative);
      }
    }
  }
  for (const folder of ['scripts','agents','docs/agent']) await walk(folder);
  // Older hosts may lack the canonical skill library; additions/removals also change the pin.
  for (const relative of ['skills', 'docs/conventions', 'packs', 'AGENTS.md', 'CLAUDE.md', 'README.md',
    'CONTRIBUTING.md', 'docs/enforcement.md', 'docs/model-portability.md', 'VERSION',
    'examples/first-change', 'examples/governed-host']) {
    assertSafeLibraryPath(root, path.join(root, relative));
    let info;
    try { info = await fs.lstat(path.join(root, relative)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      digest.update('missing:' + relative + '\0'); continue;
    }
    if (info.isDirectory()) await walk(relative);
    else await file(relative);
  }
  const binary = await fs.stat(python);
  if (!binary.isFile() || binary.size > 32*1024*1024) throw new Error('Select the Python executable.');
  digest.update(python + '\0').update(await fs.readFile(python));
  return digest.digest('hex');
}

export class ForgeBridge {
  private host: HostRegistration | null = null;
  private inputs: InputRegistration | null = null;
  private records: RecordEntry[] = [];
  private loaded = false;
  private active = new Map<string, ChildProcess>();
  private queue: Promise<void> = Promise.resolve();
  constructor(private directory: string, private credentials: (configuration: unknown) => Promise<Record<string,string>> = async () => ({})) {}
  private get registryPath() { return path.join(this.directory, 'forge-console-runs.json'); }
  private async load() {
    if (this.loaded) return;
    try {
      const saved = await jsonFile(this.registryPath);
      if (saved.schemaVersion !== '1.0' || !Array.isArray(saved.records) || saved.records.length > 100) throw new Error('Invalid Forge registry.');
      this.host = saved.host ?? null; this.inputs = saved.inputs ?? null;
      this.records = saved.records.filter((r: any) => r && ID.test(r.id) && typeof r.root === 'string' && ['managed','imported'].includes(r.source));
    } catch (reason) { if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason; }
    this.loaded = true;
  }
  private async save() {
    const operation = this.queue.then(async () => {
      await fs.mkdir(this.directory, { recursive: true });
      const temporary = this.registryPath + '.tmp-' + randomUUID();
      await fs.writeFile(temporary, JSON.stringify({ schemaVersion: '1.0', host: this.host, inputs: this.inputs, records: this.records }),
                         { flag: 'wx', mode: 0o600 });
      await fs.rename(temporary, this.registryPath);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
  async setup(): Promise<ForgeSetup> { await this.load(); return { host: this.host, inputs: this.inputs?.view ?? null }; }
  async configure(root: string, python: string): Promise<ForgeSetup> {
    await this.load();
    root = await fs.realpath(root); python = await fs.realpath(python);
    const script = path.join(root, 'scripts', 'forge-host.py');
    if (!(await fs.lstat(script)).isFile()) throw new Error('Choose the Forge checkout containing scripts/forge-host.py.');
    this.host = { root, python, sha256: await fingerprint(root, python) };
    await this.save(); return this.setup();
  }
  async selectInputs(paths: InputRegistration['paths']): Promise<ForgeSetup> {
    await this.load();
    const documents: Record<string, any> = {}, hashes: Record<string,string> = {};
    for (const [key, filename] of Object.entries(paths)) {
      documents[key] = await jsonFile(filename);
      hashes[key] = hash(await fs.readFile(filename));
    }
    const configuration = validateConfiguration(documents.configuration), policy = documents.policy;
    if (!policy || policy.schema_version !== '1.0' || !Array.isArray(policy.source_paths) || !Array.isArray(policy.test_paths)
      || !policy.commands || typeof policy.commands !== 'object' || typeof policy.image !== 'string') throw new Error('Invalid execution policy. Forge doctor performs the full policy validation.');
    if (!documents.facts?.story_id || !documents.facts?.facts || documents.inventory?.schema_version !== '1.0') throw new Error('Supply task facts and independently reviewed adapter registrations.');
    const view: NonNullable<ForgeSetup['inputs']> = {
      ...paths, providers: configuration.profile.models.map((m) => {
        const p = configuration.providers.find((p) => p.id === m.providerId)!;
        return { name: p.name, model: m.model, locality: p.locality };
      }), credentialNames: [...new Set(configuration.providers.flatMap((p) => p.auth.credentialRef ? [p.auth.credentialRef.slice(4)] : []))],
      permissions: { source_paths: policy.source_paths, test_paths: policy.test_paths, commands: policy.commands, image: policy.image }
    };
    this.inputs = { paths, hashes, view };
    await this.save(); return this.setup();
  }
  async createPilot(configuration: string, output: string, image: string): Promise<ForgePilot> {
    await this.load();
    if (!this.host) throw new Error('Select a trusted Forge checkout and Python before creating a pilot.');
    if (process.platform === 'win32') throw new Error('Create and run governed pilots inside WSL; inspect the evidence in Console.');
    if (typeof image !== 'string' || !/^(?:[A-Za-z0-9._:/-]+@)?sha256:[a-f0-9]{64}$/.test(image)
        || image.endsWith('sha256:' + '0'.repeat(64))) throw new Error('Enter the actual immutable Docker image ID, not a tag or placeholder.');
    validateConfiguration(await jsonFile(configuration));
    // Picker-owned paths only; the renderer never chooses a filesystem destination or executable.
    const result = await this.invoke(this.host, ['pilot', '--configuration', configuration, '--image', image, '--output', output]);
    if (result.kind !== 'forge-pilot' || result.schema_version !== '1.0' || result.ready !== false || result.execution_authority !== false
        || typeof result.root !== 'string' || path.resolve(result.root) !== path.resolve(output)) {
      throw new Error('Forge returned an unsupported pilot response. Update the selected Forge checkout.');
    }
    // Generated inputs remain drafts. Selection, capability review and readiness are separate steps.
    return result;
  }
  private async checkedHost(host: HostRegistration) {
    if (await fingerprint(host.root, host.python) !== host.sha256) throw new Error('Registered Forge code or Python changed. Review and select the host again.');
  }
  private async checkedInputs(inputs: InputRegistration) {
    for (const [key, filename] of Object.entries(inputs.paths)) {
      const bytes = await boundedFile(path.dirname(filename), path.basename(filename));
      if (hash(bytes) !== inputs.hashes[key]) throw new Error('Reviewed operator inputs changed. Select the inputs again.');
    }
  }
  private async invoke(host: HostRegistration, args: string[], id?: string, approved: Record<string,string> = {}): Promise<any> {
    await this.checkedHost(host);
    if (id && args[0] === 'advance' && this.active.has(id)) throw new Error('A stage worker is already active.');
    return new Promise((resolve, reject) => {
      // A fresh cache prefix prevents unchecked checkout bytecode from replacing pinned source.
      const child = spawn(host.python, ['-E','-s','-B','-X','pycache_prefix='+path.join(this.directory,'unused-cache-'+randomUUID()), path.join(host.root,'scripts','forge-host.py'), ...args], {
        cwd: host.root, env: childEnvironment(process.env, approved), shell: false, windowsHide: true, stdio: ['ignore','pipe','pipe']
      });
      if (id && args[0] === 'advance') {
        this.active.set(id, child);
      }
      let output = '', errors = '', exceeded = false;
      const timer = setTimeout(() => { child.kill('SIGINT'); }, args[0] === 'advance' ? 60*60*1000 : 60000);
      child.stdout?.on('data', (chunk: Buffer) => {
        if (Buffer.byteLength(output) + chunk.length > 2*1024*1024) { exceeded = true; child.kill('SIGINT'); }
        else output += chunk.toString('utf8');
      });
      child.stderr?.on('data', (chunk: Buffer) => { if (errors.length < 20000) errors += chunk.toString('utf8'); });
      const cleanup = () => { clearTimeout(timer); if (id && this.active.get(id) === child) this.active.delete(id); };
      child.once('error', (reason) => { cleanup(); reject(reason); });
      child.once('close', (code) => {
        cleanup();
        if (exceeded) { reject(new Error('Forge output limit exceeded.')); return; }
        const safe = redactEvidence(output, Object.values(approved)).text;
        try {
          const value = JSON.parse(safe.trim());
          if (code !== 0 && value.status === 'blocked') reject(new Error(value.error ?? 'Forge host blocked the action.'));
          else if (code !== 0 && !('locally_authenticated' in value)) reject(new Error('Forge process did not complete successfully.'));
          else resolve(value);
        } catch (reason) { reject(reason instanceof SyntaxError ? new Error('Forge returned an invalid response. ' + redactEvidence(errors, Object.values(approved)).text.slice(0,1000)) : reason); }
      });
    });
  }
  async doctor(): Promise<ForgeDoctor> {
    await this.load();
    if (!this.host || !this.inputs) throw new Error('Register a trusted Forge checkout and select reviewed operator inputs.');
    await this.checkedInputs(this.inputs);
    const args = ['doctor', ...Object.entries(this.inputs.paths).flatMap(([k,v]) => ['--'+k,v])];
    return this.invoke(this.host, args);
  }
  private entry(id: string) {
    if (!ID.test(id)) throw new Error('Invalid run ID.');
    const entry = this.records.find((r) => r.id === id);
    if (!entry) throw new Error('Run is not registered in this Console.');
    return entry;
  }
  private hostRoot(entry: RecordEntry) { return path.join(entry.root, 'host'); }
  async prepare(project: ProjectSelection, task: string): Promise<ForgeRunSnapshot> {
    await this.load();
    if (!this.host || !this.inputs || !(await this.doctor()).ready) throw new Error('A ready registered Forge host is required.');
    if (typeof task !== 'string' || !task.trim() || task.length > 20000) throw new Error('Supply a task, at most 20,000 characters.');
    if (this.records.length >= 100) throw new Error('Run history limit reached; archive old run registrations.');
    const id = randomUUID(), root = path.join(this.directory, 'forge-runs', id);
    await fs.mkdir(path.join(root, 'inputs'), { recursive: true, mode: 0o700 });
    const paths = {} as InputRegistration['paths'];
    for (const [key, filename] of Object.entries(this.inputs.paths)) {
      paths[key as keyof typeof paths] = path.join(root, 'inputs', key + '.json');
      await fs.copyFile(filename, paths[key as keyof typeof paths], constants.COPYFILE_EXCL);
      await fs.chmod(paths[key as keyof typeof paths], 0o600);
      if (hash(await boundedFile(path.join(root, 'inputs'), key + '.json')) !== this.inputs.hashes[key]) {
        throw new Error('Operator input changed while preparing the run. Select the inputs again.');
      }
    }
    const taskFile = path.join(root, 'inputs', 'task.md');
    await fs.writeFile(taskFile, task, { flag: 'wx', mode: 0o600 });
    const entry: RecordEntry = { id, root, source: 'managed', host: { ...this.host },
      inputs: { ...this.inputs, paths, view: { ...this.inputs.view, ...paths } } };
    this.records.unshift(entry);
    await this.save();
    await this.invoke(entry.host!, ['prepare','--repo', project.path, '--run-dir', this.hostRoot(entry), '--task-file', taskFile,
      ...Object.entries(paths).flatMap(([k,v]) => ['--'+k,v])]);
    return this.get(id);
  }
  async import(root: string): Promise<ForgeRunSnapshot> {
    await this.load();
    if (this.records.length >= 100) throw new Error('Run history limit reached.');
    root = await fs.realpath(root);
    try { if ((await fs.stat(path.join(root,'bundle'))).isDirectory()) root = path.join(root,'bundle'); } catch { /* bundle directory selection */ }
    const id = randomUUID(), snapshot = await inspectBundle(root, id);
    this.records.unshift({ id, root, source: 'imported', summary: snapshot });
    await this.save(); return snapshot;
  }
  async list(): Promise<ForgeRunSnapshot[]> {
    await this.load();
    return this.records.flatMap((r) => r.summary ? [r.summary] : []);
  }
  async get(id: string): Promise<ForgeRunSnapshot> {
    await this.load();
    const entry = this.entry(id);
    const root = entry.source === 'managed' ? path.join(this.hostRoot(entry),'bundle') : entry.root;
    const snapshot = await inspectBundle(root, id, entry.source);
    if (entry.source === 'managed') {
      const host: HostView = await this.invoke(entry.host!, ['status', this.hostRoot(entry)]);
      if (host.host_version !== '1.0' || !Array.isArray(host.available_actions)) throw new Error('Unsupported host state.');
      snapshot.host = host; snapshot.status = host.status; snapshot.updatedAt = host.updated_at; snapshot.attempt = host.attempt;
      if (host.status === 'completed') {
        const proof = await this.invoke(entry.host!, ['verify', this.hostRoot(entry)]);
        if (proof.locally_authenticated === true && !snapshot.issues.length) snapshot.evidenceLevel = 'host_verified';
        else snapshot.issues.push(...(proof.errors ?? ['Local host receipt verification failed.']));
      }
    }
    entry.summary = snapshot;
    await this.save(); return snapshot;
  }
  async action(request: { id: string; action: ForgeAction; approvalId?: string; binding?: string; stage?: ForgeStage }): Promise<ForgeRunSnapshot> {
    await this.load();
    const entry = this.entry(request.id);
    if (entry.source !== 'managed' || !entry.host || !entry.inputs) throw new Error('Imported evidence has no execution authority.');
    const host: HostView = await this.invoke(entry.host, ['status',this.hostRoot(entry)]);
    if (!host.available_actions.includes(request.action)) throw new Error('This action is not available in the current host state.');
    const args = [request.action, this.hostRoot(entry)];
    let environment: Record<string,string> = {};
    if (request.action === 'approve') {
      if (!request.approvalId || !request.binding) throw new Error('Approval requires the exact visible checkpoint binding.');
      args.push('--approval-id',request.approvalId,'--binding',request.binding);
    } else if (request.action === 'retry') {
      if (!request.stage) throw new Error('Choose the earliest invalid stage.');
      args.push('--stage',request.stage);
    } else if (request.action === 'advance') {
      await this.checkedInputs(entry.inputs);
      const configuration = validateConfiguration(await jsonFile(entry.inputs.paths.configuration));
      environment = await this.credentials(configuration);
      for (const p of configuration.providers) {
        const name = p.auth.credentialRef?.slice(4);
        if (name && !environment[name] && process.env[name]) environment[name] = process.env[name]!;
      }
    }
    let response = await this.invoke(entry.host, args, entry.id, environment);
    // A continued run stops at the next host checkpoint, failure or terminal state.
    if (request.action === 'advance') {
      for (let step = 0; step < 10 && response.status === 'ready'; step += 1) {
        response = await this.invoke(entry.host, ['advance',this.hostRoot(entry)], entry.id, environment);
      }
    }
    return this.get(entry.id);
  }
  async events(id: string, after: number, limit: number) {
    await this.load(); const entry = this.entry(id);
    if (entry.source === 'managed') {
      if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid event cursor.');
      const page = await this.invoke(entry.host!, ['events',this.hostRoot(entry),'--after',String(after),'--limit',String(limit)]);
      return { events: page.events, nextCursor: page.next_cursor };
    }
    return readEvents(entry.root, after, limit);
  }
  async artifact(id: string, reference: string) {
    await this.load(); const entry = this.entry(id);
    const root = entry.source === 'managed' ? path.join(this.hostRoot(entry),'bundle') : entry.root;
    if (!entry.summary?.artifacts.some((a) => a.path === reference)) throw new Error('Artifact was not present in the reviewed bundle inventory.');
    const data = await boundedFile(root, reference);
    const view = redactEvidence(data.toString('utf8'));
    return { path: reference, text: view.text.slice(0,200000), redactions: view.redactions, truncated: view.text.length > 200000 };
  }
  async shutdown(): Promise<void> {
    await Promise.all([...this.active.values()].map((child) => new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGINT');
    })));
  }
}
