import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHandler } from '../scripts/cloud-api.mjs';
import { quotaLimits, quotaPeriod, reserveGeneration } from '../scripts/cloud-quota.mjs';
import { config } from '../netlify/functions/challenge.mjs';
import { validateChallenge } from '../src/challenge.js';

const production = { deploy: { context: 'production' } };
const settings = { AI_PROVIDER: 'deepseek', DEEPSEEK_API_KEY: 'test-only-not-a-real-secret' };
const req = (body = { prompt: '极光新手练习' }, options = {}) => new Request('https://game.example/api/challenge', {
  method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://game.example', ...options.headers },
  body: JSON.stringify(body), ...options,
});
const localHandler = (overrides = {}) => createCloudHandler({ env: () => settings, ...overrides });

test('cloud route has platform IP/domain rate limiting', () => {
  assert.equal(config.path, '/api/challenge');
  assert.deepEqual(config.rateLimit, { windowLimit: 5, windowSize: 60, aggregateBy: ['ip', 'domain'] });
});

test('reserve before model; pass only server-selected provider settings', async () => {
  const order = [];
  const handle = localHandler({ reserve: async ({ limits }) => { order.push('quota'); assert.deepEqual(limits, { daily: 100, monthly: 1000 }); return true; },
    generate: async (prompt, provider) => { order.push('model'); assert.equal(prompt, '极光新手练习'); assert.equal(provider.apiKey, settings.DEEPSEEK_API_KEY); return { source: 'deepseek' }; } });
  const response = await handle(req({ prompt: '极光新手练习', provider: 'openai', apiKey: 'ignored', model: 'ignored' }), production);
  assert.deepEqual(order, ['quota', 'model']);
  assert.equal((await response.json()).source, 'deepseek');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('quota exhaustion, DB failure and invalid config fail closed with playable fallback', async () => {
  for (const mode of ['exhausted', 'failure', 'configuration']) {
    let generated = 0;
    const handle = localHandler({ env: () => ({ ...settings, ...(mode === 'configuration' ? { AI_DAILY_LIMIT: '-1' } : {}) }),
      reserve: async () => { if (mode === 'failure') throw new Error('must-not-leak-connection-string'); return false; },
      generate: async () => { generated++; } });
    const response = await handle(req(), production);
    const data = await response.json();
    assert.equal(generated, 0);
    assert.equal(data.source, 'local');
    validateChallenge(data.challenge);
    assert.equal(data.reason, mode === 'exhausted' ? 'site_quota' : 'quota_unavailable');
    assert.ok(!JSON.stringify(data).includes('must-not-leak'));
  }
});

test('preview, missing deployment context and missing key never reserve or generate', async () => {
  for (const [env, context] of [[settings, { deploy: { context: 'deploy-preview' } }], [settings, {}], [{}, production]]) {
    const forbidden = () => { assert.fail('must not contact DB or provider'); };
    const response = await createCloudHandler({ env: () => env, reserve: forbidden, generate: forbidden })(req(), context);
    assert.equal((await response.json()).source, 'local');
  }
});

test('status contains no credentials and previews are honestly marked local', async () => {
  const handle = localHandler();
  const request = new Request('https://game.example/api/challenge/status');
  const result = await handle(request, production);
  const text = await result.text();
  assert.ok(!text.includes(settings.DEEPSEEK_API_KEY));
  assert.equal(JSON.parse(text).available, true);
  assert.equal((await (await handle(request, {})).json()).available, false);
});

test('reject hostile origins, non-JSON, malformed and oversized bodies without reservations', async () => {
  const forbidden = () => { assert.fail('must not spend on rejected requests'); };
  const handle = localHandler({ reserve: forbidden, generate: forbidden });
  for (const [request, status] of [
    [req(undefined, { headers: { origin: 'https://evil.example' } }), 403],
    [req(undefined, { headers: { 'sec-fetch-site': 'cross-site' } }), 403],
    [req(undefined, { headers: { 'content-type': 'text/plain' } }), 415],
    [req({ prompt: ' ' }), 400], [req(null), 400], [req({ prompt: 'a'.repeat(201) }), 400],
    [req({ prompt: 'valid', padding: 'a'.repeat(4096) }), 413],
    [req(undefined, { body: '{invalid' }), 400],
    [new Request('https://game.example/api/challenge'), 405],
    [new Request('https://game.example/api/missing'), 404],
  ]) assert.equal((await handle(request, production)).status, status);
});

test('streamed body limit cannot be bypassed by omitting content-length', async () => {
  const request = new Request('https://game.example/api/challenge', { method: 'POST', duplex: 'half', headers: { 'content-type': 'application/json' },
    body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(3000)); c.enqueue(new Uint8Array(2000)); c.close(); } }) });
  assert.equal((await localHandler({ reserve: () => assert.fail() })(request, production)).status, 413);
});

test('unexpected provider exceptions remain sanitized, and failures are not refunded', async () => {
  let reservations = 0;
  const handle = localHandler({ reserve: async () => { reservations++; return true; }, generate: async () => { throw new Error('secret'); } });
  const response = await handle(req(), production);
  assert.equal((await response.json()).reason, 'upstream');
  assert.equal(reservations, 1);
});

test('quota settings can reduce or disable limits, never raise the safety caps', async () => {
  assert.deepEqual(quotaLimits(), { daily: 100, monthly: 1000 });
  assert.deepEqual(quotaLimits({ AI_DAILY_LIMIT: '0', AI_MONTHLY_LIMIT: '12' }), { daily: 0, monthly: 12 });
  assert.deepEqual(quotaLimits({ AI_DAILY_LIMIT: '999', AI_MONTHLY_LIMIT: '9000' }), { daily: 100, monthly: 1000 });
  assert.throws(() => quotaLimits({ AI_DAILY_LIMIT: 'NaN' }));
  assert.equal(await reserveGeneration({ limits: { daily: 0, monthly: 1000 } }), false);
});

test('quota boundaries use Asia/Shanghai regardless of server timezone', () => {
  assert.deepEqual(quotaPeriod(new Date('2026-10-31T15:59:59Z')), { month: '2026-10', day: '2026-10-31' });
  assert.deepEqual(quotaPeriod(new Date('2026-10-31T16:00:00Z')), { month: '2026-11', day: '2026-11-01' });
});
