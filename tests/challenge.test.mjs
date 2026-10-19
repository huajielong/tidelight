import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';
import { DEFAULT_CHALLENGE, validateChallenge, localChallenge, encodeChallenge, decodeChallenge } from '../src/challenge.js';
import { generateChallenge, createChallengeApi } from '../scripts/challenge-api.mjs';

test('challenge validator is strict, bounded and detached', () => {
  const result = validateChallenge(DEFAULT_CHALLENGE);
  result.enemies.pop(); assert.equal(DEFAULT_CHALLENGE.enemies.length, 3);
  for (const bad of [null, [], {}, { ...DEFAULT_CHALLENGE, speed: 1000 },
    { ...DEFAULT_CHALLENGE, seed: 0 }, { ...DEFAULT_CHALLENGE, seed: 4294967296 },
    { ...DEFAULT_CHALLENGE, title: 'x'.repeat(25) }, { ...DEFAULT_CHALLENGE, description: '\n' },
    { ...DEFAULT_CHALLENGE, difficulty: 'god' }, { ...DEFAULT_CHALLENGE, enemies: ['chaser', 'chaser'] },
    { ...DEFAULT_CHALLENGE, events: ['calm'] }, { ...DEFAULT_CHALLENGE, events: ['calm', 'calm', 'calm', '__proto__'] }]) {
    assert.throws(() => validateChallenge(bad));
  }
});
test('keyword fallback changes only supported preferences deterministically', () => {
  const c = localChallenge('新手极光环形金色，不要伏潮者');
  assert.equal(c.difficulty, 'gentle'); assert.equal(c.theme, 'aurora'); assert.equal(c.route, 'spiral');
  assert.ok(!c.enemies.includes('ambusher')); assert.deepEqual(c.events, ['calm', 'trail', 'trail', 'finale']);
  assert.deepEqual(c, localChallenge('新手极光环形金色，不要伏潮者'));
  assert.deepEqual(localChallenge('困难全程追逐暖色').enemies, ['chaser']);
  assert.equal(localChallenge('困难全程追逐暖色').difficulty, 'fierce');
  assert.throws(() => localChallenge(' ')); assert.throws(() => localChallenge('字'.repeat(201)));
});
test('UTF8 challenge codes roundtrip exactly and reject malformed inputs', () => {
  const c = { ...DEFAULT_CHALLENGE, title: '极光·夜航🌙', seed: 4294967295 };
  assert.deepEqual(decodeChallenge(encodeChallenge(c)), c);
  for (const code of ['', 'TL2.abc', 'TL1.!!!', 'TL1.eyJ9', 'TL1.' + 'x'.repeat(3000)]) assert.throws(() => decodeChallenge(code));
});
test('missing key is explicitly local without any network call', async () => {
  const result = await generateChallenge('新手', { fetchImpl: () => { throw new Error('must not call'); } });
  assert.equal(result.source, 'local'); assert.match(result.notice, /本地/);
});
test('Responses integration sends bounded JSON schema, not secrets to the client', async () => {
  const key = 'test-only-placeholder';
  const result = await generateChallenge('极光', { provider: 'openai', apiKey: key, fetchImpl: async (url, request) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal(request.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(request.body);
    assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    assert.equal(body.input[1].content, '极光'); assert.equal(body.text.format.schema.additionalProperties, false);
    return { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(DEFAULT_CHALLENGE) }] }] }) };
  } });
  assert.equal(result.source, 'openai'); assert.deepEqual(result.challenge, DEFAULT_CHALLENGE);
  assert.ok(!JSON.stringify(result).includes(key));
});
test('auth, upstream errors, refusal, truncation, invalid JSON and schema all fall back', async () => {
  const responses = [
    { ok: false, status: 401 }, { ok: false, status: 429 }, { ok: false, status: 500 },
    { ok: true, json: async () => ({ status: 'incomplete' }) },
    { ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal' }] }] }) },
    ...['no JSON', '{}', JSON.stringify({ ...DEFAULT_CHALLENGE, seed: -4 })].map(text => ({ ok: true, json: async () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }) })),
  ];
  for (const response of responses) {
    const result = await generateChallenge('金色', { provider: 'openai', apiKey: 'test-only', fetchImpl: async () => response });
    assert.equal(result.source, 'local'); validateChallenge(result.challenge);
  }
});
test('timeout and network failure produce playable fallback', async () => {
  const result = await generateChallenge('轻松', { apiKey: 'test-only', timeoutMs: 5, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout did not fire')), 500);
    signal.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  }) });
  assert.equal(result.source, 'local');
  assert.equal((await generateChallenge('轻松', { apiKey: 'test-only', fetchImpl: async () => { throw Error('network'); } })).source, 'local');
});

