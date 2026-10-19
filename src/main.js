import { GameModel, CONFIG, clamp } from './core.js';
import { Soundscape } from './audio.js';
import { Renderer } from './renderer.js';
import { ChallengePanel } from './challenge-panel.js';

const TEST_MODE = new URLSearchParams(location.search).get('test') === '1';
const DEFAULT_SEED = 0x71de11;
const $ = id => document.getElementById(id);
const canvas = $('game-canvas'), app = $('app');
const sound = new Soundscape();
const renderer = new Renderer(canvas, () => { $('asset-error').hidden = false; });
const model = new GameModel({ seed: DEFAULT_SEED });
const keys = new Set();
const pointer = { active: false, id: null, x: 0, y: 0 };
const injectedInput = { active: false, x: 0, y: 0 };
let state = model.getSnapshot(), previousPhase = '';
let testSeed = DEFAULT_SEED, testAutoRun = false;
let lastFrame = performance.now(), frameMs = 16.67, renderedFrames = 0;
let toastTimer, lastAnnouncedSecond = 76, runBest = 0;
const textCache = new Map();
const challenges = new ChallengePanel(challenge => {
  if (model.phase === 'title') { model.challenge = challenge; refresh(); }
});

function text(id, value) {
  value = String(value);
  if (textCache.get(id) === value) return;
  textCache.set(id, value);
  if ($(id)) $(id).textContent = value;
}

