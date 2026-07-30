import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppSettings, ProcessRuntimeId } from '../shared/contracts';
import { defaultSettings, validateSettings } from '../shared/settings';

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const parsed = JSON.parse(await fs.readFile(settingsPath(), 'utf8')) as unknown;
    return validateSettings(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
    throw error;
  }
}

async function saveSettings(settings: AppSettings): Promise<void> {
  const validated = validateSettings(settings);
  const target = settingsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true });
    throw error;
  }
}

export async function setRuntimeExecutableOverride(runtimeId: ProcessRuntimeId, executablePath: string): Promise<AppSettings> {
  const settings = await loadSettings();
  settings.runtimeExecutableOverrides[runtimeId] = executablePath;
  await saveSettings(settings);
  return settings;
}

export async function clearRuntimeExecutableOverride(runtimeId: ProcessRuntimeId): Promise<AppSettings> {
  const settings = await loadSettings();
  delete settings.runtimeExecutableOverrides[runtimeId];
  await saveSettings(settings);
  return settings;
}
