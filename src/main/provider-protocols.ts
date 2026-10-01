import type { ModelBinding, ModelDiscovery, ProbeKind, ProbeResult, Provider, Protocol } from '../shared/providers';

export type ProviderFetch = (url: string, init: RequestInit) => Promise<Response>;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const TOOL = 'configuration_probe';
const SENTINEL = 'PROBE_OK';
type Json = Record<string, any>;

export function providerHeaders(provider: Provider, secret?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (provider.protocol === 'anthropic-messages') headers['anthropic-version'] = '2023-06-01';
  if (provider.auth.mode !== 'none') {
    if (!secret) throw new Error('Authentication is not configured. Save a credential for this provider.');
    if (/[\r\n\0]/.test(secret)) throw new Error('Invalid credential characters.');
    headers[provider.auth.mode === 'bearer' ? 'Authorization' : provider.auth.header] = provider.auth.mode === 'bearer' ? `Bearer ${secret}` : secret;
  }
  return headers;
}
function endpoint(provider: Provider, suffix: string): string { return `${provider.baseUrl.replace(/\/+$/, '')}/${suffix}`; }

export function probeRequest(provider: Provider, model: ModelBinding, kind: ProbeKind): { url: string; body: Json } {
  const prompt = kind === 'tool-calling' ? `Call ${TOOL} once with {"ok":true}. Do not answer with text.`
    : kind === 'structured-output' ? 'Return exactly {"ok":true} using the requested JSON schema.' : `Reply exactly with ${SENTINEL}.`;
  const stream = kind === 'streaming';
  const output = Math.min(model.maxOutputTokens, 512);
  const temperature = model.temperature === null ? {} : { temperature: model.temperature };
  let url: string; let body: Json;
  if (provider.protocol === 'openai-responses') {
    url = endpoint(provider, 'responses');
    body = { model: model.model, input: prompt, max_output_tokens: output, stream, store: false, ...temperature };
    if (model.reasoningEffort) body.reasoning = { effort: model.reasoningEffort };
    if (kind === 'structured-output') body.text = { format: { type: 'json_schema', name: 'probe', strict: true, schema: SCHEMA } };
    if (kind === 'tool-calling') {
      body.tools = [{ type: 'function', name: TOOL, description: 'Return the probe value; no action is performed.', strict: true, parameters: SCHEMA }];
      body.tool_choice = { type: 'function', name: TOOL };
    }
  } else if (provider.protocol === 'openai-chat') {
    url = endpoint(provider, 'chat/completions');
    body = { model: model.model, messages: [{ role: 'user', content: prompt }], max_tokens: output, stream, ...temperature };
    if (model.reasoningEffort) body.reasoning_effort = model.reasoningEffort;
    if (kind === 'structured-output') body.response_format = { type: 'json_schema', json_schema: { name: 'probe', strict: true, schema: SCHEMA } };
    if (kind === 'tool-calling') {
      body.tools = [{ type: 'function', function: { name: TOOL, description: 'Return the probe value; no action is performed.', parameters: SCHEMA } }];
      body.tool_choice = { type: 'function', function: { name: TOOL } };
    }
  } else if (provider.protocol === 'anthropic-messages') {
    url = endpoint(provider, 'messages');
    body = { model: model.model, messages: [{ role: 'user', content: prompt }], max_tokens: output, stream, ...temperature };
    if (model.reasoningEffort) body.output_config = { effort: model.reasoningEffort };
    if (kind === 'structured-output') body.output_config = { ...body.output_config, format: { type: 'json_schema', schema: SCHEMA } };
    if (kind === 'tool-calling') {
      body.tools = [{ name: TOOL, description: 'Return the probe value; no action is performed.', input_schema: SCHEMA }];
      body.tool_choice = { type: 'tool', name: TOOL };
    }
  } else {
    const modelName = model.model.replace(/^models\//, '');
    url = endpoint(provider, `models/${encodeURIComponent(modelName)}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`);
    body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: output, ...temperature } };
    if (model.reasoningEffort) body.generationConfig.thinkingConfig = { thinkingLevel: model.reasoningEffort.toUpperCase() };
    if (kind === 'structured-output') Object.assign(body.generationConfig, { responseMimeType: 'application/json', responseJsonSchema: SCHEMA });
    if (kind === 'tool-calling') {
      body.tools = [{ functionDeclarations: [{ name: TOOL, description: 'Return the probe value; no action is performed.', parametersJsonSchema: SCHEMA }] }];
      body.toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [TOOL] } };
    }
  }
  return { url, body };
}

