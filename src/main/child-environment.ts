/** Child processes receive platform basics and explicitly approved credentials only. */
const BASICS = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'USERNAME', 'USER', 'LOGNAME',
  'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'APPDATA', 'LOCALAPPDATA',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ', 'TERM',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_RUNTIME_DIR',
  'DBUS_SESSION_BUS_ADDRESS', 'SSH_AUTH_SOCK',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy'
]);
export function childEnvironment(
  inherited: NodeJS.ProcessEnv = process.env,
  approved: Record<string, string> = {},
  runtime?: 'claude-code' | 'github-copilot'
): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(inherited).filter(([key, value]) => BASICS.has(key) && value !== undefined));
  const auth = runtime === 'claude-code' ? ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN']
    : runtime === 'github-copilot' ? ['COPILOT_GITHUB_TOKEN', 'GH_HOST', 'COPILOT_GITHUB_HOST', 'GITHUB_HOST'] : [];
  for (const name of auth) if (inherited[name]) env[name] = inherited[name];
  for (const [name, value] of Object.entries(approved)) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || /^(?:NODE_OPTIONS|PYTHONPATH|PYTHONHOME|LD_PRELOAD|LD_LIBRARY_PATH|DYLD_.*|BASH_ENV|ENV)$/i.test(name)) {
      throw new Error('A requested environment variable can inject host code and is not supported.');
    }
    env[name] = value;
  }
  return env;
}
