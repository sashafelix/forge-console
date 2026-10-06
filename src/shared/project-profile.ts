/** Project facts only, compatible with Forge / Local RGR 2.3 / profile schema 1.0. */
export const PROFILE_FIELDS = {
  projectId: 'Project ID', profileVersion: 'Profile version', issuedBy: 'Prepared by',
  root: 'Project root', stack: 'Languages / stack (one per line)', frameworks: 'Frameworks (one per line)',
  build: 'Build commands (one per line)', test: 'Test commands (one per line)', lint: 'Lint commands (one per line)',
  architectureStyle: 'Architecture style', architectureSource: 'Architecture reference',
  environment: 'Environment description', constraints: 'Project constraints (one per line)'
} as const;

export type ProjectProfileDraft = Record<keyof typeof PROFILE_FIELDS, string>;

export function emptyProjectProfileDraft(): ProjectProfileDraft {
  return Object.fromEntries(Object.keys(PROFILE_FIELDS).map((key) => [key,
    key === 'profileVersion' ? '1' : key === 'root' ? '.' : ''
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
  return errors;
}

export function buildProjectProfile(value: unknown, issuedAt = new Date().toISOString()) {
  const errors = validateProjectProfileDraft(value);
  if (errors.length) throw new Error(errors.join('\n'));
  const draft = value as ProjectProfileDraft;
  return {
    schema_version: '1.0', project_id: draft.projectId.trim(), profile_version: draft.profileVersion.trim(),
    provenance: { source: 'operator', issued_by: draft.issuedBy.trim(), issued_at: issuedAt, source_ref: null },
    project: {
      root: draft.root.trim(), stack: lines(draft.stack), frameworks: lines(draft.frameworks),
      commands: { build: lines(draft.build), test: lines(draft.test), lint: lines(draft.lint) },
      architecture: { style: draft.architectureStyle.trim() || null, source_of_truth: draft.architectureSource.trim() || null },
      modules: [], environment: draft.environment.trim() || null
    },
    decisions: {}, constraints: lines(draft.constraints)
  };
}
