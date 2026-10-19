/** Shared, bounded level contract. Model output is data, never executable code. */
export const KINDS = ['chaser', 'ambusher', 'guardian'];
export const KIND_NAMES = { chaser: '追光者', ambusher: '伏潮者', guardian: '守灯者' };
export const EVENT_NAMES = { calm: '静水喘息', trail: '金色航路', hunt: '伏潮试炼', finale: '归潮聚光' };
export const DIFFICULTY_NAMES = { gentle: '轻柔', balanced: '标准', fierce: '紧张' };
export const THEME_NAMES = { moon: '月白', aurora: '极光', ember: '暖灯' };
export const ROUTE_NAMES = { scatter: '散落', arc: '弧形航路', spiral: '环形航路' };
export const CHALLENGE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['version', 'title', 'description', 'seed', 'difficulty', 'theme', 'enemies', 'route', 'events'],
  properties: {
    version: { type: 'integer', enum: [1] },
    title: { type: 'string', minLength: 1, maxLength: 24 },
    description: { type: 'string', minLength: 1, maxLength: 100 },
    seed: { type: 'integer', minimum: 1, maximum: 4294967295 },
    difficulty: { type: 'string', enum: ['gentle', 'balanced', 'fierce'] },
    theme: { type: 'string', enum: ['moon', 'aurora', 'ember'] },
    enemies: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: KINDS } },
    route: { type: 'string', enum: ['scatter', 'arc', 'spiral'] },
    events: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'string', enum: Object.keys(EVENT_NAMES) } },
  },
};
export function validateChallenge(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('挑战格式无效');
  const keys = CHALLENGE_SCHEMA.required;
  if (Object.keys(value).length !== keys.length || keys.some(key => !(key in value))) throw new Error('挑战字段不完整');
  if (value.version !== 1 || !Number.isInteger(value.seed) || value.seed < 1 || value.seed > 4294967295) throw new Error('挑战版本或种子无效');
  for (const [key, max] of [['title', 24], ['description', 100]]) {
    if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > max || /[\x00-\x1f]/.test(value[key])) throw new Error('挑战说明无效');
  }
  for (const key of ['difficulty', 'theme', 'route']) if (!CHALLENGE_SCHEMA.properties[key].enum.includes(value[key])) throw new Error('挑战参数超出范围');
  if (!Array.isArray(value.enemies) || value.enemies.length < 1 || value.enemies.length > 3 || new Set(value.enemies).size !== value.enemies.length || value.enemies.some(kind => !KINDS.includes(kind))) throw new Error('影涡组合无效');
  if (!Array.isArray(value.events) || value.events.length !== 4 || value.events.some(event => !Object.hasOwn(EVENT_NAMES, event))) throw new Error('潮汐安排无效');
  return Object.fromEntries(keys.map(key => [key, Array.isArray(value[key]) ? [...value[key]] : value[key]]));
}
export function hashPrompt(text) {
  let hash = 2166136261;
  for (const char of text) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) || 1;
}
export const DEFAULT_CHALLENGE = Object.freeze({
  version: 1, title: '月下初航', description: '读懂三种影涡，沿金色航路寻找微光，最后迎接归潮。',
  seed: 7462417, difficulty: 'balanced', theme: 'moon',
  enemies: Object.freeze([...KINDS]), route: 'arc', events: Object.freeze(['trail', 'hunt', 'trail', 'finale']),
});
/** Explicit keyword fallback; intentionally never claims to be an LLM. */
export function localChallenge(prompt, seed = hashPrompt(prompt)) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 200) throw new Error('请用 1–200 字描述挑战');
  const clean = prompt.toLowerCase();
  const gentle = /新手|轻松|练习|简单|温柔|轻柔|easy|beginner|relax/.test(clean);
  const fierce = !gentle && /困难|刺激|紧张|极限|hard|fierce|intense/.test(clean);
  const enemies = KINDS.filter((kind, index) => ![
    /不要追光|没有追光|no chaser/, /不要伏潮|没有伏潮|no ambusher/, /不要守灯|没有守灯|no guardian/,
  ][index].test(clean));
  const pursuitOnly = /全程追逐|只要追光|只有追光|chase only/.test(clean);
  const gold = /金色|黄金|gold/.test(clean);
  return validateChallenge({
    version: 1, title: gentle ? '静水起航' : gold ? '金色诱惑' : pursuitOnly ? '逐光之夜' : fierce ? '风起伏潮' : '月下漫航',
    description: `${gentle ? '舒缓起步' : fierce ? '紧张节奏' : '均衡节奏'}，${gold ? '更多金色航路' : '交替安排航路和试炼'}；第 60 秒迎接归潮。`,
    seed, difficulty: gentle ? 'gentle' : fierce ? 'fierce' : 'balanced',
    theme: /极光|aurora/.test(clean) ? 'aurora' : /暖|橙|火|ember|warm/.test(clean) ? 'ember' : 'moon',
    enemies: pursuitOnly ? ['chaser'] : enemies.length ? enemies : ['chaser'],
    route: /环|螺旋|spiral|circle/.test(clean) ? 'spiral' : /散|scatter/.test(clean) ? 'scatter' : 'arc',
    events: gentle ? ['calm', 'trail', gold ? 'trail' : 'calm', 'finale'] : gold ? ['trail', 'trail', 'hunt', 'finale'] : ['trail', 'hunt', 'trail', 'finale'],
  });
}
export function encodeChallenge(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(validateChallenge(value)));
  return 'TL1.' + btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export function decodeChallenge(code) {
  if (typeof code !== 'string' || code.length > 3000 || !/^TL1\.[\w-]+$/.test(code.trim())) throw new Error('请粘贴完整的 TL1 挑战码');
  try {
    const base64 = code.trim().slice(4).replaceAll('-', '+').replaceAll('_', '/');
    return validateChallenge(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(base64), c => c.charCodeAt(0)))));
  } catch { throw new Error('挑战码损坏或版本不受支持'); }
}
