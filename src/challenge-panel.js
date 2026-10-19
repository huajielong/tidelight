import { DEFAULT_CHALLENGE, validateChallenge, localChallenge, encodeChallenge, decodeChallenge,
  DIFFICULTY_NAMES, THEME_NAMES, ROUTE_NAMES, KIND_NAMES, EVENT_NAMES } from './challenge.js';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'tidelight.challenges.v1';

export class ChallengePanel {
  constructor(onSelect) {
    this.onSelect = onSelect;
    this.challenge = validateChallenge(DEFAULT_CHALLENGE);
    this.source = 'preset'; this.busy = false; this.saved = []; this.hasUserNotice = false;
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (Array.isArray(data)) this.saved = data.slice(0, 8).flatMap(code => {
        try { return [encodeChallenge(decodeChallenge(code))]; } catch { return []; }
      });
    } catch { /* Storage is optional; malformed data never prevents playing. */ }
    this.render(); this.renderSaved();
    for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => {
      $('challenge-prompt').value = button.dataset.prompt; $('challenge-prompt').focus();
    });
    $('generate-challenge').addEventListener('click', () => void this.generate());
    $('reroll-seed').addEventListener('click', () => {
      const values = new Uint32Array(1); crypto.getRandomValues(values);
      this.select({ ...this.challenge, seed: values[0] || 1 }, this.source);
      this.notice('种子已更新；挑战规则不变。');
    });
    $('save-challenge').addEventListener('click', () => {
      const code = encodeChallenge(this.challenge);
      const saved = [code, ...this.saved.filter(item => item !== code)].slice(0, 8);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); this.saved = saved;
        this.renderSaved(); this.notice('已收藏在本机浏览器。');
      } catch { this.notice('浏览器不允许保存，请复制挑战码留存。'); }
    });
    $('load-challenge').addEventListener('click', () => this.import($('saved-challenges').value, 'saved'));
    $('import-challenge').addEventListener('click', () => this.import($('challenge-code').value, 'imported'));
    $('export-challenge').addEventListener('click', async () => {
      const code = encodeChallenge(this.challenge); $('challenge-code').value = code;
      try { await navigator.clipboard.writeText(code); this.notice('挑战码已复制，也显示在下方输入框。'); }
      catch { $('challenge-code').focus(); $('challenge-code').select(); this.notice('挑战码已选中，请手动复制。'); }
    });
    void this.checkService();
  }
  notice(message) { this.hasUserNotice = true; $('challenge-notice').textContent = message; }
  select(challenge, source = 'imported') {
    this.challenge = validateChallenge(challenge); this.source = source;
    this.render(); this.onSelect?.(this.challenge);
  }
  import(code, source) {
    try { this.select(decodeChallenge(code), source); this.notice('挑战已载入，点击「启航」开始。'); }
    catch (error) { this.notice(error.message); }
  }
  render() {
    const c = this.challenge;
    $('challenge-title').textContent = c.title;
    $('challenge-description').textContent = c.description;
    $('challenge-meta').textContent = `${DIFFICULTY_NAMES[c.difficulty]} · ${THEME_NAMES[c.theme]}水面 · ${ROUTE_NAMES[c.route]}`;
    $('challenge-enemies').textContent = '影涡：' + c.enemies.map(kind => KIND_NAMES[kind]).join(' / ');
    $('challenge-source').textContent = { preset: '预设', local: '本地关键词', openai: 'OpenAI', deepseek: 'DeepSeek', seed: 'Seed', saved: '本机收藏', imported: '挑战码' }[this.source];
    $('challenge-seed').textContent = c.seed;
    $('challenge-events').replaceChildren(...c.events.map((event, index) => {
      const item = document.createElement('li'), time = document.createElement('span'), label = document.createElement('strong');
      time.textContent = [12, 26, 42, 60][index] + 's'; label.textContent = EVENT_NAMES[event];
      item.append(time, label); return item;
    }));
    $('app').dataset.theme = c.theme;
  }
  renderSaved() {
    const options = this.saved.map(code => {
      const c = decodeChallenge(code), option = document.createElement('option');
      option.value = code; option.textContent = `${c.title} · ${c.seed}`; return option;
    });
    if (!options.length) { const option = document.createElement('option'); option.textContent = '尚未收藏'; option.value = ''; options.push(option); }
    $('saved-challenges').replaceChildren(...options); $('load-challenge').disabled = !this.saved.length;
  }
  async checkService() {
    try {
      const response = await fetch('/api/challenge/status', { signal: AbortSignal.timeout(3000) });
      const data = response.ok ? await response.json() : {};
      const label = { deepseek: 'DeepSeek', seed: 'Seed', openai: 'OpenAI' }[data.provider];
      $('ai-status').textContent = label ? `${label} · ${data.available ? '已配置' : '未配置'}` : '本地模式';
      $('ai-status').title = data.notice || '当前使用本地规则，无需密钥。';
      if (!this.hasUserNotice && data.notice) $('challenge-notice').textContent = data.notice;
    } catch { $('ai-status').textContent = '本地模式'; }
  }
  async generate() {
    if (this.busy) return;
    const prompt = $('challenge-prompt').value.trim();
    if (!prompt || prompt.length > 200) { this.notice('请用 1–200 字描述挑战。'); $('challenge-prompt').focus(); return; }
    this.busy = true;
    const controls = [...document.querySelectorAll('.challenge-panel button'), $('start-button')];
    const disabledBefore = controls.map(button => button.disabled);
    controls.forEach(button => { button.disabled = true; });
    $('generate-challenge').textContent = '正在编织潮汐…'; this.notice('正在生成预览，最多等待约 20 秒…');
    try {
      let result;
      try {
        const response = await fetch('/api/challenge', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(23000) });
        if (response.status === 429) { this.notice('生成太频繁，请稍后再试；当前挑战仍可游玩。'); return; }
        if (!response.ok) throw new Error('Service unavailable');
        result = await response.json(); result.challenge = validateChallenge(result.challenge);
        if (!['openai', 'deepseek', 'seed', 'local'].includes(result.source)) throw new Error('Invalid source');
      } catch {
        result = { challenge: localChallenge(prompt), source: 'local', notice: '服务未连接，已使用本地关键词生成（不是大模型）。' };
      }
      this.select(result.challenge, result.source);
      this.notice(result.notice || '挑战预览已就绪。');
    } finally {
      this.busy = false; controls.forEach((button, index) => { button.disabled = disabledBefore[index]; });
      $('generate-challenge').textContent = '生成挑战预览 ✧';
    }
  }
}
