import path from 'node:path';

export function defaultSearchDirectories(home: string, platform: NodeJS.Platform): string[] {
  const common = [
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin')
  ];
  if (platform === 'darwin') {
    return [...common, path.join(home, 'Library', 'pnpm'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'];
  }
  if (platform === 'linux') {
    return [...common, path.join(home, '.local', 'share', 'pnpm'), '/usr/local/bin', '/usr/bin', '/bin'];
  }
  return common;
}

export function buildSearchPath(
  configuredPath: string,
  home: string,
  platform: NodeJS.Platform,
  delimiter = path.delimiter
): string {
  const entries = [...configuredPath.split(delimiter).filter(Boolean), ...defaultSearchDirectories(home, platform)];
  return [...new Set(entries.map((entry) => path.resolve(entry)))].join(delimiter);
}
