import { CONFIG } from './config.js';
import { EVENT_NAMES } from './challenge.js';

const EVENT_AT = [12, 26, 42, 60];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const cap = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function createDirector() {
  return { enabled: true, stage: 'opening', label: '初航 · 观察水面', nextIndex: 0, pending: null,
    active: null, lastDamageAt: -99, reliefUntil: 0, lastReliefAt: -99, history: [],
    metrics: { distance: 0, stillSeconds: 0, collected: 0, hits: 0 }, lastX: 800, lastY: 450 };
}

function routePoints(game, type) {
  const { player, challenge } = game;
  // Anchor the route in the player's quieter half; leave the opposite half open.
  const x = cap(player.x < 800 ? player.x + 230 : player.x - 230, 280, 1320);
  const y = cap(player.y, 230, 670);
  const center = type === 'finale' ? { x: 800, y: 450 } : { x, y };
  return Array.from({ length: 5 }, (_, index) => {
    let px, py;
    if (challenge.route === 'spiral' || type === 'finale') {
      const angle = index / 5 * Math.PI * 2;
      px = center.x + Math.cos(angle) * 180; py = center.y + Math.sin(angle) * 150;
    } else if (challenge.route === 'scatter') {
      px = center.x + (game.rng() - 0.5) * 460; py = center.y + (game.rng() - 0.5) * 340;
    } else {
      px = center.x + (index - 2) * 82; py = center.y + Math.sin(index / 4 * Math.PI) * 120 - 60;
    }
    return { x: cap(px, 80, 1520), y: cap(py, 80, 820), kind: index === 4 || type === 'finale' ? 'gold' : 'blue' };
  }).filter(point => distance(point, player) > player.radius + 40);
}

function warn(game, type, reason) {
  const director = game.director;
  director.pending = { type, reason, startsAt: game.elapsed + 1.8, points: routePoints(game, type) };
  director.label = `即将 ${EVENT_NAMES[type]} · 水纹预告`;
  game._emit('tide-warning', { label: director.label, kind: type });
}

function activate(game) {
  const d = game.director, pending = d.pending;
  const duration = pending.type === 'finale' ? 15 : pending.type === 'calm' ? 7 : 8;
  d.active = { ...pending, until: game.elapsed + duration };
  d.pending = null; d.stage = pending.type; d.label = EVENT_NAMES[pending.type];
  d.history.push({ type: pending.type, at: game.elapsed, reason: pending.reason });
  if (d.history.length > 12) d.history.shift();
  if (pending.type === 'calm') d.reliefUntil = Math.max(d.reliefUntil, game.elapsed + duration);
  // Previous route rewards become ordinary collectibles, so an uncollected
  // route cannot exhaust the spark budget and suppress the final gathering.
  for (const spark of game.sparks) spark.route = false;
  // Evict only ordinary sparks to make room for a route; stay within the budget.
  for (const point of pending.points) {
    if (game.hazards.some(h => distance(point, h) < h.radius + 65)) continue;
    if (game.sparks.length >= CONFIG.maxSparks) {
      const old = game.sparks.findIndex(s => !s.route);
      if (old < 0) break;
      game.sparks.splice(old, 1);
    }
    game.sparks.push({ ...point, id: `route-${game._nextId++}`, radius: point.kind === 'gold' ? CONFIG.goldRadius : CONFIG.sparkRadius,
      value: point.kind === 'gold' ? CONFIG.goldValue : CONFIG.sparkValue, pulse: game.rng() * Math.PI * 2, route: true });
  }
  if (pending.type === 'hunt' && game.challenge.enemies.includes('ambusher')) game._spawnHazard('ambusher');
  if (pending.type === 'trail' && game.challenge.enemies.includes('guardian') && !game.hazards.some(h => h.kind === 'guardian')) game._spawnHazard('guardian');
  game._emit('tide-start', { label: d.label, kind: pending.type });
}

