import { app, net, safeStorage } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  ConnectionId,
  ConnectionSummary,
  ConnectionTestResult,
  SaveConnectionRequest
} from '../shared/contracts';

interface ConnectionMetadata {
  serviceUrl: string;
  model?: string;
  authHeader: string;
  authScheme: 'bearer' | 'raw';
  lastTestedAt?: string;
  lastTestStatus: 'untested' | 'ok' | 'failed';
  lastTestMessage?: string;
}

interface ConnectionStore {
  schemaVersion: '1.0';
  connections: Partial<Record<ConnectionId, ConnectionMetadata>>;
}

interface SecretStore {
  schemaVersion: '1.0';
  secrets: Partial<Record<ConnectionId, string>>;
}

const CONNECTION_NAMES: Record<ConnectionId, string> = {
  'jira-atc': 'Jira ATC',
  'confluence-atc': 'Confluence ATC',
  'bmw-llm': 'BMW LLM'
};

const DEFAULT_CONNECTIONS: Record<ConnectionId, ConnectionMetadata> = {
  'jira-atc': {
    serviceUrl: 'https://atc.bmwgroup.net/jira',
    authHeader: 'X-Atlassian-Jira-Personal-Token',
    authScheme: 'raw',
    lastTestStatus: 'untested'
  },
  'confluence-atc': {
    serviceUrl: 'https://atc.bmwgroup.net/confluence',
    authHeader: 'X-Atlassian-Confluence-Personal-Token',
    authScheme: 'raw',
    lastTestStatus: 'untested'
  },
  'bmw-llm': {
    serviceUrl: '',
    model: '',
    authHeader: 'Authorization',
    authScheme: 'bearer',
    lastTestStatus: 'untested'
  }
};

function metadataPath(): string {
  return path.join(app.getPath('userData'), 'connections.json');
}

function secretsPath(): string {
  return path.join(app.getPath('userData'), 'connections.secrets');
}

function isConnectionId(value: unknown): value is ConnectionId {
  return value === 'jira-atc' || value === 'confluence-atc' || value === 'bmw-llm';
}

function validateUrl(value: string, label: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error(`${label} is required`);
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
    throw new Error(`${label} must use HTTPS unless it points to localhost`);
  }
  parsed.username = '';
  parsed.password = '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function validateHeader(value: string): string {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9-]+$/.test(trimmed)) throw new Error('Authentication header contains unsupported characters');
  return trimmed;
}

async function atomicWrite(target: string, content: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

async function loadMetadata(): Promise<ConnectionStore> {
  try {
    const parsed = JSON.parse(await fs.readFile(metadataPath(), 'utf8')) as ConnectionStore;
    if (parsed.schemaVersion !== '1.0' || typeof parsed.connections !== 'object' || parsed.connections === null) {
      throw new Error('Unsupported connection settings format');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: '1.0', connections: {} };
    throw error;
  }
}

async function saveMetadata(store: ConnectionStore): Promise<void> {
  await atomicWrite(metadataPath(), `${JSON.stringify(store, null, 2)}\n`);
}

async function loadSecrets(): Promise<SecretStore> {
  try {
    const encrypted = await fs.readFile(secretsPath());
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this operating system');
    const parsed = JSON.parse(safeStorage.decryptString(encrypted)) as SecretStore;
    if (parsed.schemaVersion !== '1.0' || typeof parsed.secrets !== 'object' || parsed.secrets === null) {
      throw new Error('Unsupported encrypted credential format');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: '1.0', secrets: {} };
    throw error;
  }
}

async function saveSecrets(store: SecretStore): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure credential storage is unavailable on this operating system');
  await atomicWrite(secretsPath(), safeStorage.encryptString(JSON.stringify(store)));
}

function mergedMetadata(store: ConnectionStore, id: ConnectionId): ConnectionMetadata {
  return { ...DEFAULT_CONNECTIONS[id], ...store.connections[id] };
}

export async function listConnections(): Promise<ConnectionSummary[]> {
  const [metadata, secrets] = await Promise.all([loadMetadata(), loadSecrets()]);
  return (Object.keys(CONNECTION_NAMES) as ConnectionId[]).map((id) => {
    const record = mergedMetadata(metadata, id);
    return {
      id,
      name: CONNECTION_NAMES[id],
      configured: Boolean(record.serviceUrl.trim() && secrets.secrets[id]?.trim()),
      serviceUrl: record.serviceUrl,
      model: record.model,
      authHeader: record.authHeader,
      authScheme: record.authScheme,
      lastTestedAt: record.lastTestedAt,
      lastTestStatus: record.lastTestStatus,
      lastTestMessage: record.lastTestMessage
    };
  });
}

