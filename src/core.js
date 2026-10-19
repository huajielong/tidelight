import { CONFIG } from "./config.js";
import { DEFAULT_CHALLENGE, validateChallenge } from './challenge.js';
import { createDirector, tickDirector, moveHazard } from './director.js';
export { CONFIG };
export const WORLD_WIDTH = CONFIG.width;
export const WORLD_HEIGHT = CONFIG.height;
export const ROUND_SECONDS = CONFIG.roundSeconds;

// Numerical tolerance; all adjustable game rules live in CONFIG.
const EPSILON = 1e-9;
export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
export function circlesOverlap(a, b) {
  if (!a || !b) return false;
  const ar = Number.isFinite(a.radius) ? a.radius : (Number.isFinite(a.r) ? a.r : 0);
  const br = Number.isFinite(b.radius) ? b.radius : (Number.isFinite(b.r) ? b.r : 0);
  const dx = (Number(a.x) || 0) - (Number(b.x) || 0);
  const dy = (Number(a.y) || 0) - (Number(b.y) || 0);
  return dx * dx + dy * dy <= (ar + br) ** 2;
}
function normalizeSeed(seed) {
  if (Number.isFinite(seed)) return Number(seed) >>> 0;
  const text = String(seed ?? "TIDELIGHT");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
/** Deterministic Mulberry32 PRNG. Returns values in [0, 1). */
export function createRng(seed = 0x54494445) {
  let state = normalizeSeed(seed);
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function finiteOr(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}
function deepCopy(value) {
  if (Array.isArray(value)) return value.map(deepCopy);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepCopy(child)]));
  }
  return value;
}
function countdown(value, dt) {
  const next = value - dt;
  return next <= EPSILON ? 0 : next;
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export class GameModel {
  constructor(options = {}) {
    this.seed = normalizeSeed(options.seed ?? 0x54494445);
    this.challenge = validateChallenge(options.challenge ?? DEFAULT_CHALLENGE);
    this.resize(options.width ?? WORLD_WIDTH, options.height ?? WORLD_HEIGHT);
    this._resetRun("title", false);
  }
  _resetRun(phase, populate) {
    this.rng = createRng(this.seed);
    this.phase = phase;
    this.duration = ROUND_SECONDS;
    this.timeLeft = ROUND_SECONDS;
    this.elapsed = 0;
    this.lives = CONFIG.initialLives;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.comboTimer = 0;
    this.collected = 0;
    this.endReason = null;
    this.difficulty = CONFIG.difficultyBase;
    this.director = createDirector();
    this.player = {
      x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2, vx: 0, vy: 0,
      radius: CONFIG.playerRadius, facing: { x: 1, y: 0 },
      dashCooldown: 0, dashTimer: 0, invulnerable: 0,
    };
    this.sparks = [];
    this.hazards = [];
    this.events = [];
    this._nextId = 1;
    this._dashQueued = false;
    this._pendingTime = 0;
    this._ticks = 0;
    this._sparkSpawnTimer = CONFIG.sparkInitialDelay;
    this._hazardSpawnTimer = CONFIG.hazardInitialDelay;
    if (populate) {
      for (let index = 0; index < CONFIG.initialSparks; index += 1) this._spawnSpark();
      const count = this.challenge.difficulty === 'gentle' ? 2 : CONFIG.initialHazards;
      for (let index = 0; index < count; index += 1) this._spawnHazard(this.challenge.enemies[index % this.challenge.enemies.length]);
    }
  }
  start(seed = this.seed, challenge = this.challenge) {
    this.challenge = validateChallenge(challenge);
    this.seed = normalizeSeed(seed);
    this._resetRun("playing", true);
    this._emit("start", { seed: this.seed });
    return this.getSnapshot();
  }
  restart(seed = this.seed, challenge = this.challenge) { return this.start(seed, challenge); }
  returnToTitle() { this._resetRun('title', false); }
  pause() {
    if (this.phase !== "playing") return false;
    this.phase = "paused";
    this._dashQueued = false;
    this._emit("pause");
    return true;
  }
  resume() {
    if (this.phase !== "paused") return false;
    this.phase = "playing";
    this._emit("resume");
    return true;
  }
  queueDash() {
    if (this.phase !== "playing" || this._dashQueued || this.player.dashCooldown > 0 || this.player.dashTimer > 0) return false;
    this._dashQueued = true;
    return true;
  }
  resize(width, height) {
    const safeWidth = Math.max(1, finiteOr(width, WORLD_WIDTH));
    const safeHeight = Math.max(1, finiteOr(height, WORLD_HEIGHT));
    const scale = Math.min(safeWidth / WORLD_WIDTH, safeHeight / WORLD_HEIGHT);
    this.viewport = {
      width: safeWidth, height: safeHeight, scale,
      offsetX: (safeWidth - WORLD_WIDTH * scale) / 2,
      offsetY: (safeHeight - WORLD_HEIGHT * scale) / 2,
    };
    return { ...this.viewport };
  }
  update(dt, input = {}) {
    if (this.phase !== "playing") return this.getSnapshot();
    const delta = Math.max(0, finiteOr(dt, 0));
    // Real frame delays are capped by the caller. Large deterministic test
    // steps still execute every tick, including the final collisions.
    this._pendingTime += Math.min(delta, this.timeLeft);
    while (this.phase === "playing" && this._pendingTime + EPSILON >= CONFIG.maxStep) {
      this._pendingTime = Math.max(0, this._pendingTime - CONFIG.maxStep);
      this._advanceTick(CONFIG.maxStep, input);
    }
    return this.getSnapshot();
  }
  _advanceTick(dt, input) {
    this._beginQueuedDash(input);
    this._movePlayer(dt, input);
    this._tickTimers(dt);
    this._ticks += 1;
    this.elapsed = Math.min(this.duration, this._ticks * CONFIG.maxStep);
    this.timeLeft = Math.max(0, this.duration - this.elapsed);
    this.difficulty = this._difficultyForTime(this.elapsed);
    tickDirector(this, dt);
    this._moveHazards(dt);
    this._updateSpawns(dt);
    this._collectSparks();
    this._handleHazardCollisions();
    // A lethal final-tick collision takes priority over time expiration.
    if (this.phase === "playing" && this.timeLeft <= EPSILON) this._finish("time");
  }
  get multiplier() {
    return Math.min(CONFIG.maxMultiplier, 1 + Math.floor(Math.max(0, this.combo - 1) / CONFIG.comboStep));
  }
  getSnapshot() {
    return deepCopy({
      world: { width: WORLD_WIDTH, height: WORLD_HEIGHT }, viewport: this.viewport,
      seed: this.seed, phase: this.phase, duration: this.duration,
      timeLeft: this.timeLeft, elapsed: this.elapsed, lives: this.lives, score: this.score,
      combo: this.combo, bestCombo: this.bestCombo, comboTimer: this.comboTimer,
      multiplier: this.multiplier, collected: this.collected, endReason: this.endReason,
      difficulty: this.difficulty, player: this.player, sparks: this.sparks, hazards: this.hazards,
      challenge: this.challenge, director: this.director,
      entityCounts: { sparks: this.sparks.length, hazards: this.hazards.length, events: this.events.length },
      events: this.events,
    });
  }
  consumeEvents() {
    const pending = deepCopy(this.events);
    this.events.length = 0;
    return pending;
  }
  _difficultyForTime(elapsed) {
    const scale = { gentle: 0.65, balanced: 1, fierce: 1.2 }[this.challenge.difficulty];
    return (CONFIG.difficultyBase + Math.min(CONFIG.difficultyIncreaseMax, elapsed / CONFIG.difficultySeconds)) * scale;
  }
  _readDirection(input) {
    let x = finiteOr(input.x, finiteOr(input.moveX, 0));
    let y = finiteOr(input.y, finiteOr(input.moveY, 0));
    if (input.left) x -= 1;
    if (input.right) x += 1;
    if (input.up) y -= 1;
    if (input.down) y += 1;
    if (x === 0 && y === 0 && Number.isFinite(input.targetX) && Number.isFinite(input.targetY)) {
      x = input.targetX - this.player.x;
      y = input.targetY - this.player.y;
    }
    const length = Math.hypot(x, y);
    return length === 0 ? { x: 0, y: 0, active: false } : { x: x / length, y: y / length, active: true };
  }
  _beginQueuedDash(input) {
    if (!this._dashQueued) return;
    this._dashQueued = false;
    if (this.player.dashCooldown > 0 || this.player.dashTimer > 0) return;
    const direction = this._readDirection(input);
    if (direction.active) this.player.facing = { x: direction.x, y: direction.y };
    this.player.dashTimer = CONFIG.dashDuration;
    this.player.dashCooldown = CONFIG.dashCooldown;
    this._emit("dash", { x: this.player.x, y: this.player.y });
  }
  _movePlayer(dt, input) {
    const dashPart = Math.min(this.player.dashTimer, dt);
    if (dashPart > 0) {
      this.player.vx = this.player.facing.x * CONFIG.playerSpeed * CONFIG.dashMultiplier;
      this.player.vy = this.player.facing.y * CONFIG.playerSpeed * CONFIG.dashMultiplier;
      this._integratePlayer(dashPart);
    }
    const normalPart = dt - dashPart;
    if (normalPart <= EPSILON) return;
    const direction = this._readDirection(input);
    if (direction.active) {
      this.player.facing = { x: direction.x, y: direction.y };
      this.player.vx += direction.x * CONFIG.playerAcceleration * normalPart;
      this.player.vy += direction.y * CONFIG.playerAcceleration * normalPart;
      const speed = Math.hypot(this.player.vx, this.player.vy);
      if (speed > CONFIG.playerSpeed) {
        const ratio = CONFIG.playerSpeed / speed;
        this.player.vx *= ratio;
        this.player.vy *= ratio;
      }
    } else {
      const drag = Math.exp(-CONFIG.playerDrag * normalPart);
      this.player.vx *= drag;
      this.player.vy *= drag;
    }
    this._integratePlayer(normalPart);
  }
  _integratePlayer(dt) {
    const nextX = this.player.x + this.player.vx * dt;
    const nextY = this.player.y + this.player.vy * dt;
    this.player.x = clamp(nextX, this.player.radius, WORLD_WIDTH - this.player.radius);
    this.player.y = clamp(nextY, this.player.radius, WORLD_HEIGHT - this.player.radius);
    if (nextX !== this.player.x) this.player.vx = 0;
    if (nextY !== this.player.y) this.player.vy = 0;
  }
  _tickTimers(dt) {
    this.player.dashTimer = countdown(this.player.dashTimer, dt);
    this.player.dashCooldown = countdown(this.player.dashCooldown, dt);
    this.player.invulnerable = countdown(this.player.invulnerable, dt);
    if (this.combo > 0) {
      this.comboTimer = countdown(this.comboTimer, dt);
      if (this.comboTimer === 0) { this.combo = 0; this._emit("combo-end"); }
    }
  }
  _updateSpawns(dt) {
    this._sparkSpawnTimer -= dt;
    if (this._sparkSpawnTimer <= EPSILON) {
      const capacity = Math.min(CONFIG.maxSparks, Math.floor(CONFIG.sparkCapacityBase + this.difficulty * CONFIG.sparkCapacityDifficulty));
      if (this.sparks.length < capacity) this._spawnSpark();
      this._sparkSpawnTimer += Math.max(CONFIG.sparkIntervalMin, CONFIG.sparkIntervalBase - this.difficulty * CONFIG.sparkIntervalDifficulty);
    }
    this._hazardSpawnTimer -= dt;
    if (this._hazardSpawnTimer <= EPSILON) {
      const capacity = Math.min(CONFIG.maxHazards, Math.floor(CONFIG.hazardCapacityBase + this.difficulty * CONFIG.hazardCapacityDifficulty));
      if (this.hazards.length < capacity && this.elapsed >= this.director.reliefUntil) this._spawnHazard();
      this._hazardSpawnTimer += Math.max(CONFIG.hazardIntervalMin, CONFIG.hazardIntervalBase - this.difficulty);
    }
  }
  _spawnSpark() {
    if (this.sparks.length >= CONFIG.maxSparks) return null;
    const gold = this.rng() < CONFIG.goldChance;
    const point = this._randomPoint(CONFIG.sparkMargin, CONFIG.sparkSafeDistance);
    if (!point) return null;
    const spark = {
      id: `spark-${this._nextId++}`, x: point.x, y: point.y,
      radius: gold ? CONFIG.goldRadius : CONFIG.sparkRadius, kind: gold ? "gold" : "blue",
      value: gold ? CONFIG.goldValue : CONFIG.sparkValue, pulse: this.rng() * Math.PI * 2,
    };
    this.sparks.push(spark);
    return spark;
  }
  _spawnHazard(kind = this.challenge.enemies[Math.floor(this.rng() * this.challenge.enemies.length)]) {
    if (this.hazards.length >= CONFIG.maxHazards) return null;
    const hazard = {
      id: `hazard-${this._nextId++}`, x: 0, y: 0, vx: 0, vy: 0,
      radius: CONFIG.hazardRadius + this.rng() * CONFIG.hazardRadiusVariation,
      speed: CONFIG.hazardSpeed + this.rng() * CONFIG.hazardSpeedVariation,
      turn: this.rng() < 0.5 ? -1 : 1,
      kind, mode: kind === 'ambusher' ? 'rest' : kind === 'guardian' ? 'patrol' : 'chase',
      timer: 1.5, spawnGrace: 1.8, aim: { x: 1, y: 0 },
    };
    if (!this._placeHazardAtEdge(hazard)) return null;
    this.hazards.push(hazard);
    return hazard;
  }
  _randomPoint(margin, minPlayerDistance) {
    const isSafe = (point) => distance(point, this.player) >= minPlayerDistance
      && this.sparks.every((spark) => distance(point, spark) >= CONFIG.sparkSeparation)
      && this.hazards.every((hazard) => distance(point, hazard) >= CONFIG.sparkHazardDistance);
    for (let attempt = 0; attempt < CONFIG.spawnAttempts; attempt += 1) {
      const point = {
        x: margin + this.rng() * (WORLD_WIDTH - margin * 2),
        y: margin + this.rng() * (WORLD_HEIGHT - margin * 2),
      };
      if (isSafe(point)) return point;
    }
    // Rejected candidates never become spawns: bounded grid fallback is safe
    // even with a degenerate injected RNG; a full area simply skips the spawn.
    for (let row = 0; row <= CONFIG.spawnFallbackSegments; row += 1) {
      for (let col = 0; col <= CONFIG.spawnFallbackSegments; col += 1) {
        const point = {
          x: margin + col / CONFIG.spawnFallbackSegments * (WORLD_WIDTH - margin * 2),
          y: margin + row / CONFIG.spawnFallbackSegments * (WORLD_HEIGHT - margin * 2),
        };
        if (isSafe(point)) return point;
      }
    }
    return null;
  }
  _placeHazardAtEdge(hazard) {
    const margin = hazard.radius;
    const pointOnEdge = (edge, fraction) => edge < 2
      ? { x: margin + fraction * (WORLD_WIDTH - margin * 2), y: edge === 0 ? margin : WORLD_HEIGHT - margin }
      : { x: edge === 2 ? margin : WORLD_WIDTH - margin, y: margin + fraction * (WORLD_HEIGHT - margin * 2) };
    const isSafe = (point) => distance(point, this.player) >= CONFIG.hazardSafeDistance
      && this.hazards.every((other) => other === hazard || distance(point, other) >= CONFIG.hazardSeparation);
    let point = null;
    for (let attempt = 0; attempt < CONFIG.spawnAttempts; attempt += 1) {
      const candidate = pointOnEdge(Math.floor(this.rng() * 4), this.rng());
      if (isSafe(candidate)) { point = candidate; break; }
    }
    if (!point) {
      for (let edge = 0; edge < 4 && !point; edge += 1) {
        for (let index = 0; index <= CONFIG.spawnFallbackSegments; index += 1) {
          const candidate = pointOnEdge(edge, index / CONFIG.spawnFallbackSegments);
          if (isSafe(candidate)) { point = candidate; break; }
        }
      }
    }
    if (!point) return false;
    Object.assign(hazard, point, { vx: 0, vy: 0 });
    if (hazard.kind) Object.assign(hazard, { spawnGrace: 1.8, mode: 'rest', timer: 1.5 });
    return true;
  }
  _collectSparks() {
    for (let index = 0; index < this.sparks.length;) {
      const spark = this.sparks[index];
      if (!circlesOverlap(this.player, spark)) { index += 1; continue; }
      this.sparks.splice(index, 1);
      this.combo += 1;
      this.collected += 1;
      this.director.metrics.collected += 1;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.comboTimer = CONFIG.comboWindow;
      const points = finiteOr(spark.value, spark.kind === "gold" ? CONFIG.goldValue : CONFIG.sparkValue) * this.multiplier;
      this.score += points;
      this._emit("collect", { id: spark.id, kind: spark.kind, points, combo: this.combo, multiplier: this.multiplier, x: spark.x, y: spark.y });
    }
  }
  _moveHazards(dt) {
    const speedScale = CONFIG.hazardSpeedScaleBase + this.difficulty * CONFIG.hazardSpeedScaleDifficulty;
    for (const hazard of this.hazards) moveHazard(this, hazard, dt, speedScale);
  }
  _handleHazardCollisions() {
    if (this.player.invulnerable > 0) return;
    const hazard = this.hazards.find((candidate) => !(candidate.spawnGrace > 0) && circlesOverlap(this.player, candidate));
    if (!hazard) return;
    this.lives = Math.max(0, this.lives - 1);
    this.director.lastDamageAt = this.elapsed;
    this.director.metrics.hits += 1;
    this.combo = 0;
    this.comboTimer = 0;
    this.player.invulnerable = CONFIG.damageInvulnerability;
    let dx = this.player.x - hazard.x;
    let dy = this.player.y - hazard.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) { dx = -this.player.facing.x; dy = -this.player.facing.y; }
    else { dx /= length; dy /= length; }
    this.player.vx = dx * CONFIG.damageKnockback;
    this.player.vy = dy * CONFIG.damageKnockback;
    this._emit("damage", { lives: this.lives, x: this.player.x, y: this.player.y });
    if (this.lives === 0) { this._finish("lives"); return; }
    if (!this._placeHazardAtEdge(hazard)) this.hazards.splice(this.hazards.indexOf(hazard), 1);
  }
  _finish(reason) {
    this.phase = "gameover";
    this.endReason = reason;
    this._dashQueued = false;
    this._pendingTime = 0;
    this._emit("gameover", { reason, score: this.score, collected: this.collected });
  }
  _emit(type, detail = {}) {
    this.events.push({ type, at: this.elapsed, ...detail });
    if (this.events.length > CONFIG.maxEvents) this.events.splice(0, this.events.length - CONFIG.maxEvents);
  }
}
