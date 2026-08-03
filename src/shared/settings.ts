import type { AppSettings, NetworkProxyMode, NetworkSettings, ProcessRuntimeId } from './contracts';

export const PROCESS_RUNTIME_IDS: ProcessRuntimeId[] = ['claude-code', 'github-copilot'];
export const NETWORK_PROXY_MODES: NetworkProxyMode[] = ['inherit', 'system', 'manual', 'direct'];

export function defaultNetworkSettings(): NetworkSettings {
  return {
    proxyMode: 'inherit',
    httpProxy: '',
    httpsProxy: '',
    noProxy: '',
    caCertificatePath: ''
  };
}

export function defaultSettings(): AppSettings {
  return {
    schemaVersion: '1.1',
    runtimeExecutableOverrides: {},
    network: defaultNetworkSettings()
  };
}

export function isProcessRuntimeId(value: unknown): value is ProcessRuntimeId {
  return typeof value === 'string' && PROCESS_RUNTIME_IDS.includes(value as ProcessRuntimeId);
}

function isNetworkProxyMode(value: unknown): value is NetworkProxyMode {
  return typeof value === 'string' && NETWORK_PROXY_MODES.includes(value as NetworkProxyMode);
}

function normalizedString(value: unknown, label: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value.trim();
}

function validateProxyUrl(value: unknown, label: string): string {
  const trimmed = normalizedString(value, label);
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a valid URL, for example http://proxy.example:8080`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`${label} must use http:// or https://`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain a username or password`);
  if (!parsed.hostname) throw new Error(`${label} must include a hostname`);
  if (parsed.pathname && parsed.pathname !== '/') throw new Error(`${label} must not include a path`);
  parsed.pathname = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function validateNetworkSettings(value: unknown): NetworkSettings {
  if (value === undefined) return defaultNetworkSettings();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('network settings must be an object');
  const record = value as Record<string, unknown>;
  const proxyMode = record.proxyMode ?? 'inherit';
  if (!isNetworkProxyMode(proxyMode)) throw new Error('Unsupported network proxy mode');
  const httpProxy = validateProxyUrl(record.httpProxy, 'HTTP proxy');
  const httpsProxy = validateProxyUrl(record.httpsProxy, 'HTTPS proxy');
  if (proxyMode === 'manual' && !httpProxy && !httpsProxy) throw new Error('Manual proxy mode requires an HTTP or HTTPS proxy URL');
  return {
    proxyMode,
    httpProxy,
    httpsProxy,
    noProxy: normalizedString(record.noProxy, 'NO_PROXY'),
    caCertificatePath: normalizedString(record.caCertificatePath, 'CA certificate path')
  };
}

export function validateSettings(value: unknown): AppSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Settings must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== '1.0' && record.schemaVersion !== '1.1') throw new Error('Unsupported settings schema version');

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
    schemaVersion: '1.1',
    runtimeExecutableOverrides: overrides,
    network: validateNetworkSettings(record.network)
  };
}
