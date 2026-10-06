/** Bounded, read-only bundle inspection. Imported receipts never become execution authority. */
import { constants, promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { EvidenceCommand, ForgeEvent, ForgeRunSnapshot } from '../shared/forge';
import { FORGE_STAGES } from '../shared/forge';

const LIMIT = 4 * 1024 * 1024;
const SUFFIXES = new Set(['.json','.jsonl','.md','.txt','.log','.xml','.csv','.patch']);
export function safeReference(name: unknown): name is string {
  return typeof name === 'string' && name.length <= 1000 && name.length > 0 && !/[\\\x00-\x1f]/.test(name)
    && !/[:*?"<>|]/.test(name) && !path.posix.isAbsolute(name) && !name.split('/').some((p) => !p || p === '.' || p === '..' || p === '.git')
    && SUFFIXES.has(path.posix.extname(name).toLowerCase());
}
export async function boundedFile(root: string, name: string): Promise<Buffer> {
  if (!safeReference(name)) throw new Error('Unsafe evidence reference.');
  let current = root;
  for (const part of name.split('/')) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Evidence symlinks are refused.');
  }
  const handle = await fs.open(current, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const details = await handle.stat();
    if (!details.isFile() || details.size > LIMIT) throw new Error('Evidence file exceeds the 4 MiB limit.');
    const data = Buffer.alloc(details.size + 1);
    const { bytesRead } = await handle.read(data, 0, data.length, 0);
    if (bytesRead > details.size) throw new Error('Evidence changed during inspection.');
    return data.subarray(0, bytesRead);
  } finally { await handle.close(); }
}
const object = (v: unknown): v is Record<string, any> => Boolean(v && typeof v === 'object' && !Array.isArray(v));
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, 2000) : [];
const text = (v: unknown, fallback = ''): string => typeof v === 'string' ? v.slice(0, 20000) : fallback;
const count = (v: unknown): number | undefined => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
function validEvent(value: unknown): value is ForgeEvent {
  return object(value) && typeof value.sequence === 'number' && Number.isSafeInteger(value.sequence) && value.sequence > 0
    && typeof value.attempt === 'number' && Number.isSafeInteger(value.attempt) && value.attempt > 0
    && ['stage','event_type','actor_role','timestamp'].every((key) => typeof value[key] === 'string' && value[key].length <= 200)
    && Number.isFinite(Date.parse(value.timestamp)) && (value.safe_summary == null || typeof value.safe_summary === 'string')
    && Array.isArray(value.artifact_refs) && value.artifact_refs.length <= 2000 && value.artifact_refs.every((ref) => typeof ref === 'string' && ref.length <= 1000);
}
async function listing(root: string): Promise<{ path: string; bytes: number }[]> {
  const found: { path: string; bytes: number }[] = [];
  let bytes = 0, entries = 0;
  async function walk(folder: string) {
    for (const name of await fs.readdir(path.join(root, folder))) {
      if (++entries > 5000) throw new Error('Evidence entry limit exceeded.');
      const reference = folder ? folder + '/' + name : name;
      const info = await fs.lstat(path.join(root, reference));
      if (info.isSymbolicLink()) throw new Error('Bundle contains a symlink.');
      if (info.isDirectory()) { if (reference.split('/').length > 10) throw new Error('Evidence nesting limit exceeded.'); await walk(reference); }
      else if (info.isFile() && safeReference(reference)) {
        bytes += info.size;
        if (info.size > LIMIT || bytes > 50 * 1024 * 1024) throw new Error('Evidence size limit exceeded.');
        found.push({ path: reference, bytes: info.size });
      }
    }
  }
  await walk('');
  return found.sort((a,b) => a.path.localeCompare(b.path));
}