function bestScore() {
  try {
    const value = Number(localStorage.getItem('tidelight.bestScore'));
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch { return 0; }
}
function saveScore(value) {
  try { localStorage.setItem('tidelight.bestScore', String(Math.max(bestScore(), value))); }
  catch { /* Storage is optional, including in private browsing. */ }
}
function announce(message) { text('status-announcer', message); }
function toast(message) {
  clearTimeout(toastTimer); text('toast', message);
  $('toast').classList.add('is-visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('is-visible'), 1200);
}
function resetInput() {
  keys.clear();
  if (pointer.id !== null && canvas.hasPointerCapture(pointer.id)) canvas.releasePointerCapture(pointer.id);
  pointer.active = false; pointer.id = null; injectedInput.active = false;
}

function syncScreens() {
  if (state.phase === previousPhase) return;
  const from = previousPhase;
  previousPhase = state.phase;
  app.dataset.phase = state.phase;
  for (const [id, phase] of [['title-screen', 'title'], ['pause-screen', 'paused'], ['gameover-screen', 'gameover']]) {
    const active = state.phase === phase;
    $(id).hidden = !active; $(id).inert = !active;
    $(id).classList.toggle('is-visible', active);
  }
  $('pause-button').hidden = !['playing', 'paused'].includes(state.phase);
  $('pause-button').disabled = state.phase !== 'playing';
  canvas.tabIndex = state.phase === 'playing' ? 0 : -1;
  if (state.phase === 'playing') {
    canvas.focus({ preventScroll: true });
    announce(from === 'paused' ? '继续航行。' : '启航！收集萤火，避开影涡，在 75 秒内追逐高分。');
  } else if (state.phase === 'paused') {
    resetInput(); announce('游戏已暂停，时间已冻结。');
    $('resume-button').focus({ preventScroll: true });
  } else if (state.phase === 'gameover') {
    resetInput();
    if (!TEST_MODE) saveScore(state.score);
    text('final-score', state.score.toLocaleString('zh-CN'));
    text('final-combo', `${state.bestCombo} 连击`);
    text('final-collected', state.collected);
    text('final-survival', state.endReason === 'time' ? '平安归岸 · 75 秒' : `${state.elapsed.toFixed(1)} 秒 · 灯火熄灭`);
    text('best-score', Math.max(runBest, TEST_MODE ? 0 : state.score).toLocaleString('zh-CN'));
    text('gameover-kicker', state.endReason === 'time' ? 'DAWN FOUND YOU' : 'YOUR LIGHT WENT OUT');
    text('result-message', state.score > runBest && !TEST_MODE ? '新的夜航纪录。月色会记得这道航迹。' : '每一点微光，都让湿地亮了一些。');
    text('result-challenge', `${state.challenge.title} · 种子 ${state.seed} · 同种子、同操作可复现本局`);
    announce(`游戏结束。得分 ${state.score}，收集 ${state.collected} 点萤火，最高 ${state.bestCombo} 连击。`);
    $('restart-button').focus({ preventScroll: true }); sound.finish();
  } else if (state.phase === 'title' && from) {
    text('title-best-score', bestScore().toLocaleString('zh-CN'));
    $('start-button').focus({ preventScroll: true });
  }
}

function updateHud() {
  text('tide-label', state.director.label);
  text('score-value', String(state.score).padStart(6, '0'));
  text('combo-value', `×${state.multiplier}`); text('combo-count', state.combo);
  const seconds = Math.max(0, Math.ceil(state.timeLeft));
  text('time-value', `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);
  text('lives-value', Array.from({ length: CONFIG.initialLives }, (_, i) => i < state.lives ? '●' : '○').join(' '));
  $('lives-value').setAttribute('aria-label', `${state.lives} 点生命`);
  $('combo-meter').style.transform = `scaleX(${clamp(state.comboTimer / CONFIG.comboWindow, 0, 1)})`;
  $('combo-stat').classList.toggle('is-hot', state.multiplier >= 3);
  const cooldown = state.player.dashCooldown, ready = cooldown <= 0 && state.phase === 'playing';
  $('dash-meter').style.transform = `scaleX(${clamp(1 - cooldown / CONFIG.dashCooldown, 0, 1)})`;
  $('dash-button').disabled = !ready;
  const status = cooldown > 0 ? `${cooldown.toFixed(1)}s` : '就绪';
  text('dash-status', status);
  $('dash-button').setAttribute('aria-label', ready ? '流光冲刺，已就绪' : `流光冲刺，冷却 ${status}`);
  if (state.phase === 'playing' && seconds <= 10 && seconds !== lastAnnouncedSecond) {
    if ([10, 5].includes(seconds)) announce(`还剩 ${seconds} 秒。`);
    lastAnnouncedSecond = seconds;
  }
}

function processEvents() {
  for (const event of model.consumeEvents()) {
    renderer.event(event);
    if (event.type === 'collect') {
      sound.collect(event.combo, event.kind === 'gold');
      if (event.kind === 'gold') toast(`金色萤火 +${event.points}`);
      else if (event.combo > 1 && (event.combo - 1) % CONFIG.comboStep === 0) toast(`${event.combo} 连击 · ×${state.multiplier} 得分`);
    } else if (event.type === 'damage') {
      sound.hit(); toast('影涡袭来 · 灯火 −1'); announce(`受到影涡冲击，还剩 ${event.lives} 点灯火。`);
    } else if (event.type === 'dash') sound.dash();
    else if (event.type === 'ambush-warning') sound.warning();
    else if (event.type === 'tide-warning' || event.type === 'tide-start') { toast(event.label); announce(event.label); sound.tide(event.kind); }
  }
}
function refresh() {
  state = model.getSnapshot(); processEvents(); syncScreens(); updateHud(); renderer.render(state, pointer);
}
function beginRun() {
  if (challenges.busy) return getState();
  resetInput(); clearTimeout(toastTimer); $('toast').classList.remove('is-visible');
  runBest = bestScore();
  model.restart(TEST_MODE ? testSeed : challenges.challenge.seed, challenges.challenge);
  renderer.reset(); lastAnnouncedSecond = 76; lastFrame = performance.now();
  refresh(); void sound.unlock().then(() => sound.start());
  return getState();
}
function pause() { if (model.pause()) { resetInput(); refresh(); } return getState(); }
function resume() { if (model.resume()) { resetInput(); lastFrame = performance.now(); refresh(); } return getState(); }
function returnToTitle() { resetInput(); model.returnToTitle(); renderer.reset(); refresh(); }
function togglePause() { return model.phase === 'paused' ? resume() : pause(); }
function setMuted(value) {
  sound.setMuted(value);
  $('mute-button').classList.toggle('is-muted', sound.muted);
  $('mute-button').setAttribute('aria-label', sound.muted ? '取消静音' : '静音');
  $('mute-button').setAttribute('aria-pressed', String(sound.muted));
  $('mute-button').title = `${sound.muted ? '取消静音' : '静音'} (M)`;
  return sound.muted;
}
function tryDash() { const queued = model.queueDash(); if (queued) void sound.unlock(); return queued; }

function currentInput() {
  if (injectedInput.active) return { x: injectedInput.x, y: injectedInput.y };
  let x = Number(keys.has('ArrowRight') || keys.has('KeyD')) - Number(keys.has('ArrowLeft') || keys.has('KeyA'));
  let y = Number(keys.has('ArrowDown') || keys.has('KeyS')) - Number(keys.has('ArrowUp') || keys.has('KeyW'));
  if (!x && !y && pointer.active) {
    const dx = pointer.x - state.player.x, dy = pointer.y - state.player.y;
    if (Math.hypot(dx, dy) > 18) { x = dx; y = dy; }
  }
  const length = Math.max(1, Math.hypot(x, y));
  return { x: x / length, y: y / length };
}
function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width * CONFIG.width, 0, CONFIG.width),
    y: clamp((event.clientY - rect.top) / rect.height * CONFIG.height, 0, CONFIG.height) };
}
canvas.addEventListener('pointerdown', event => {
  if (state.phase !== 'playing' || pointer.active || event.button !== 0) return;
  event.preventDefault(); canvas.focus({ preventScroll: true });
  Object.assign(pointer, pointFromEvent(event), { active: true, id: event.pointerId });
  canvas.setPointerCapture(event.pointerId); void sound.unlock();
});
canvas.addEventListener('pointermove', event => {
  if (pointer.active && event.pointerId === pointer.id) Object.assign(pointer, pointFromEvent(event));
});
function endPointer(event) {
  if (event.pointerId !== pointer.id) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  pointer.active = false; pointer.id = null;
}
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, endPointer);

const movementKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];
window.addEventListener('keydown', event => {
  if (event.ctrlKey || event.altKey || event.metaKey || event.target.matches('input, textarea, select, [contenteditable="true"]')) return;
  // Enter/Space retain native activation for buttons and the challenge library.
  if (event.target.closest('button, summary') && ['Space', 'Enter'].includes(event.code)) return;
  if (state.phase === 'playing' && (movementKeys.includes(event.code) || event.code === 'Space')) event.preventDefault();
  if (movementKeys.includes(event.code) && state.phase === 'playing') keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'Space' && state.phase === 'playing') tryDash();
  if (event.code === 'KeyP' || event.code === 'Escape') togglePause();
  if (event.code === 'KeyM') { setMuted(!sound.muted); if (!sound.muted) void sound.unlock(); }
  if (event.code === 'Enter' && ['title', 'gameover'].includes(state.phase)) beginRun();
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { resetInput(); pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { resetInput(); pause(); } });
for (const id of ['start-button', 'start-challenge-button', 'restart-button', 'pause-restart-button']) $(id).addEventListener('click', beginRun);
$('pause-button').addEventListener('click', pause);
$('resume-button').addEventListener('click', resume);
for (const id of ['pause-title-button', 'result-title-button']) $(id).addEventListener('click', returnToTitle);
$('mute-button').addEventListener('click', () => { setMuted(!sound.muted); if (!sound.muted) void sound.unlock(); });
$('dash-button').addEventListener('click', tryDash);
function resize() { renderer.resize(); model.resize(renderer.viewport.width, renderer.viewport.height); refresh(); }
new ResizeObserver(resize).observe(canvas);
window.addEventListener('resize', resize, { passive: true });

function getState() {
  return { ...model.getSnapshot(), muted: sound.muted, testMode: TEST_MODE,
    pointer: { ...pointer }, input: { ...currentInput() } };
}
function getMetrics() {
  return { phase: model.phase, fps: Math.round(1000 / frameMs), renderedFrames,
    canvas: { ...renderer.viewport, pixelWidth: canvas.width, pixelHeight: canvas.height },
    entities: { sparks: model.sparks.length, hazards: model.hazards.length,
      particles: renderer.particles.length, wake: renderer.wake.length, labels: renderer.labels.length },
    assets: { ...renderer.assets }, reducedMotion: renderer.reducedMotion, audioAvailable: sound.available,
    testMode: TEST_MODE, autoRunning: !TEST_MODE || testAutoRun };
}
const api = { version: '1.2.0', getState, getMetrics, start: beginRun, restart: beginRun, pause, resume, setMuted };
if (TEST_MODE) Object.assign(api, {
  setSeed(seed) { testSeed = Number.isFinite(seed) ? seed >>> 0 : DEFAULT_SEED; return testSeed; },
  setChallenge(challenge) { challenges.select(challenge); testSeed = challenges.challenge.seed; return challenges.challenge; },
  setInput(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new TypeError('Input must be finite.');
    const length = Math.max(1, Math.hypot(x, y));
    Object.assign(injectedInput, { active: true, x: x / length, y: y / length });
  },
  clearInput() { injectedInput.active = false; }, dash: tryDash,
  setAutoRun(value) { testAutoRun = Boolean(value); lastFrame = performance.now(); },
  step(milliseconds = 1000 / 60) {
    if (testAutoRun) throw new Error('Disable autorun before deterministic stepping.');
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 120000) throw new RangeError('step expects 0–120000 ms.');
    let remaining = milliseconds / 1000;
    while (remaining > 1e-9) {
      const dt = Math.min(1 / 60, remaining);
      model.update(dt, currentInput()); state = model.getSnapshot();
      processEvents(); renderer.update(dt, state); remaining -= dt;
    }
    refresh(); return getState();
  },
  // Fixtures are restricted to test mode; control tests also exercise ordinary gameplay.
  loadScenario(name) {
    if (!['collection', 'damage', 'last-life', 'survival', 'empty'].includes(name)) throw new Error('Unknown test scenario.');
    beginRun(); model.sparks = []; model.hazards = [];
    model._sparkSpawnTimer = Infinity; model._hazardSpawnTimer = Infinity;
    model.director.enabled = false;
    if (name === 'collection') model.sparks.push({ id: 'fixture-spark', x: model.player.x + 90, y: model.player.y, radius: 13, kind: 'blue', value: 100, pulse: 0 });
    if (name === 'damage' || name === 'last-life') {
      if (name === 'last-life') model.lives = 1;
      model.hazards.push({ id: 'fixture-hazard', x: model.player.x + 90, y: model.player.y, radius: 30, speed: 0, vx: 0, vy: 0, turn: 1 });
    }
    refresh(); return getState();
  },
});
window.__TIDELIGHT__ = Object.freeze(api);

function tick(now) {
  const elapsed = Math.max(0, (now - lastFrame) / 1000); lastFrame = now;
  if (elapsed > 0 && elapsed < 0.25) frameMs = frameMs * 0.95 + elapsed * 1000 * 0.05;
  const dt = Math.min(CONFIG.frameDeltaCap, elapsed);
  if (!TEST_MODE || testAutoRun) {
    model.update(dt, currentInput()); state = model.getSnapshot();
    processEvents(); renderer.update(dt, state);
  }
  syncScreens(); updateHud(); renderer.render(state, pointer);
  renderedFrames++; requestAnimationFrame(tick);
}
text('title-best-score', bestScore().toLocaleString('zh-CN'));
setMuted(false); refresh();
window.dispatchEvent(new CustomEvent('tidelight:ready', { detail: { version: api.version, testMode: TEST_MODE } }));
requestAnimationFrame(tick);