const responseCapture = () => ({ status: null, value: null,
  writeHead(status, headers) { this.status = status; this.headers = headers; },
  end(body) { this.value = JSON.parse(body); },
});
async function requestTo(handle, { path = '/api/challenge', method = 'POST', headers = {}, body = JSON.stringify({ prompt: '新手' }) } = {}) {
  const request = Readable.from([Buffer.from(body)]);
  request.headers = { host: '127.0.0.1:4317', origin: 'http://127.0.0.1:4317', 'content-type': 'application/json', ...headers }; request.method = method;
  const response = responseCapture(); const handled = await handle(request, response, path);
  return { ...response, handled };
}
test('API accepts valid local POST and exposes safe configuration metadata on status', async () => {
  const handle = createChallengeApi({ provider: 'deepseek', model: 'deepseek-flash', apiKey: '' });
  const response = await requestTo(handle);
  assert.equal(response.status, 200); assert.equal(response.value.source, 'local');
  assert.equal(response.headers['Cache-Control'], 'no-store');
  const status = await requestTo(handle, { path: '/api/challenge/status', method: 'GET' });
  assert.equal(status.value.available, false); assert.equal(status.value.mode, 'local');
  assert.equal(status.value.provider, 'deepseek'); assert.match(status.value.notice, /DEEPSEEK_API_KEY/);
  assert.ok(!Object.hasOwn(status.value, 'apiKey'));
  assert.equal((await requestTo(handle, { path: '/styles.css' })).handled, false);
});
test('API rejects cross-site origins, wrong host/method/media and malformed payloads', async () => {
  const handle = createChallengeApi({ apiKey: '' });
  for (const [options, code] of [
    [{ headers: { origin: 'https://evil.example' } }, 403],
    [{ headers: { host: 'evil.example' } }, 403],
    [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403],
    [{ method: 'GET' }, 405], [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ body: 'not json' }, 400], [{ body: 'null' }, 400], [{ body: JSON.stringify({ prompt: '' }) }, 400],
    [{ body: JSON.stringify({ prompt: 'x'.repeat(201) }) }, 400],
    [{ body: 'x'.repeat(4097) }, 413], [{ path: '/api/unknown' }, 404],
  ]) assert.equal((await requestTo(handle, options)).status, code);
});
test('API limits a minute to five generations', async () => {
  const handle = createChallengeApi({ apiKey: '' });
  for (let i = 0; i < 5; i++) assert.equal((await requestTo(handle)).status, 200);
  assert.equal((await requestTo(handle)).status, 429);
});
test('API reserves its concurrency slot before a slow request body arrives', async () => {
  const handle = createChallengeApi({ apiKey: '' });
  const first = new PassThrough(); first.method = 'POST'; first.headers = { host: 'localhost:4317', 'content-type': 'application/json' };
  const captured = responseCapture(); const pending = handle(first, captured, '/api/challenge');
  assert.equal((await requestTo(handle)).status, 429);
  first.end(JSON.stringify({ prompt: '轻松' })); await pending;
  assert.equal(captured.status, 200); assert.equal((await requestTo(handle)).status, 200);
});
