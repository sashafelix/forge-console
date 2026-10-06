/** Project facts only, compatible with Forge / Local RGR 2.3 / profile schema 1.0. */
export const PROFILE_FIELDS = {
  projectId: 'Project ID', profileVersion: 'Profile version', issuedBy: 'Prepared by',
  root: 'Project root', stack: 'Languages / stack (one per line)', frameworks: 'Frameworks (one per line)',
  build: 'Build commands (one per line)', test: 'Test commands (one per line)', lint: 'Lint commands (one per line)',
  architectureStyle: 'Architecture style', architectureSource: 'Architecture reference',
  environment: 'Environment description', constraints: 'Project constraints (one per line)',
  modules: 'Modules (JSON array)', decisions: 'Project decisions (JSON object)', sourceRef: 'Original source reference'
} as const;

export type ProjectProfileDraft = Record<keyof typeof PROFILE_FIELDS, string>;

export function emptyProjectProfileDraft(): ProjectProfileDraft {
  return Object.fromEntries(Object.keys(PROFILE_FIELDS).map((key) => [key,
    key === 'profileVersion' ? '1' : key === 'root' ? '.' : key === 'modules' ? '[]' : key === 'decisions' ? '{}' : ''
  ])) as ProjectProfileDraft;
}

function lines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

export function validateProjectProfileDraft(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Expected project configuration fields.'];
  const record = value as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of Object.keys(record)) {
    if (!Object.hasOwn(PROFILE_FIELDS, key)) errors.push(`Unsupported configuration field: ${key}`);
  }
  for (const [key, label] of Object.entries(PROFILE_FIELDS)) {
    if (typeof record[key] !== 'string' || (record[key] as string).length > 8000 || /\0/.test(record[key] as string)) {
      errors.push(`${label} must be text, at most 8000 characters, without NUL.`);
    }
  }
  if (errors.length) return errors;
  const draft = record as ProjectProfileDraft;
  for (const key of ['projectId', 'profileVersion', 'issuedBy', 'root', 'stack'] as const) {
    if (!draft[key].trim()) errors.push(`${PROFILE_FIELDS[key]} is required.`);
  }
  for (const key of ['projectId', 'profileVersion', 'issuedBy', 'root', 'architectureStyle', 'architectureSource'] as const) {
    if (/[\r\n]/.test(draft[key])) errors.push(`${PROFILE_FIELDS[key]} must be a single line.`);
  }
  try { structuredFacts(draft); } catch (reason) { errors.push(reason instanceof Error ? reason.message : String(reason)); }
  return errors;
}

const AUTHORITY_KEYS = new Set(['stage_order','workflow_profile','risk_profile','role','roles','capability','capabilities','runtime','model','checkpoint','approval','permission','permissions','merge','deploy']);
function structuredFacts(draft: ProjectProfileDraft) {
  let modules: unknown, decisions: unknown;
  try { modules = JSON.parse(draft.modules); decisions = JSON.parse(draft.decisions); }
  catch { throw new Error('Modules and project decisions must be valid JSON.'); }
  if (!Array.isArray(modules) || modules.length > 100 || modules.some((m) => !m || typeof m !== 'object' || Array.isArray(m)
    || Object.keys(m).sort().join(',') !== 'name,path,purpose' || ['name','path','purpose'].some((k) => typeof m[k] !== 'string' || !m[k].trim()))) {
    throw new Error('Each module requires exactly name, path and purpose as nonempty text.');
  }
  if (!decisions || typeof decisions !== 'object' || Array.isArray(decisions) || Object.keys(decisions).length > 100
    || Object.entries(decisions).some(([key, value]) => typeof value !== 'string' || AUTHORITY_KEYS.has(key.toLowerCase().replaceAll('-', '_')))) {
    throw new Error('Project decisions must be text values and cannot express protocol authority.');
  }
  return { modules, decisions: decisions as Record<string, string> };
}

export function buildProjectProfile(value: unknown, issuedAt = new Date().toISOString()) {
  const errors = validateProjectProfileDraft(value);
  if (errors.length) throw new Error(errors.join('\n'));
  const draft = value as ProjectProfileDraft;
  const { modules, decisions } = structuredFacts(draft);
  return {
    schema_version: '1.0', project_id: draft.projectId.trim(), profile_version: draft.profileVersion.trim(),
    provenance: { source: 'operator', issued_by: draft.issuedBy.trim(), issued_at: issuedAt, source_ref: draft.sourceRef.trim() || null },
    project: {
      root: draft.root.trim(), stack: lines(draft.stack), frameworks: lines(draft.frameworks),
      commands: { build: lines(draft.build), test: lines(draft.test), lint: lines(draft.lint) },
      architecture: { style: draft.architectureStyle.trim() || null, source_of_truth: draft.architectureSource.trim() || null },
      modules, environment: draft.environment.trim() || null
    },
    decisions, constraints: lines(draft.constraints)
  };
}

/** Import all supported facts; reject unknown fields instead of silently losing them. */
export function importProjectProfile(value: unknown): ProjectProfileDraft {
  function object(raw: unknown, keys: string[], label: string): Record<string, any> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).sort().join(',') !== keys.sort().join(',')) throw new Error(`Unsupported ${label} fields.`);
    return raw as Record<string, any>;
  }
  function text(raw: unknown, label: string, nullable = false): string {
    if (nullable && raw === null) return '';
    if (typeof raw !== 'string' || !raw.trim() || /\0/.test(raw)) throw new Error(`Invalid ${label}.`);
    return raw;
  }
  function list(raw: unknown, label: string): string {
    if (!Array.isArray(raw) || raw.length > 100 || raw.some((v) => typeof v !== 'string' || !v.trim() || /[\r\n\0]/.test(v)) || new Set(raw).size !== raw.length) throw new Error(`Invalid ${label}.`);
    return raw.join('\n');
  }
  const profile = object(value, ['schema_version','project_id','profile_version','provenance','project','decisions','constraints'], 'profile');
  if (profile.schema_version !== '1.0') throw new Error('Supported project profile format: 1.0.');
  const provenance = object(profile.provenance, ['source','issued_by','issued_at','source_ref'], 'provenance');
  if (!['operator','trusted_platform'].includes(provenance.source) || !Number.isFinite(Date.parse(provenance.issued_at))) throw new Error('Unsupported provenance.');
  const project = object(profile.project, ['root','stack','frameworks','commands','architecture','modules','environment'], 'project');
  const commands = object(project.commands, ['build','test','lint'], 'commands');
  const architecture = object(project.architecture, ['style','source_of_truth'], 'architecture');
  const draft: ProjectProfileDraft = {
    projectId: text(profile.project_id, 'project ID'), profileVersion: text(profile.profile_version, 'profile version'),
    issuedBy: text(provenance.issued_by, 'prepared by'), sourceRef: text(provenance.source_ref, 'source reference', true),
    root: text(project.root, 'root'), stack: list(project.stack, 'stack'), frameworks: list(project.frameworks, 'frameworks'),
    build: list(commands.build, 'build'), test: list(commands.test, 'test'), lint: list(commands.lint, 'lint'),
    architectureStyle: text(architecture.style, 'architecture style', true), architectureSource: text(architecture.source_of_truth, 'architecture reference', true),
    environment: text(project.environment, 'environment', true), constraints: list(profile.constraints, 'constraints'),
    modules: JSON.stringify(project.modules, null, 2), decisions: JSON.stringify(profile.decisions, null, 2)
  };
  const errors = validateProjectProfileDraft(draft);
  if (errors.length) throw new Error(errors.join('\n'));
  return draft;
}
