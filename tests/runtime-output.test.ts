import assert from 'node:assert/strict';
import test from 'node:test';
import { RuntimeOutputTracker } from '../src/main/runtime-output';

test('Claude stream JSON becomes readable progress messages', () => {
  const tracker = new RuntimeOutputTracker('claude-code');

  const init = tracker.consume('stdout', JSON.stringify({ type: 'system', subtype: 'init', session_id: 'claude-session-123' }));
  assert.equal(init[0]?.message, 'Claude Code session started.');
  assert.equal(tracker.sessionId(), 'claude-session-123');

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

test('native ask-user tools become a durable interaction request', () => {
  const tracker = new RuntimeOutputTracker('claude-code');
  const notices = tracker.consume('stdout', JSON.stringify({
    type: 'assistant',
    session_id: 'session-question-1',
    message: {
      content: [{
        type: 'tool_use',
        name: 'AskUserQuestion',
        input: {
          questions: [{
            question: 'Which user role owns this decision?',
            description: 'The story cannot assign ownership without this answer.',
            options: [{ label: 'Credit analyst' }, { label: 'Dealer' }]
          }]
        }
      }]
    }
  }));

  assert.equal(notices[0]?.message, 'Waiting for your answer: Which user role owns this decision?');
  assert.equal(tracker.sessionId(), 'session-question-1');
  assert.deepEqual(tracker.pendingInteraction(), {
    question: 'Which user role owns this decision?',
    reason: 'The story cannot assign ownership without this answer.',
    choices: ['Credit analyst', 'Dealer'],
    allowFreeText: true
  });
});

test('portable agent-input and agent-result contracts are parsed and hidden from progress output', () => {
  const tracker = new RuntimeOutputTracker('github-copilot');
  const questionText = [
    'I need one decision before continuing.',
    '```agent-input',
    '{"question":"What business outcome should this achieve?","reason":"Intent is missing","choices":[],"allowFreeText":true}',
    '```'
  ].join('\n');
  const question = tracker.consume('stdout', JSON.stringify({ type: 'assistant', message: questionText, session_id: 'copilot-session-9' }));

  assert.equal(question[0]?.message, 'I need one decision before continuing.');
  assert.equal(tracker.sessionId(), 'copilot-session-9');
  assert.equal(tracker.pendingInteraction()?.question, 'What business outcome should this achieve?');

  const resultText = [
    'The review is ready.',
    '```agent-result',
    '{"summary":"Reviewed NSCNL-17491 and wrote the evidence-backed draft."}',
    '```'
  ].join('\n');
  tracker.consume('stdout', JSON.stringify({ type: 'result', result: resultText }));
  assert.equal(tracker.resultSummary(), 'Reviewed NSCNL-17491 and wrote the evidence-backed draft.');
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

test('Copilot resume hints are captured from plain output', () => {
  const tracker = new RuntimeOutputTracker('github-copilot');
  tracker.consume('stderr', 'Resume this session with: copilot --resume=12345678-abcd-4321-9999-123456789abc');
  assert.equal(tracker.sessionId(), '12345678-abcd-4321-9999-123456789abc');
});

test('unknown structured progress is omitted instead of displayed as JSON noise', () => {
  const tracker = new RuntimeOutputTracker('claude-code');
  assert.deepEqual(tracker.consume('stdout', JSON.stringify({ type: 'system', subtype: 'heartbeat', internal: true })), []);
});