export async function saveConnection(request: SaveConnectionRequest): Promise<ConnectionSummary[]> {
  if (!isConnectionId(request.id)) throw new Error('Unsupported connection');
  const metadata = await loadMetadata();
  const existing = mergedMetadata(metadata, request.id);
  metadata.connections[request.id] = {
    ...existing,
    serviceUrl: validateUrl(request.serviceUrl, 'Service URL'),
    model: request.id === 'bmw-llm' ? request.model?.trim() ?? '' : undefined,
    authHeader: validateHeader(request.authHeader ?? existing.authHeader),
    authScheme: request.authScheme ?? existing.authScheme,
    lastTestedAt: undefined,
    lastTestStatus: 'untested',
    lastTestMessage: undefined
  };

  if (request.id === 'bmw-llm' && !metadata.connections[request.id]?.model) {
    throw new Error('BMW LLM model is required');
  }

  await saveMetadata(metadata);
  if (request.secret !== undefined && request.secret.trim()) {
    const secrets = await loadSecrets();
    secrets.secrets[request.id] = request.secret.trim();
    await saveSecrets(secrets);
  }
  return listConnections();
}

export async function removeConnection(id: ConnectionId): Promise<ConnectionSummary[]> {
  if (!isConnectionId(id)) throw new Error('Unsupported connection');
  const [metadata, secrets] = await Promise.all([loadMetadata(), loadSecrets()]);
  delete metadata.connections[id];
  delete secrets.secrets[id];
  await Promise.all([saveMetadata(metadata), saveSecrets(secrets)]);
  return listConnections();
}

function authorizationValue(metadata: ConnectionMetadata, secret: string): string {
  return metadata.authScheme === 'bearer' ? `Bearer ${secret}` : secret;
}

function testUrl(id: ConnectionId, serviceUrl: string): string {
  if (id === 'jira-atc') return `${serviceUrl}/rest/api/2/myself`;
  if (id === 'confluence-atc') return `${serviceUrl}/rest/api/content?limit=1`;
  return `${serviceUrl.replace(/\/v1$/, '')}/v1/models`;
}

export async function testConnection(id: ConnectionId): Promise<ConnectionTestResult> {
  if (!isConnectionId(id)) throw new Error('Unsupported connection');
  const [metadataStore, secretStore] = await Promise.all([loadMetadata(), loadSecrets()]);
  const metadata = mergedMetadata(metadataStore, id);
  const secret = secretStore.secrets[id];
  if (!metadata.serviceUrl.trim() || !secret?.trim()) throw new Error(`${CONNECTION_NAMES[id]} is not fully configured`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const testedAt = new Date().toISOString();
  let result: ConnectionTestResult;
  try {
    const response = await net.fetch(testUrl(id, metadata.serviceUrl), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        [metadata.authHeader]: authorizationValue(metadata, secret)
      },
      signal: controller.signal,
      redirect: 'follow'
    });
    result = {
      id,
      ok: response.ok,
      status: response.status,
      testedAt,
      message: response.ok ? 'Connection succeeded' : `Connection returned HTTP ${response.status}`
    };
  } catch (error) {
    result = {
      id,
      ok: false,
      testedAt,
      message: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timeout);
  }

  metadataStore.connections[id] = {
    ...metadata,
    lastTestedAt: testedAt,
    lastTestStatus: result.ok ? 'ok' : 'failed',
    lastTestMessage: result.message
  };
  await saveMetadata(metadataStore);
  return result;
}

const ENVIRONMENT_CONNECTIONS: Record<string, { id: ConnectionId; field: 'secret' | 'serviceUrl' | 'model' }> = {
  ATC_JIRA_TOKEN: { id: 'jira-atc', field: 'secret' },
  ATC_JIRA_URL: { id: 'jira-atc', field: 'serviceUrl' },
  ATC_CONFLUENCE_TOKEN: { id: 'confluence-atc', field: 'secret' },
  ATC_CONFLUENCE_URL: { id: 'confluence-atc', field: 'serviceUrl' },
  BMW_LLM_TOKEN: { id: 'bmw-llm', field: 'secret' },
  BMW_LLM_ENDPOINT: { id: 'bmw-llm', field: 'serviceUrl' },
  BMW_LLM_MODEL: { id: 'bmw-llm', field: 'model' }
};

export async function resolveAgentEnvironment(required: string[]): Promise<{ values: Record<string, string>; missing: string[] }> {
  const [metadataStore, secretStore] = await Promise.all([loadMetadata(), loadSecrets()]);
  const values: Record<string, string> = {};
  const missing: string[] = [];
  for (const name of required) {
    const inherited = process.env[name]?.trim();
    if (inherited) {
      values[name] = inherited;
      continue;
    }
    const mapping = ENVIRONMENT_CONNECTIONS[name];
    if (!mapping) {
      missing.push(name);
      continue;
    }
    const metadata = mergedMetadata(metadataStore, mapping.id);
    const value = mapping.field === 'secret'
      ? secretStore.secrets[mapping.id]
      : mapping.field === 'serviceUrl'
        ? metadata.serviceUrl
        : metadata.model;
    if (value?.trim()) values[name] = value.trim();
    else missing.push(name);
  }
  return { values, missing };
}
