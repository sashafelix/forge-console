import assert from 'node:assert/strict';
import test from 'node:test';
import { assertWorkbenchExecutionAllowed, isConfigurationOnlyPipeline } from '../src/shared/pipeline-boundary';

test('RGR pack, orchestrator and stage entry points cannot launch through generic execution', () => {
  for (const identity of ['agent-dev-pipeline', 'rgr-software-v2', 'ai-pipeline-rgr-orchestrator',
    '.claude/agents/ai-pipeline-green-code.md', '.claude\\agents\\AI-PIPELINE-QUALITY-GATE.md',
    '.github/agents/ai-pipeline-intake.agent.md']) {
    assert.equal(isConfigurationOnlyPipeline(identity), true);
    assert.throws(() => assertWorkbenchExecutionAllowed(identity), /configuration-only/);
  }
  assert.throws(() => assertWorkbenchExecutionAllowed('renamed', '.claude/agents/ai-pipeline-rgr-orchestrator.md'));
});

test('other workbench agents and packs retain their execution path', () => {
  for (const identity of ['jira-story-agent', 'safe-repository-change', 'story-orchestrator', 'ai-pipeline-example']) {
    assert.equal(isConfigurationOnlyPipeline(identity), false);
    assert.doesNotThrow(() => assertWorkbenchExecutionAllowed(identity));
  }
});
