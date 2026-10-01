import assert from 'node:assert/strict';
import test from 'node:test';
import { newModel, newProvider, PROBE_KINDS, PROTOCOLS } from '../src/shared/providers';
import type { Protocol, ProbeKind } from '../src/shared/providers';
import { discoverModels, inspectStream, probeModel, probeRequest, providerHeaders } from '../src/main/provider-protocols';

function output(protocol: Protocol, kind: ProbeKind): object {
  const text = kind === 'structured-output' ? '{"ok":true}' : 'PROBE_OK';
  if (protocol === 'openai-responses') return { status: 'completed', output: kind === 'tool-calling' ? [{ type: 'function_call', name: 'configuration_probe', arguments: '{"ok":true}' }] : [{ content: [{ type: 'output_text', text }] }] };
  if (protocol === 'openai-chat') return { choices: [{ finish_reason: kind === 'tool-calling' ? 'tool_calls' : 'stop', message: kind === 'tool-calling' ? { tool_calls: [{ function: { name: 'configuration_probe', arguments: '{"ok":true}' } }] } : { content: text } }] };
  if (protocol === 'anthropic-messages') return { content: kind === 'tool-calling' ? [{ type: 'tool_use', name: 'configuration_probe', input: { ok: true } }] : [{ type: 'text', text }] };
  return { candidates: [{ finishReason: 'STOP', content: { parts: kind === 'tool-calling' ? [{ functionCall: { name: 'configuration_probe', args: { ok: true } } }] : [{ text }] } }] };
}
function stream(protocol: Protocol, completed = true): Response {
  const events = protocol === 'openai-responses' ? [{ type: 'response.output_text.delta', delta: 'PROBE_' }, { type: 'response.output_text.delta', delta: 'OK' }, ...(completed ? [{ type: 'response.completed' }] : [])]
    : protocol === 'openai-chat' ? [{ choices: [{ delta: { content: 'PROBE_OK' }, finish_reason: completed ? 'stop' : null }] }]
    : protocol === 'anthropic-messages' ? [{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'PROBE_OK' } }, ...(completed ? [{ type: 'message_stop' }] : [])]
    : [{ candidates: [{ content: { parts: [{ text: 'PROBE_OK' }] }, ...(completed ? { finishReason: 'STOP' } : {}) }] }];
  const wire = events.map((e) => `: comment\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join('');
  const bytes = new TextEncoder().encode(wire);
  return new Response(new ReadableStream({ start(controller) { for (let n = 0; n < bytes.length; n += 3) controller.enqueue(bytes.slice(n, n + 3)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}
for (const protocol of PROTOCOLS) {
  test(`${protocol}: builds and validates generation, JSON, tool and fragmented stream probes`, async () => {
    const provider = { ...newProvider('server', 'ollama'), protocol };
    const model = { ...newModel('model', provider.id), model: 'manual-model' };
    for (const kind of PROBE_KINDS) {
      const result = await probeModel(async (url, init) => {
        assert.equal(init.redirect, 'error');
        assert.equal(new URL(url).origin, 'http://localhost:11434');
        const body = JSON.parse(String(init.body));
        assert.ok(JSON.stringify(body).includes('manual-model') || url.includes('manual-model'));
        assert.ok(!JSON.stringify(body).includes('/workspace'));
        return kind === 'streaming' ? stream(protocol) : Response.json(output(protocol, kind));
      }, provider, model, kind);
      assert.equal(result.status, 'passed', result.message);
    }
    await assert.rejects(inspectStream(protocol, stream(protocol, false)), /incomplete/);
  });
}
test('native protocols use their own schema/tool formats and custom API-key headers', () => {
  for (const [preset, header] of [['anthropic', 'x-api-key'], ['gemini', 'x-goog-api-key']]) {
    const provider = newProvider('provider', preset);
    const headers = providerHeaders(provider, 'test-key');
    assert.equal(headers[header], 'test-key');
    assert.equal(headers.Authorization, undefined);
    const model = { ...newModel('model', provider.id), model: 'models/name', reasoningEffort: 'low', temperature: 0.2 };
    const { body, url } = probeRequest(provider, model, 'structured-output');
    assert.ok(preset === 'anthropic' ? body.output_config.format.schema : body.generationConfig.responseJsonSchema);
    if (preset === 'gemini') assert.match(url, /models\/name:generateContent$/);
  }
});
test('status and malformed responses never count as capability success; raw errors and secrets are not displayed', async () => {
  const provider = newProvider('provider', 'openai');
  const model = { ...newModel('model', provider.id), model: 'unknown' };
  for (const status of [400, 401, 403, 404, 429, 500]) {
    const result = await probeModel(async () => new Response('secret server body', { status }), provider, model, 'generation', 'test-secret');
    assert.equal(result.status, 'failed'); assert.match(result.message, new RegExp(String(status))); assert.doesNotMatch(result.message, /secret server body/);
  }
  const result = await probeModel(async () => { throw new Error('transport exposed test-secret'); }, provider, model, 'generation', 'test-secret');
  assert.doesNotMatch(result.message, /test-secret/);
  assert.equal((await probeModel(async () => Response.json({ output: [] }), provider, model, 'generation', 'key')).status, 'failed');
  assert.equal((await probeModel(async () => Response.json({ output: [{ type: 'function_call', name: 'other', arguments: '{}' }] }), provider, model, 'tool-calling', 'key')).status, 'failed');
});
test('large responses are bounded and a tool call never causes a follow-up execution request', async () => {
  const provider = newProvider('provider', 'ollama'); const model = { ...newModel('model', provider.id), model: 'local' }; let calls = 0;
  const result = await probeModel(async () => { calls++; return Response.json(output('openai-chat', 'tool-calling')); }, provider, model, 'tool-calling');
  assert.equal(result.status, 'passed'); assert.equal(calls, 1);
  const excessive = await probeModel(async () => new Response(' '.repeat(1024 * 1024 + 1)), provider, model, 'generation');
  assert.equal(excessive.status, 'failed'); assert.match(excessive.message, /limit/);
});
test('discovery paginates native APIs, handles transient retries and keeps manual entry possible', async () => {
  const provider = newProvider('provider', 'gemini'); let calls = 0;
  const result = await discoverModels(async (url, init) => {
    calls++; assert.equal(init.redirect, 'error');
    if (calls === 1) return new Response('', { status: 503 });
    if (!url.includes('pageToken')) return Response.json({ models: [{ name: 'models/first' }], nextPageToken: 'next' });
    return Response.json({ models: [{ name: 'models/second' }] });
  }, provider, 'key');
  assert.equal(calls, 3); assert.deepEqual(result.models, ['first', 'second']);
  await assert.rejects(discoverModels(async () => Response.json({ invalid: true }), provider, 'key'), /manually/);
});
test('cancellation aborts an outstanding probe without retrying it', async () => {
  const provider = newProvider('provider', 'ollama'); const model = { ...newModel('model', provider.id), model: 'local' };
  const controller = new AbortController(); let calls = 0;
  const pending = probeModel((_url, init) => new Promise((_resolve, reject) => {
    calls++; init.signal!.addEventListener('abort', () => reject(new Error('aborted'))); controller.abort();
  }), provider, model, 'generation', undefined, controller.signal);
  const result = await pending; assert.equal(calls, 1); assert.match(result.message, /cancelled/);
});