export function tickDirector(game, dt) {
  const d = game.director;
  if (!d.enabled) return;
  const moved = Math.hypot(game.player.x - d.lastX, game.player.y - d.lastY);
  d.metrics.distance += moved; d.metrics.stillSeconds = moved < dt * 15 ? d.metrics.stillSeconds + dt : 0;
  d.lastX = game.player.x; d.lastY = game.player.y;
  if (d.active && game.elapsed >= d.active.until) { d.active = null; d.stage = 'flow'; d.label = '自由航行 · 寻找微光'; }
  if (d.pending && game.elapsed >= d.pending.startsAt) activate(game);
  if (d.pending) return;
  if (d.nextIndex < EVENT_AT.length && game.elapsed >= EVENT_AT[d.nextIndex]) {
    let type = game.challenge.events[d.nextIndex++];
    if (game.elapsed < 59 && (game.elapsed - d.lastDamageAt < 7 || game.lives === 1)) type = 'calm';
    else if (game.elapsed < 59 && (game.combo >= 4 || d.metrics.stillSeconds > 4) && type !== 'calm') type = 'trail';
    warn(game, type, type === 'calm' ? '灯火保护' : game.combo >= 4 ? '连击奖励路线' : '挑战安排');
  } else if (game.elapsed < 58 && game.elapsed - d.lastDamageAt < 0.1 && game.elapsed - d.lastReliefAt > 10) {
    d.lastReliefAt = game.elapsed; warn(game, 'calm', '受伤后喘息');
  }
}

export function moveHazard(game, hazard, dt, speedScale) {
  const clampPosition = () => {
    hazard.x = cap(hazard.x + (hazard.vx || 0) * dt, hazard.radius, CONFIG.width - hazard.radius);
    hazard.y = cap(hazard.y + (hazard.vy || 0) * dt, hazard.radius, CONFIG.height - hazard.radius);
  };
  if ((hazard.spawnGrace ?? 0) > 0) { hazard.spawnGrace = Math.max(0, hazard.spawnGrace - dt); return; }
  const relief = game.director.enabled && game.elapsed < game.director.reliefUntil;
  const dx = game.player.x - hazard.x, dy = game.player.y - hazard.y;
  const length = Math.hypot(dx, dy) || 1;
  const speed = (hazard.speed ?? CONFIG.hazardSpeed) * speedScale * (relief ? 0.55 : 1);
  if (hazard.kind === 'ambusher') {
    if (relief) { hazard.mode = 'rest'; hazard.timer = Math.max(hazard.timer || 0, 1); }
    hazard.timer = Math.max(0, (hazard.timer ?? 1) - dt);
    hazard.vx = hazard.vy = 0;
    if (hazard.mode === 'strike') {
      hazard.vx = hazard.aim.x * hazard.strikeSpeed; hazard.vy = hazard.aim.y * hazard.strikeSpeed;
      if (hazard.timer === 0) { hazard.mode = 'rest'; hazard.timer = 2.4; hazard.vx = hazard.vy = 0; }
    } else if (hazard.mode === 'warning') {
      if (hazard.timer === 0) { hazard.mode = 'strike'; hazard.timer = 0.8; }
    } else if (hazard.timer === 0 && !relief) {
      hazard.mode = 'warning'; hazard.timer = 1.5;
      hazard.aim = { x: dx / length, y: dy / length }; // Lock aim for the whole warning/strike.
      hazard.strikeSpeed = speed * 2.7;
      hazard.telegraphDistance = hazard.strikeSpeed * 0.8;
      game._emit('ambush-warning', { x: hazard.x, y: hazard.y });
    }
  } else if (hazard.kind === 'guardian') {
    let target = game.sparks.find(s => s.id === hazard.guardId && s.kind === 'gold');
    if (!target) {
      target = game.sparks.filter(s => s.kind === 'gold').sort((a, b) => distance(a, hazard) - distance(b, hazard))[0];
      hazard.guardId = target?.id ?? null;
    }
    if (!hazard.anchor) hazard.anchor = { x: cap(hazard.x, 150, 1450), y: cap(hazard.y, 150, 750) };
    const anchor = target || hazard.anchor;
    hazard.orbit = (hazard.orbit ?? 0) + dt * 0.65 * (hazard.turn || 1);
    const tx = cap(anchor.x + Math.cos(hazard.orbit) * 105, 50, 1550);
    const ty = cap(anchor.y + Math.sin(hazard.orbit) * 105, 50, 850);
    const dist = Math.hypot(tx - hazard.x, ty - hazard.y) || 1;
    const stepSpeed = Math.min(speed, dist / dt);
    hazard.vx = (tx - hazard.x) / dist * stepSpeed; hazard.vy = (ty - hazard.y) / dist * stepSpeed;
    hazard.mode = 'patrol';
  } else {
    const curve = Math.min(CONFIG.hazardCurveMax, length / CONFIG.hazardCurveDistance) * (hazard.turn ?? 1);
    hazard.vx = (dx / length - dy / length * curve) * speed;
    hazard.vy = (dy / length + dx / length * curve) * speed;
    hazard.mode = 'chase';
  }
  clampPosition();
}