function httpFailure(status: number): Error {
  const detail = status === 401 || status === 403 ? 'Authentication or permission rejected'
    : status === 404 ? 'Endpoint or model not found'
    : status === 429 ? 'Rate or quota limit reached'
    : status === 400 || status === 422 ? 'Request, parameter or capability not supported; check the model and protocol'
    : status >= 500 ? 'Provider service failed' : 'Provider request rejected';
  return new Error(`${detail} (HTTP ${status}).`);
}
async function readBody(response: Response, onChunk?: (chunk: string) => void): Promise<string> {
  if (!response.body) throw new Error('Provider returned an empty response.');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0; let body = '';
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Provider response exceeded the 1 MiB inspection limit.');
      const chunk = decoder.decode(value, { stream: true });
      if (onChunk) onChunk(chunk); else body += chunk;
    }
    const tail = decoder.decode(); if (onChunk) onChunk(tail); else body += tail;
    return body;
  } finally { await reader.cancel().catch(() => undefined); }
}
async function jsonResponse(response: Response): Promise<Json> {
  let value: unknown;
  try { value = JSON.parse(await readBody(response)); } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Provider returned invalid JSON.'); throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provider returned an unexpected JSON shape.');
  return value as Json;
}
function responseText(protocol: Protocol, data: Json): string {
  if (protocol === 'openai-responses') return (data.output ?? []).flatMap((item: Json) => item.content ?? []).filter((part: Json) => part.type === 'output_text').map((part: Json) => part.text ?? '').join('');
  if (protocol === 'openai-chat') return data.choices?.[0]?.message?.content ?? '';
  if (protocol === 'anthropic-messages') return (data.content ?? []).filter((part: Json) => part.type === 'text').map((part: Json) => part.text ?? '').join('');
  return (data.candidates?.[0]?.content?.parts ?? []).filter((part: Json) => !part.thought).map((part: Json) => part.text ?? '').join('');
}
function validProbeObject(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && (value as Json).ok === true);
}
function toolResult(protocol: Protocol, data: Json): boolean {
  let calls: Json[];
  if (protocol === 'openai-responses') calls = (data.output ?? []).filter((item: Json) => item.type === 'function_call');
  else if (protocol === 'openai-chat') calls = (data.choices?.[0]?.message?.tool_calls ?? []).map((item: Json) => item.function);
  else if (protocol === 'anthropic-messages') calls = (data.content ?? []).filter((part: Json) => part.type === 'tool_use').map((part: Json) => ({ name: part.name, arguments: part.input }));
  else calls = (data.candidates?.[0]?.content?.parts ?? []).filter((part: Json) => part.functionCall).map((part: Json) => ({ name: part.functionCall.name, arguments: part.functionCall.args }));
  return calls.length === 1 && calls[0].name === TOOL && validProbeObject(typeof calls[0].arguments === 'string' ? JSON.parse(calls[0].arguments) : calls[0].arguments);
}

/** Incremental SSE parser: handles split UTF-8, CRLF, multiline data and explicit completion. */
export async function inspectStream(protocol: Protocol, response: Response): Promise<void> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('Streaming test did not receive an SSE stream.');
  let buffer = ''; let dataLines: string[] = []; let text = ''; let completed = false; let failed = false;
  const event = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join('\n'); dataLines = [];
    if (raw === '[DONE]') return;
    const data = JSON.parse(raw) as Json;
    if (data.error || data.type === 'error') failed = true;
    if (protocol === 'openai-responses') {
      if (data.type === 'response.output_text.delta') text += data.delta ?? '';
      if (data.type === 'response.completed') completed = true;
      if (['response.failed', 'response.incomplete'].includes(data.type)) failed = true;
    } else if (protocol === 'openai-chat') {
      for (const choice of data.choices ?? []) {
        text += choice.delta?.content ?? '';
        if (choice.finish_reason === 'stop') completed = true;
        else if (choice.finish_reason) failed = true;
      }
    } else if (protocol === 'anthropic-messages') {
      if (data.type === 'content_block_delta' && data.delta?.type === 'text_delta') text += data.delta.text ?? '';
      if (data.delta?.stop_reason && data.delta.stop_reason !== 'end_turn') failed = true;
      if (data.type === 'message_stop') completed = true;
    } else {
      text += responseText(protocol, data);
      for (const candidate of data.candidates ?? []) {
        if (candidate.finishReason === 'STOP') completed = true;
        else if (candidate.finishReason) failed = true;
      }
    }
  };
  await readBody(response, (chunk) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, ''); buffer = buffer.slice(newline + 1);
      if (!line) event(); else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  });
  if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5).trim()); event();
  if (failed || !completed || text.trim() !== SENTINEL) throw new Error('Streaming response was incomplete, failed, or did not match the probe.');
}

