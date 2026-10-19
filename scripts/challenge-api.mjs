import { localChallenge, validateChallenge } from '../src/challenge.js';
import { PROVIDERS, readProviderConfig, providerStatus, buildProviderRequest, parseProviderOutput } from './ai-provider.mjs';

const safeJson = (response, status, value) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(value));
};

export async function generateChallenge(prompt, { provider = 'deepseek', apiKey, model, fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const fallback = (notice, reason = 'upstream') => ({ challenge: localChallenge(prompt), source: 'local', reason, notice });
  const status = providerStatus({ provider, apiKey, model });
  if (!status.available) return fallback(status.notice, status.reason);
  const label = PROVIDERS[provider].label;
  const { endpoint, body } = buildProviderRequest(prompt, provider, status.model);
  let response, data;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey.trim()}` },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const [reason, message] = ({
        400: ['configuration', '请求参数或模型能力不兼容，请检查模型是否支持当前 JSON 输出模式'],
        401: ['authentication', '认证未通过，请检查对应平台的 API Key'],
        402: ['quota', '额度不足，请检查平台账户状态'],
        403: ['authentication', '没有模型权限，请检查 API Key 与模型开通状态'],
        404: ['configuration', '模型或接入点不存在，请检查模型 ID'],
        429: ['rate_limit', '触发平台限流或配额限制，请稍后重试'],
      })[response.status] || ['upstream', '暂时不可用'];
      return fallback(`${label} ${message}；已切换为本地关键词生成。`, reason);
    }
    data = await response.json();
  } catch (error) {
    const timeout = ['TimeoutError', 'AbortError'].includes(error?.name);
    return fallback(`${label} ${timeout ? '请求超时' : '连接失败或响应无效'}；已切换为本地关键词生成。`, timeout ? 'timeout' : 'network');
  }
  try {
    const output = parseProviderOutput(data, provider);
    if (output.reason) return fallback(`${label} ${output.reason === 'refusal' ? '未接受此次请求' : '未完整生成结果'}；已使用本地关键词生成。`, output.reason);
    if (typeof output.text !== 'string' || !output.text.trim()) throw new Error('Empty output');
    const challenge = validateChallenge(JSON.parse(output.text));
    return { challenge, source: provider, model: status.model, notice: `${label} 生成完成；参数已通过游戏规则检查。` };
  } catch {
    return fallback(`${label} 返回的挑战格式无效；已切换为本地关键词生成。`, 'invalid_output');
  }
}

/** Localhost-only, same-origin endpoint with bounded cost and payload. */
export function createChallengeApi(options = {}) {
  const env = options.provider === undefined ? process.env : { ...process.env, AI_PROVIDER: options.provider };
  const { provider, apiKey, model, fetchImpl, timeoutMs } = { ...readProviderConfig(env), ...options };
  const status = providerStatus({ provider, apiKey, model });
  let active = false, requests = [];
  return async function handle(request, response, pathname) {
    if (!pathname.startsWith('/api/')) return false;
    const authority = request.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(authority)) { safeJson(response, 403, { error: '不允许此来源' }); return true; }
    const origin = request.headers.origin;
    if ((origin && origin !== `http://${authority}`) || request.headers['sec-fetch-site'] === 'cross-site') {
      safeJson(response, 403, { error: '请从本地游戏页面生成挑战' }); return true;
    }
    if (pathname === '/api/challenge/status' && request.method === 'GET') {
      safeJson(response, 200, status); return true;
    }
    if (pathname !== '/api/challenge') { safeJson(response, 404, { error: '接口不存在' }); return true; }
    if (request.method !== 'POST') { safeJson(response, 405, { error: '需要 POST 请求' }); return true; }
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) { safeJson(response, 415, { error: '需要 JSON 请求' }); return true; }
    requests = requests.filter(at => Date.now() - at < 60000);
    if (active || requests.length >= 5) { safeJson(response, 429, { error: '请稍后再生成，每分钟最多五次。' }); return true; }
    let size = 0, chunks = [];
    active = true; // Reserve the slot before awaiting the request body.
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 4096) { safeJson(response, 413, { error: '描述过长' }); return true; }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 200) throw new Error('invalid');
      requests.push(Date.now());
      const result = await generateChallenge(body.prompt.trim(), { provider, apiKey, model, fetchImpl, timeoutMs });
      safeJson(response, 200, result);
    } catch { safeJson(response, 400, { error: '请用 1–200 字描述挑战' }); }
    finally { active = false; }
    return true;
  };
}
