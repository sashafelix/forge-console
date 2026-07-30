import type { ProcessRuntimeId } from './contracts';

export interface ProcessRuntimeSpec {
  id: ProcessRuntimeId;
  executableCandidates: string[];
  versionArgs: string[];
  previewArgs: string[];
}

export interface RuntimeExecutionPolicy {
  shell: 'denied' | 'allowed';
  network: 'denied' | 'allowed';
}

export const PROCESS_RUNTIME_SPECS: ProcessRuntimeSpec[] = [
  {
    id: 'claude-code',
    executableCandidates: ['claude'],
    versionArgs: ['--version'],
    previewArgs: [
      '-p',
      '--input-format', 'text',
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', '8',
      '--permission-mode', 'plan'
    ]
  },
  {
    id: 'github-copilot',
    executableCandidates: ['copilot'],
    versionArgs: ['--version'],
    previewArgs: [
      '--output-format=json',
      '--no-ask-user',
      '--no-color',
      '--no-remote',
      '--no-remote-export',
      '--deny-tool=write,shell'
    ]
  }
];

export function getProcessRuntimeSpec(runtimeId: string): ProcessRuntimeSpec | undefined {
  return PROCESS_RUNTIME_SPECS.find((spec) => spec.id === runtimeId);
}

export function buildExecutionArgs(
  runtimeId: ProcessRuntimeId,
  maxTurns: number,
  policy: RuntimeExecutionPolicy = { shell: 'denied', network: 'denied' }
): string[] {
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw new Error('maxTurns must be from 1 to 100');
  if (runtimeId === 'claude-code') {
    const allowedTools = ['Read', 'Write', 'Edit', 'Glob', 'Grep'];
    const disallowedTools: string[] = [];
    if (policy.shell === 'allowed') allowedTools.push('Bash'); else disallowedTools.push('Bash');
    if (policy.network === 'allowed') allowedTools.push('WebFetch', 'WebSearch'); else disallowedTools.push('WebFetch', 'WebSearch');
    return [
      '-p',
      '--input-format', 'text',
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', String(maxTurns),
      '--permission-mode', 'acceptEdits',
      '--allowedTools', allowedTools.join(','),
      ...(disallowedTools.length ? ['--disallowedTools', disallowedTools.join(',')] : [])
    ];
  }
  const availableTools = ['view', 'grep', 'glob', 'edit', 'create', 'apply_patch'];
  const allowedTools = ['write'];
  const deniedTools: string[] = [];
  if (policy.shell === 'allowed') {
    availableTools.push('shell');
    allowedTools.push('shell');
  } else {
    deniedTools.push('shell');
  }
  if (policy.network !== 'allowed') deniedTools.push('url');
  deniedTools.push('memory');
  return [
    '--output-format=json',
    '--no-ask-user',
    '--no-color',
    '--no-remote',
    '--no-remote-export',
    `--available-tools=${availableTools.join(',')}`,
    `--allow-tool=${allowedTools.join(',')}`,
    `--deny-tool=${deniedTools.join(',')}`
  ];
}