export async function readEvents(root: string, after: number, limit: number): Promise<{ events: ForgeEvent[]; nextCursor: number }> {
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Invalid event cursor.');
  const events: ForgeEvent[] = [];
  for (const line of (await boundedFile(root, 'events.jsonl')).toString('utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const value: unknown = JSON.parse(line);
    if (!validEvent(value)) throw new Error('Malformed run event.');
    if (value.sequence > after && events.length < limit) events.push(value as ForgeEvent);
  }
  return { events, nextCursor: events.at(-1)?.sequence ?? after };
}

export async function inspectBundle(root: string, id: string, source: 'imported' | 'managed' = 'imported'): Promise<ForgeRunSnapshot> {
  const artifacts = await listing(root);
  const available = new Set(artifacts.map((a) => a.path));
  const issues: string[] = [];
  async function document(name: string): Promise<Record<string, any>> {
    try {
      const value: unknown = JSON.parse((await boundedFile(root, name)).toString('utf8'));
      if (!object(value)) throw new Error('Expected a JSON object.');
      if (value.schema_version !== '1.0') throw new Error('Supported artifact schema_version is 1.0.');
      return value;
    } catch (reason) { issues.push(name + ': ' + (reason instanceof Error ? reason.message : String(reason))); return {}; }
  }
  const [repository, specification, plan, resolution, gates, convergence] = await Promise.all(
    ['repository-intelligence.json','brainstorm.json','detailed-plan.json','profile-resolution.json','quality-gates.json','convergence-report.json'].map(document));
  const commands: EvidenceCommand[] = [];
  if (available.has('host-receipts.json')) {
    const ledger = await document('host-receipts.json');
    for (const r of Array.isArray(ledger.receipts) ? ledger.receipts.slice(0, 5000) : []) {
      if (!object(r) || r.kind !== 'command') continue;
      if (!Number.isInteger(r.exit_code) || !safeReference(r.output_ref)) { issues.push('Malformed command receipt.'); continue; }
      commands.push({ id: text(r.id), stage: text(r.stage), role: text(r.role), invocationId: text(r.invocation_id),
        command: text(r.command_id) + (r.purpose && r.purpose !== 'stage' ? ' [' + text(r.purpose) + ']' : ''), exitCode: r.exit_code, outputRef: r.output_ref,
        collected: count(r.tests?.collected), passed: count(r.tests?.passed), failed: count(r.tests?.failed), wallTimeMs: count(r.wall_time_ms) });
      try {
        const output = await boundedFile(root, r.output_ref);
        if (createHash('sha256').update(output).digest('hex') !== r.output_sha256) issues.push('Receipt/output hash mismatch: ' + r.output_ref);
      } catch { issues.push('Missing/unsafe command evidence: ' + r.output_ref); }
    }
  }
  for (const stage of ['red_test','green_code','refactor','quality_gate']) {
    const filename = ({ red_test: 'red-result.json', green_code: 'green-result.json', refactor: 'refactor-result.json', quality_gate:'quality-gates.json' } as Record<string,string>)[stage];
    const result = stage === 'quality_gate' ? gates : await document(filename);
    for (const [i, c] of (Array.isArray(result.commands) ? result.commands : []).entries()) {
      if (!object(c) || !Number.isInteger(c.exit_code) || !safeReference(c.output_ref)) { issues.push(filename + ': malformed command.'); continue; }
      if (!commands.some((r) => r.outputRef === c.output_ref)) commands.push({ id: filename + ':' + i, stage, role: text(result.actor_role),
        command: text(c.command), exitCode: c.exit_code, outputRef: c.output_ref });
      if (stage !== 'red_test' && (result.outcome === 'completed' || result.verdict === 'PASS') && c.exit_code !== 0) issues.push(filename + ': passing stage has nonzero exit.');
    }
    if (stage === 'red_test' && !commands.some((c) => c.stage === stage && c.exitCode !== 0)) issues.push('RED has no expected failing command.');
  }
  const criteria = (Array.isArray(specification.success_criteria) ? specification.success_criteria : []).filter(object).slice(0, 1000).map((criterion) => {
    const evidence = (Array.isArray(gates.criterion_evidence) ? gates.criterion_evidence : []).find((e) => object(e) && e.sc_id === criterion.id);
    const mapping = (Array.isArray(plan.criterion_test_map) ? plan.criterion_test_map : []).find((e) => object(e) && e.sc_id === criterion.id);
    return { id: text(criterion.id), statement: text(criterion.statement), status: text(evidence?.status, 'MISSING'),
             tests: strings(mapping?.test_ids), evidence: strings(evidence?.evidence_refs) };
  });
  if (!criteria.length) issues.push('No criterion trace found.');
  const refs = new Set([...commands.map((c) => c.outputRef), ...criteria.flatMap((c) => c.evidence)]);
  for (const ref of refs) {
    try {
      const data = await boundedFile(root, ref);
      if (!data.toString('utf8').trim()) issues.push('Empty evidence: ' + ref);
      if (/\bRan\s+0\s+tests?\b|\bno tests (?:ran|collected)\b|\bcollected\s+0\s+items?\b/i.test(data.toString('utf8'))) issues.push('Empty test suite: ' + ref);
    } catch { issues.push('Missing/unsafe evidence: ' + ref); }
  }
  let events: ForgeEvent[] = [];
  try {
    const raw = (await boundedFile(root, 'events.jsonl')).toString('utf8').split(/\r?\n/).filter((v) => v.trim());
    if (raw.length > 30000) throw new Error('Event count limit exceeded.');
    events = raw.map((line) => JSON.parse(line));
    if (events.some((e,i) => !validEvent(e) || e.sequence !== i + 1)) throw new Error('Event sequence or fields are invalid.');
  } catch (reason) { issues.push('events.jsonl: ' + (reason instanceof Error ? reason.message : String(reason))); events = []; }
  const stages: string[] = [];
  let attempt = 1, rejected = false, terminal = false;
  for (const event of events) {
    if (event.attempt !== attempt) {
      const index = FORGE_STAGES.indexOf(event.stage as any);
      if (terminal || !rejected || event.attempt !== attempt + 1 || event.event_type !== 'attempt.started' || index < 0 || index > stages.length) {
        issues.push('Invalid remediation attempt or prefix.'); continue;
      }
      stages.splice(index); attempt = event.attempt; rejected = false;
    } else if (event.event_type === 'stage.completed') {
      if (terminal || event.stage !== FORGE_STAGES[stages.length]) issues.push('Unexpected completed stage: ' + event.stage);
      else stages.push(event.stage);
    }
    if (['stage.failed','run.failed','convergence.remediation_requested'].includes(event.event_type)) rejected = true;
    if (event.event_type === 'run.completed') {
      if (stages.length !== FORGE_STAGES.length) issues.push('Reported completion skipped a mandatory stage.');
      terminal = true;
    }
  }
  if (terminal && convergence.attempt !== attempt) issues.push('Final attempt differs from convergence report.');
  return { id, source, storyId: text(specification.story_id, text(repository.story_id, 'Unidentified run')),
    profile: text(resolution.selected_profile, 'unknown'), baseRevision: text(repository.revision),
    updatedAt: text(events.at(-1)?.timestamp, new Date().toISOString()), status: terminal ? 'reported completed' : 'incomplete evidence',
    verdict: text(gates.verdict, 'UNKNOWN'), evidenceLevel: issues.length ? 'imported_claims' : 'files_checked',
    issues: [...new Set(issues)], stages, attempt: Number.isInteger(convergence.attempt) ? convergence.attempt : 1,
    criteria, commands, artifacts, eventCount: events.length };
}