export async function probeModel(fetcher: ProviderFetch, provider: Provider, model: ModelBinding, kind: ProbeKind, secret?: string, signal?: AbortSignal): Promise<ProbeResult> {
  const started = Date.now(); const controller = new AbortController(); const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
  const timer = setTimeout(abort, provider.timeoutMs);
  try {
    const { url, body } = probeRequest(provider, model, kind);
    const response = await fetcher(url, { method: 'POST', headers: providerHeaders(provider, secret), body: JSON.stringify(body), redirect: 'error', signal: controller.signal });
    if (!response.ok) { await response.body?.cancel(); throw httpFailure(response.status); }
    if (kind === 'streaming') await inspectStream(provider.protocol, response);
    else {
      const data = await jsonResponse(response);
      if (data.error || data.status === 'incomplete' || data.status === 'failed' || data.stop_reason === 'max_tokens' || data.choices?.[0]?.finish_reason === 'length' || (data.candidates?.[0]?.finishReason && data.candidates[0].finishReason !== 'STOP')) throw new Error('Provider returned an incomplete or failed generation.');
      if (kind === 'tool-calling') {
        if (!toolResult(provider.protocol, data)) throw new Error('Provider did not return the expected tool name and arguments. No tool was executed.');
      } else {
        const content = responseText(provider.protocol, data);
        if (typeof content !== 'string' || (kind === 'generation' ? content.trim() !== SENTINEL : !validProbeObject(JSON.parse(content)))) throw new Error('Model output did not match the diagnostic schema or expected reply.');
      }
    }
    return { kind, status: 'passed', message: 'Synthetic probe passed. This is not a quality benchmark or execution approval.', testedAt: new Date().toISOString(), latencyMs: Date.now() - started };
  } catch (error) {
    const message = controller.signal.aborted ? signal?.aborted ? 'Probe cancelled.' : 'Probe timed out; check model load and timeout.'
      : error instanceof SyntaxError ? 'Response did not contain valid diagnostic JSON.'
      : error instanceof TypeError ? 'Network/TLS request failed or response shape was incompatible. Check endpoint, certificates and proxy settings.'
      : error instanceof Error ? error.message : 'Provider probe failed.';
    return { kind, status: 'failed', message: (secret ? message.replaceAll(secret, '[REDACTED]') : message).slice(0, 500), testedAt: new Date().toISOString(), latencyMs: Date.now() - started };
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function discoverModels(fetcher: ProviderFetch, provider: Provider, secret?: string): Promise<ModelDiscovery> {
  const models = new Set<string>(); let cursor = ''; let truncated = false;
  for (let page = 0; page < 3; page++) {
    const query = new URLSearchParams();
    if (provider.protocol === 'gemini') { query.set('pageSize', '100'); if (cursor) query.set('pageToken', cursor); }
    else if (provider.protocol === 'anthropic-messages') { query.set('limit', '100'); if (cursor) query.set('after_id', cursor); }
    let data: Json | undefined;
    for (let attempt = 0; attempt <= provider.discoveryRetries; attempt++) {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), provider.timeoutMs);
      try {
        const response = await fetcher(endpoint(provider, `models${query.size ? '?' + query : ''}`), { method: 'GET', headers: providerHeaders(provider, secret), redirect: 'error', signal: controller.signal });
        if (!response.ok) {
          await response.body?.cancel();
          if ([429, 502, 503, 504].includes(response.status) && attempt < provider.discoveryRetries) { await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1))); continue; }
          throw httpFailure(response.status);
        }
        data = await jsonResponse(response); break;
      } catch (error) {
        if (controller.signal.aborted) throw new Error('Model discovery timed out. Manual model entry remains available.');
        if (error instanceof TypeError) throw new Error('Model discovery could not reach the endpoint. Check network, certificates and proxy settings.');
        throw error;
      } finally { clearTimeout(timer); }
    }
    if (!data) throw new Error('Model discovery failed.');
    const list = provider.protocol === 'gemini' ? data.models : data.data;
    if (!Array.isArray(list)) throw new Error('Endpoint did not return a model list. Enter a model ID manually.');
    for (const item of list) {
      const name = provider.protocol === 'gemini' ? item?.name?.replace(/^models\//, '') : item?.id;
      if (typeof name === 'string' && name.length <= 256 && !/[\u0000-\u001f]/.test(name)) models.add(name);
    }
    cursor = provider.protocol === 'gemini' ? data.nextPageToken : provider.protocol === 'anthropic-messages' && data.has_more ? data.last_id : '';
    if (cursor && (typeof cursor !== 'string' || cursor.length > 2048)) throw new Error('Invalid model-list pagination token.');
    truncated = Boolean(cursor); if (!cursor) break;
  }
  return { models: [...models].sort().slice(0, 300), truncated: truncated || models.size > 300, message: 'Discovery lists advertised IDs only; test the selected model separately. Manual IDs are always supported.' };
}
