import { session } from 'electron';
import type { NetworkSettings, ProcessRuntimeId } from '../shared/contracts';
import { loadSettings } from './settings';

const PROXY_ENVIRONMENT_NAMES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'all_proxy'
] as const;

function inheritedProxy(name: 'HTTP_PROXY' | 'HTTPS_PROXY' | 'NO_PROXY' | 'ALL_PROXY'): string {
  return process.env[name]?.trim() || process.env[name.toLowerCase()]?.trim() || '';
}

function proxyRuleValue(value: string): string {
  if (!value) return '';
  const parsed = new URL(value);
  return `${parsed.protocol}//${parsed.host}`;
}

function manualProxyRules(settings: NetworkSettings): string {
  const http = settings.httpProxy || settings.httpsProxy;
  const https = settings.httpsProxy || settings.httpProxy;
  const rules: string[] = [];
  if (http) rules.push(`http=${proxyRuleValue(http)}`);
  if (https) rules.push(`https=${proxyRuleValue(https)}`);
  return rules.join(';');
}

function inheritedProxySettings(): NetworkSettings {
  return {
    proxyMode: 'manual',
    httpProxy: inheritedProxy('HTTP_PROXY'),
    httpsProxy: inheritedProxy('HTTPS_PROXY'),
    noProxy: inheritedProxy('NO_PROXY'),
    caCertificatePath: process.env.NODE_EXTRA_CA_CERTS?.trim() || process.env.SSL_CERT_FILE?.trim() || ''
  };
}

function providerProbeUrl(runtimeId: ProcessRuntimeId): URL {
  if (runtimeId === 'claude-code') return new URL('https://api.anthropic.com');
  const configuredHost = process.env.COPILOT_GITHUB_HOST?.trim()
    || process.env.GH_HOST?.trim()
    || process.env.GITHUB_HOST?.trim()
    || 'github.com';
  const normalized = /^https?:\/\//i.test(configuredHost) ? configuredHost : `https://${configuredHost}`;
  return new URL(normalized);
}

function parseResolvedSystemProxy(value: string): { proxy?: string; allProxy?: string; direct: boolean } {
  for (const entry of value.split(';').map((item) => item.trim()).filter(Boolean)) {
    const [kind, target] = entry.split(/\s+/, 2);
    if (/^DIRECT$/i.test(kind)) return { direct: true };
    if (!target) continue;
    if (/^(PROXY|HTTPS)$/i.test(kind)) return { proxy: `${/^HTTPS$/i.test(kind) ? 'https' : 'http'}://${target}`, direct: false };
    if (/^(SOCKS|SOCKS4|SOCKS5)$/i.test(kind)) return { allProxy: `socks5://${target}`, direct: false };
  }
  return { direct: true };
}

function clearProxyEnvironment(env: NodeJS.ProcessEnv): void {
  for (const name of PROXY_ENVIRONMENT_NAMES) delete env[name];
}

function setProxyEnvironment(env: NodeJS.ProcessEnv, settings: NetworkSettings): void {
  const http = settings.httpProxy || settings.httpsProxy;
  const https = settings.httpsProxy || settings.httpProxy;
  if (http) {
    env.HTTP_PROXY = http;
    env.http_proxy = http;
  }
  if (https) {
    env.HTTPS_PROXY = https;
    env.https_proxy = https;
  }
  if (settings.noProxy) {
    env.NO_PROXY = settings.noProxy;
    env.no_proxy = settings.noProxy;
  }
}

export async function applyElectronNetworkSettings(): Promise<void> {
  const { network } = await loadSettings();
  const chromiumSession = session.defaultSession;

  if (network.proxyMode === 'direct') {
    await chromiumSession.setProxy({ mode: 'direct' });
  } else if (network.proxyMode === 'manual') {
    await chromiumSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: manualProxyRules(network),
      proxyBypassRules: network.noProxy || undefined
    });
  } else if (network.proxyMode === 'inherit') {
    const inherited = inheritedProxySettings();
    if (inherited.httpProxy || inherited.httpsProxy) {
      await chromiumSession.setProxy({
        mode: 'fixed_servers',
        proxyRules: manualProxyRules(inherited),
        proxyBypassRules: inherited.noProxy || undefined
      });
    } else {
      await chromiumSession.setProxy({ mode: 'system' });
    }
  } else {
    await chromiumSession.setProxy({ mode: 'system' });
  }

  await chromiumSession.closeAllConnections();
}

export async function applyConfiguredNetworkEnvironment(
  base: NodeJS.ProcessEnv,
  runtimeId: ProcessRuntimeId
): Promise<NodeJS.ProcessEnv> {
  const { network } = await loadSettings();
  const env: NodeJS.ProcessEnv = { ...base };

  if (network.proxyMode === 'direct') {
    clearProxyEnvironment(env);
  } else if (network.proxyMode === 'manual') {
    clearProxyEnvironment(env);
    setProxyEnvironment(env, network);
  } else if (network.proxyMode === 'system') {
    clearProxyEnvironment(env);
    await session.defaultSession.setProxy({ mode: 'system' });
    const resolved = parseResolvedSystemProxy(await session.defaultSession.resolveProxy(providerProbeUrl(runtimeId).toString()));
    if (resolved.proxy) {
      env.HTTP_PROXY = resolved.proxy;
      env.http_proxy = resolved.proxy;
      env.HTTPS_PROXY = resolved.proxy;
      env.https_proxy = resolved.proxy;
    }
    if (resolved.allProxy) {
      env.ALL_PROXY = resolved.allProxy;
      env.all_proxy = resolved.allProxy;
    }
    if (network.noProxy) {
      env.NO_PROXY = network.noProxy;
      env.no_proxy = network.noProxy;
    }
  }

  if (network.caCertificatePath) {
    env.NODE_EXTRA_CA_CERTS = network.caCertificatePath;
    env.SSL_CERT_FILE = network.caCertificatePath;
  }

  return env;
}
