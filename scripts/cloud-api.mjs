import { localChallenge } from '../src/challenge.js';
import { readProviderConfig, providerStatus } from './ai-provider.mjs';
import { generateChallenge } from './challenge-api.mjs';
import { quotaLimits, reserveGeneration } from './cloud-quota.mjs';

const json = (data, status = 200, headers = {}) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});

export function runtimeEnvironment() {
  const names = ['AI_PROVIDER', 'DEEPSEEK_API_KEY', 'DEEPSEEK_MODEL', 'ARK_API_KEY',
    'ARK_MODEL', 'OPENAI_API_KEY', 'OPENAI_MODEL', 'AI_DAILY_LIMIT', 'AI_MONTHLY_LIMIT'];
  return Object.fromEntries(names.map(name => [name, globalThis.Netlify?.env.get(name)]));
}

async function readPrompt(request) {
  if (Number(request.headers.get('content-length')) > 4096) throw new RangeError();
  if (!request.body) throw new Error();
  const reader = request.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new RangeError(); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (typeof body?.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 200) throw new Error();
  return body.prompt.trim();
}

export function createCloudHandler({ env = runtimeEnvironment, reserve = reserveGeneration, generate = generateChallenge } = {}) {
  return async (request, context = {}) => {
    const url = new URL(request.url);
    const origin = request.headers.get('origin');
    if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return json({ error: '请从本站游戏页面生成挑战' }, 403);
    }
    const configuration = env();
    const provider = readProviderConfig(configuration);
    const status = providerStatus(provider);
    // Previews have independent DB branches; they must never spend production
    // credentials or bypass the production quota. Local development uses serve.mjs.
    const production = context.deploy?.context === 'production';
    if (url.pathname === '/api/challenge/status') {
      if (request.method !== 'GET') return json({ error: '需要 GET 请求' }, 405, { Allow: 'GET' });
      return json(production ? { ...status, notice: `${status.notice} 全站每天最多 100 次、每月 1,000 次；额度不足时使用本地规则。` }
        : { ...status, available: false, mode: 'local', reason: 'preview', notice: '预览环境仅使用本地关键词；正式站点才允许模型调用。' });
    }
    if (url.pathname !== '/api/challenge') return json({ error: '接口不存在' }, 404);
    if (request.method !== 'POST') return json({ error: '需要 POST 请求' }, 405, { Allow: 'POST' });
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) return json({ error: '需要 JSON 请求' }, 415);
    let prompt;
    try { prompt = await readPrompt(request); }
    catch (error) { return json({ error: '请用 1–200 字描述挑战（请求不超过 4 KB）' }, error instanceof RangeError ? 413 : 400); }
    const fallback = (reason, notice) => json({ challenge: localChallenge(prompt), source: 'local', reason, notice });
    if (!production) return fallback('preview', '预览环境使用本地关键词，不消耗模型额度。');
    if (!status.available) return fallback(status.reason, status.notice);
    try {
      if (!await reserve({ limits: quotaLimits(configuration) })) return fallback('site_quota', '本站今日或本月生成额度已用完；已使用本地关键词，仍可正常游玩。');
    } catch {
      // Fail closed: no database = no paid provider request. Do not return or
      // log the exception: connection strings can be embedded in DB errors.
      return fallback('quota_unavailable', '额度服务暂不可用；已使用本地关键词，不调用模型。');
    }
    try { return json(await generate(prompt, provider)); }
    catch { return fallback('upstream', '模型服务暂不可用；已使用本地关键词。'); }
  };
}
