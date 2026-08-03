import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeOutputTracker } from '../src/main/runtime-output';

test('Claude stream JSON becomes readable progress messages', () => {
  const tracker = new RuntimeOutputTracker('claude-code');

  const init = tracker.consume('stdout', JSON.stringify({ type: 'system', subtype: 'init' }));
  assert.equal(init[0]?.message, 'Claude Code session started.');

  const command = tracker.consume('stdout', JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', name: 'Bash', input: { command: 'python3 scripts/validate-pack.py packs/rgr-software-v2/pack.json' } }]
    }
  }));
  assert.match(command[0]?.message ?? '', /^Running command: python3 scripts\/validate-pack\.py/);

  const delegation = tracker.consume('stdout', JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'tool_use', name: 'Task', input: { description: 'Run the RED stage' } }]
    }
  }));
  assert.equal(delegation[0]?.message, 'Delegating workflow step: Run the RED stage');
});

test('Claude result errors become the persisted failure reason', () => {
  const tracker = new RuntimeOutputTracker('claude-code');
  const notices = tracker.consume('stdout', JSON.stringify({
    type: 'result',
    subtype: 'error_max_turns',
    is_error: true,
    result: 'The workflow did not reach CONVERGE.'
  }));

  assert.equal(notices[0]?.error, true);
  assert.match(notices[0]?.message ?? '', /Max Turns: The workflow did not reach CONVERGE/);
  assert.equal(
    tracker.failureMessage(1),
    'Claude Code failed (exit code 1): Max Turns: The workflow did not reach CONVERGE.'
  );
});

test('plain stderr is preserved while credentials are redacted', () => {
  const tracker = new RuntimeOutputTracker('github-copilot');
  const notices = tracker.consume('stderr', 'Authorization: Bearer abcdefghijklmnop request rejected by gateway');

  assert.equal(notices[0]?.message, 'Authorization: Bearer [REDACTED] request rejected by gateway');
  assert.match(tracker.failureMessage(1), /request rejected by gateway/);
  assert.doesNotMatch(tracker.failureMessage(1), /abcdefghijklmnop/);
});

test('unknown structured progress is omitted instead of displayed as JSON noise', () => {
  const tracker = new RuntimeOutputTracker('claude-code');
  assert.deepEqual(tracker.consume('stdout', JSON.stringify({ type: 'system', subtype: 'heartbeat', internal: true })), []);
});
