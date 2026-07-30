import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PipelineManifest, RuntimeAdapterDescriptor } from '../shared/contracts';
import { validatePipelineManifest } from '../shared/validation';

function examplesRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'packs', 'examples')
    : path.join(app.getAppPath(), 'packs', 'examples');
}

export async function listPipelineManifests(): Promise<PipelineManifest[]> {
  const root = examplesRoot();
  const entries = await fs.readdir(root, { withFileTypes: true });
  const manifests: PipelineManifest[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(root, entry.name, 'pipeline.json');
    const raw = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as unknown;
    const result = validatePipelineManifest(raw);
    if (!result.valid || !result.value) {
      throw new Error(`Invalid pipeline manifest ${manifestPath}: ${result.errors.join('; ')}`);
    }
    manifests.push(result.value);
  }

  return manifests.sort((a, b) => a.name.localeCompare(b.name));
}

export function listRuntimeAdapters(): RuntimeAdapterDescriptor[] {
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      description: 'Local process adapter for Claude Code sessions and tools.',
      kind: 'process',
      status: 'unconfigured',
      capabilities: ['repository.read', 'repository.write', 'command.execute', 'git.worktree', 'mcp.tools', 'structured.output'],
      configurationHint: 'Executable discovery and authentication checks are added in the runtime-adapter milestone.'
    },
    {
      id: 'github-copilot',
      name: 'GitHub Copilot',
      description: 'Local process or ACP adapter for GitHub Copilot CLI.',
      kind: 'process',
      status: 'unconfigured',
      capabilities: ['repository.read', 'repository.write', 'command.execute', 'mcp.tools', 'structured.output'],
      configurationHint: 'Connect an installed and authenticated Copilot CLI.'
    },
    {
      id: 'bmw-llm',
      name: 'BMW LLM',
      description: 'Controller-mediated HTTP adapter for the internal BMW model gateway.',
      kind: 'http',
      status: 'unconfigured',
      capabilities: ['structured.output', 'mcp.tools'],
      configurationHint: 'Configure the internal endpoint and authentication outside pipeline packs.'
    }
  ];
}
