export interface ProcessRuntimeSpec {
  id: 'claude-code' | 'github-copilot';
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
