/** Known Local RGR entry points stay in the pipeline's own governed runner. */
const RGR_IDENTIFIERS = new Set([
  'forge', 'agent-dev-pipeline', 'ai-dev-pipeline', 'rgr-software', 'rgr-software-v2',
  'ai-pipeline-rgr-orchestrator', 'ai-pipeline-intake', 'ai-pipeline-prepare',
  'ai-pipeline-brainstorm', 'ai-pipeline-analyze', 'ai-pipeline-red-test',
  'ai-pipeline-green-code', 'ai-pipeline-refactor', 'ai-pipeline-quality-gate', 'ai-pipeline-converge'
]);

export const RGR_CONFIGURATION_MESSAGE = 'Forge is configuration-only in this workbench. Use Pipeline configuration to export project facts, then run the pipeline in its own coding environment.';

export function isConfigurationOnlyPipeline(...identities: string[]): boolean {
  return identities.some((value) => RGR_IDENTIFIERS.has(
    value.replaceAll('\\', '/').split('/').at(-1)!.replace(/\.agent\.md$|\.md$/i, '').toLowerCase()
  ));
}

export function assertWorkbenchExecutionAllowed(...identities: string[]): void {
  if (isConfigurationOnlyPipeline(...identities)) throw new Error(RGR_CONFIGURATION_MESSAGE);
}
