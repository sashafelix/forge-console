import type { AppSettings, ProcessRuntimeId } from './contracts';

export const PROCESS_RUNTIME_IDS: ProcessRuntimeId[] = ['claude-code', 'github-copilot'];

export function defaultSettings(): AppSettings {
  return {
    schemaVersion: '1.0',
    runtimeExecutableOverrides: {}
  };
}

export function isProcessRuntimeId(value: unknown): value is ProcessRuntimeId {
  return typeof value === 'string' && PROCESS_RUNTIME_IDS.includes(value as ProcessRuntimeId);
}

export function validateSettings(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Settings must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== '1.0') throw new Error('Unsupported settings schema version');

  const overridesValue = record.runtimeExecutableOverrides;
  if (typeof overridesValue !== 'object' || overridesValue === null || Array.isArray(overridesValue)) {
    throw new Error('runtimeExecutableOverrides must be an object');
  }

  const overrides: AppSettings['runtimeExecutableOverrides'] = {};
  for (const [runtimeId, executablePath] of Object.entries(overridesValue as Record<string, unknown>)) {
    if (!isProcessRuntimeId(runtimeId)) throw new Error(`Unsupported runtime override: ${runtimeId}`);
    if (typeof executablePath !== 'string' || executablePath.trim().length === 0) {
      throw new Error(`Runtime override for ${runtimeId} must be a non-empty path`);
    }
    overrides[runtimeId] = executablePath;
  }

  return {
    schemaVersion: '1.0',
    runtimeExecutableOverrides: overrides
  };
}
