import type { ProcessRuntimeId } from './contracts';

export interface ProcessRuntimeSpec {
  id: ProcessRuntimeId;
  executableCandidates: string[];
  versionArgs: string[];
  previewArgs: string[];
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

export function buildExecutionArgs(runtimeId: ProcessRuntimeId, maxTurns: number): string[] {
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 100) throw new Error('maxTurns must be from 1 to 100');
  if (runtimeId === 'claude-code') {
    return [
      '-p',
      '--input-format', 'text',
      '--output-format', 'stream-json',
      '--verbose',
      '--max-turns', String(maxTurns),
      '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Write,Edit,Glob,Grep',
      '--disallowedTools', 'Bash,WebFetch,WebSearch'
    ];
  }
  return [
    '--output-format=json',
    '--no-ask-user',
    '--no-color',
    '--no-remote',
    '--no-remote-export',
    '--available-tools=view,grep,glob,edit,create,apply_patch',
    '--allow-tool=write',
    '--deny-tool=shell,url,memory'
  ];
}
