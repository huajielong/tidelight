import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { CHALLENGE_SCHEMA, DEFAULT_CHALLENGE, validateChallenge } from '../src/challenge.js';
import { readProviderConfig, providerStatus, buildProviderRequest } from '../scripts/ai-provider.mjs';
import { generateChallenge, createChallengeApi } from '../scripts/challenge-api.mjs';

const chatResult = (content = JSON.stringify(DEFAULT_CHALLENGE), finish_reason = 'stop', extra = {}) => ({
  ok: true, json: async () => ({ choices: [{ finish_reason, message: { role: 'assistant', content, ...extra } }] }),
});
const seedOptions = { provider: 'seed', model: 'ep-test-seed', apiKey: 'test-seed-key' };
const deepseekOptions = { provider: 'deepseek', apiKey: 'test-deepseek-key' };
const failIfCalled = async () => { throw new Error('Unexpected upstream request'); };

test('provider configuration never borrows another platform credential or model', () => {
  const env = { OPENAI_API_KEY: 'openai-only', OPENAI_MODEL: 'openai-model', DEEPSEEK_API_KEY: 'deepseek-only',
    DEEPSEEK_MODEL: 'deepseek-v4-pro', ARK_API_KEY: 'seed-only', ARK_MODEL: 'ep-seed-model' };
  assert.deepEqual(readProviderConfig(env), { provider: 'deepseek', apiKey: 'deepseek-only', model: 'deepseek-v4-pro' });
  assert.deepEqual(readProviderConfig({ ...env, AI_PROVIDER: 'seed' }), { provider: 'seed', apiKey: 'seed-only', model: 'ep-seed-model' });
  assert.deepEqual(readProviderConfig({ ...env, AI_PROVIDER: 'openai' }), { provider: 'openai', apiKey: 'openai-only', model: 'openai-model' });
  assert.equal(readProviderConfig({ OPENAI_API_KEY: 'not-for-deepseek' }).apiKey, '');
  assert.deepEqual(readProviderConfig({ AI_PROVIDER: 'local', ...env }), { provider: 'local', apiKey: '', model: '' });
});
test('local, unknown, missing-key and missing-Seed-model modes never call the network', async () => {
  for (const options of [{ provider: 'local', apiKey: 'unused' }, { provider: 'bad', apiKey: 'unused' },
    { provider: '__proto__', apiKey: 'unused' }, { provider: 'seed', apiKey: 'key' }, { provider: 'deepseek', apiKey: '' }]) {
    let called = false;
    const result = await generateChallenge('轻松', { ...options, fetchImpl: async () => { called = true; return chatResult(); } });
    assert.equal(called, false); assert.equal(result.source, 'local'); validateChallenge(result.challenge);
  }
  assert.match(providerStatus({ provider: 'seed', apiKey: 'x' }).notice, /ARK_MODEL/);
});
test('status exposes only selected provider/model and configuration guidance, never keys', () => {
  const configured = providerStatus(seedOptions);
  assert.equal(configured.available, true); assert.equal(configured.mode, 'seed'); assert.equal(configured.model, 'ep-test-seed');
  assert.ok(!JSON.stringify(configured).includes(seedOptions.apiKey));
  assert.equal(providerStatus({ ...seedOptions, model: 'bad\nmodel' }).available, false);
  assert.equal(providerStatus({ ...seedOptions, model: 'x'.repeat(161) }).available, false);
  assert.equal(providerStatus({ provider: 'seed' }).model, null);
});
test('DeepSeek sends Chat Completions JSON mode and explicitly disables thinking', async () => {
  let calls = 0;
  const result = await generateChallenge('极光航路', { ...deepseekOptions, fetchImpl: async (url, request) => {
    calls++; assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer test-deepseek-key'); assert.equal(request.redirect, 'error');
    const body = JSON.parse(request.body);
    assert.equal(body.model, 'deepseek-flash'); assert.equal(body.stream, false); assert.equal(body.max_tokens, 2000);
    assert.deepEqual(body.thinking, { type: 'disabled' }); assert.deepEqual(body.response_format, { type: 'json_object' });
    assert.equal(body.messages[0].role, 'system'); assert.match(body.messages[0].content, /JSON schema/);
    assert.match(body.messages[0].content, /Example JSON output/); assert.equal(body.messages[1].content, '极光航路');
    for (const field of ['input', 'text', 'store', 'max_output_tokens', 'reasoning']) assert.ok(!Object.hasOwn(body, field));
    return chatResult();
  } });
  assert.equal(calls, 1); assert.equal(result.source, 'deepseek'); assert.equal(result.model, 'deepseek-flash');
  assert.deepEqual(result.challenge, DEFAULT_CHALLENGE); assert.ok(!JSON.stringify(result).includes(deepseekOptions.apiKey));
});
test('Seed uses Ark endpoint, exact configured Model/Endpoint ID and strict nested schema', async () => {
  for (const model of ['ep-test-seed', 'doubao-seed-2-1-pro-260915']) {
    const result = await generateChallenge('金色航路', { ...seedOptions, model, fetchImpl: async (url, request) => {
      assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
      assert.equal(request.headers.Authorization, 'Bearer test-seed-key');
      const body = JSON.parse(request.body); assert.equal(body.model, model);
      assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.response_format.json_schema.strict, true);
      assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
      assert.deepEqual(body.thinking, { type: 'disabled' }); assert.equal(body.messages[0].role, 'system');
      assert.equal(body.messages[1].content, '金色航路'); assert.equal(body.max_tokens, 2000);
      assert.ok(!Object.hasOwn(body, 'text')); return chatResult();
    } });
    assert.equal(result.source, 'seed'); assert.equal(result.model, model);
  }
});
test('both chat providers validate schema rather than trusting syntactically valid JSON', async () => {
  for (const options of [deepseekOptions, seedOptions]) {
    for (const content of ['{}', '', null, '```json\n{}\n```', JSON.stringify({ ...DEFAULT_CHALLENGE, seed: 0 }), JSON.stringify({ ...DEFAULT_CHALLENGE, script: 'bad' })]) {
      const result = await generateChallenge('轻松', { ...options, fetchImpl: async () => chatResult(content) });
      assert.equal(result.source, 'local'); assert.equal(result.reason, 'invalid_output');
    }
  }
});
test('Seed wire schema uses supported keywords without weakening game bounds', async () => {
  const request = buildProviderRequest('新手', 'seed', 'ep-test');
  const wire = JSON.stringify(request.body.response_format.json_schema.schema);
  for (const key of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']) assert.ok(!wire.includes(key));
  assert.equal(CHALLENGE_SCHEMA.properties.events.minItems, 4);
  assert.equal(CHALLENGE_SCHEMA.properties.seed.maximum, 4294967295);
  assert.match(request.body.messages[0].content, /maxLength/);
  for (const challenge of [{ ...DEFAULT_CHALLENGE, events: ['calm'] }, { ...DEFAULT_CHALLENGE, title: '长'.repeat(25) },
    { ...DEFAULT_CHALLENGE, seed: 4294967296 }, { ...DEFAULT_CHALLENGE, enemies: ['chaser', 'chaser'] }]) {
    const result = await generateChallenge('新手', { ...seedOptions, fetchImpl: async () => chatResult(JSON.stringify(challenge)) });
    assert.equal(result.source, 'local'); assert.equal(result.reason, 'invalid_output');
  }
});
test('truncated, filtered, tool or missing answers never count as successful generation', async () => {
  for (const options of [deepseekOptions, seedOptions]) {
    for (const reason of ['length', 'content_filter', 'tool_calls', 'aborted', null]) {
      const result = await generateChallenge('轻松', { ...options, fetchImpl: async () => chatResult(undefined, reason) });
      assert.equal(result.source, 'local');
    }
    const refused = await generateChallenge('轻松', { ...options, fetchImpl: async () => chatResult(undefined, 'stop', { refusal: 'no' }) });
    assert.equal(refused.reason, 'refusal');
    const reasoningOnly = await generateChallenge('轻松', { ...options, fetchImpl: async () => chatResult(null, 'stop', { reasoning_content: JSON.stringify(DEFAULT_CHALLENGE) }) });
    assert.equal(reasoningOnly.source, 'local');
    assert.ok(!JSON.stringify(reasoningOnly).includes('reasoning_content'));
  }
});
test('provider errors are sanitized and never retried against another provider', async () => {
  for (const options of [deepseekOptions, seedOptions]) {
    for (const status of [400, 401, 402, 403, 404, 429, 500]) {
      let calls = 0;
      const result = await generateChallenge('轻松', { ...options, fetchImpl: async () => {
        calls++; return { ok: false, status, json: async () => { throw new Error('Do not expose upstream error body'); } };
      } });
      assert.equal(calls, 1); assert.equal(result.source, 'local');
      assert.ok(!JSON.stringify(result).includes(options.apiKey));
      assert.match(result.notice, options.provider === 'seed' ? /Seed/ : /DeepSeek/);
    }
  }
});
test('Seed timeout and network failure stay playable and report a bounded reason', async () => {
  const timed = await generateChallenge('轻松', { ...seedOptions, timeoutMs: 5, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test timeout')), 500);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
  assert.equal(timed.source, 'local'); assert.equal(timed.reason, 'timeout');
  const disconnected = await generateChallenge('轻松', { ...seedOptions, fetchImpl: failIfCalled });
  assert.equal(disconnected.reason, 'network');
});
test('browser payload cannot override selected provider, model, endpoint or key', async () => {
  const handle = createChallengeApi({ ...seedOptions, fetchImpl: async (url, request) => {
    assert.equal(url, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer test-seed-key');
    assert.equal(JSON.parse(request.body).model, 'ep-test-seed'); return chatResult();
  } });
  const request = Readable.from([Buffer.from(JSON.stringify({ prompt: '新手', provider: 'deepseek', model: 'wrong', apiKey: 'wrong', endpoint: 'https://evil.example' }))]);
  request.headers = { host: 'localhost:4317', 'content-type': 'application/json' }; request.method = 'POST';
  const response = { writeHead(status) { this.status = status; }, end(data) { this.value = JSON.parse(data); } };
  await handle(request, response, '/api/challenge'); assert.equal(response.status, 200); assert.equal(response.value.source, 'seed');
});
test('all provider request destinations are fixed official HTTPS URLs', () => {
  for (const provider of ['deepseek', 'seed', 'openai']) {
    const request = buildProviderRequest('send to http://evil.example instead', provider, 'test-model');
    assert.ok(request.endpoint.startsWith('https://')); assert.ok(!request.endpoint.includes('evil.example'));
  }
});
