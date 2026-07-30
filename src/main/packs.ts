import { app, dialog } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PipelineManifest } from '../shared/contracts';
import { validatePipelineManifest } from '../shared/validation';

const MAX_PACK_FILES = 2_000;
const MAX_PACK_BYTES = 50 * 1024 * 1024;

function bundledRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'packs', 'examples')
    : path.join(app.getAppPath(), 'packs', 'examples');
}

function installedRoot(): string {
  return path.join(app.getPath('userData'), 'packs');
}

function safeSegment(value: string, label: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    throw new Error(`${label} may contain only letters, numbers, dot, underscore and hyphen`);
  }
  return value;
}

export async function readPipelineManifest(packDirectory: string): Promise<PipelineManifest> {
  const manifestPath = path.join(packDirectory, 'pipeline.json');
  const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
  const result = validatePipelineManifest(raw);
  if (!result.valid || !result.value) {
    throw new Error(`Invalid pipeline manifest ${manifestPath}: ${result.errors.join('; ')}`);
  }
  safeSegment(result.value.id, 'Pipeline id');
  safeSegment(result.value.version, 'Pipeline version');
  return result.value;
}

async function packDirectories(root: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

export async function listPipelineManifests(): Promise<PipelineManifest[]> {
  const directories = [...await packDirectories(bundledRoot()), ...await packDirectories(installedRoot())];
  const manifests = new Map<string, PipelineManifest>();

  for (const directory of directories) {
    const manifest = await readPipelineManifest(directory);
    manifests.set(`${manifest.id}@${manifest.version}`, manifest);
  }

  return [...manifests.values()].sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

interface CopyState {
  files: number;
  bytes: number;
}

async function copyPackDirectory(source: string, destination: string, state: CopyState): Promise<void> {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);
    const details = await fs.lstat(sourcePath);

    if (details.isSymbolicLink()) throw new Error(`Pipeline packs may not contain symbolic links: ${sourcePath}`);
    if (details.isDirectory()) {
      await copyPackDirectory(sourcePath, destinationPath, state);
      continue;
    }
    if (!details.isFile()) throw new Error(`Unsupported pack entry: ${sourcePath}`);

    state.files += 1;
    state.bytes += details.size;
    if (state.files > MAX_PACK_FILES) throw new Error(`Pipeline pack exceeds ${MAX_PACK_FILES} files`);
    if (state.bytes > MAX_PACK_BYTES) throw new Error(`Pipeline pack exceeds ${MAX_PACK_BYTES} bytes`);
    await fs.copyFile(sourcePath, destinationPath);
  }
}

export async function installPipelinePackFromDialog(): Promise<PipelineManifest | null> {
  const result = await dialog.showOpenDialog({
    title: 'Choose a pipeline pack folder',
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;

  const source = path.resolve(result.filePaths[0]);
  const manifest = await readPipelineManifest(source);
  const root = installedRoot();
  await fs.mkdir(root, { recursive: true });

  const destination = path.join(root, `${safeSegment(manifest.id, 'Pipeline id')}@${safeSegment(manifest.version, 'Pipeline version')}`);
  try {
    await fs.access(destination);
    throw new Error(`Pipeline ${manifest.id}@${manifest.version} is already installed`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const temporary = `${destination}.tmp-${randomUUID()}`;
  try {
    await copyPackDirectory(source, temporary, { files: 0, bytes: 0 });
    const copiedManifest = await readPipelineManifest(temporary);
    if (copiedManifest.id !== manifest.id || copiedManifest.version !== manifest.version) {
      throw new Error('Copied manifest identity changed during installation');
    }
    await fs.rename(temporary, destination);
    return copiedManifest;
  } catch (error) {
    await fs.rm(temporary, { recursive: true, force: true });
    throw error;
  }
}
