import test from "node:test";
import assert from "node:assert/strict";
import { CONFIG, GameModel, ROUND_SECONDS, WORLD_HEIGHT, WORLD_WIDTH, circlesOverlap, clamp, createRng } from "../src/core.js";

function startedGame(seed = 42, populate = false) {
  const game = new GameModel({ seed });
  game.start();
  if (!populate) {
    game.sparks = [];
    game.hazards = [];
    game._sparkSpawnTimer = Infinity;
    game._hazardSpawnTimer = Infinity;
    game.director.enabled = false; // Unit fixtures isolate movement/collisions from scheduled events.
  }
  game.consumeEvents();
  return game;
}
function collect(game, kind = "blue") {
  game.sparks.push({ id: `test-${game.collected}`, x: game.player.x, y: game.player.y, radius: CONFIG.sparkRadius, kind });
  game.update(CONFIG.maxStep);
}
function touchingHazard(game) {
  return { id: "test-hazard", x: game.player.x, y: game.player.y, radius: 32, speed: 0, vx: 0, vy: 0, turn: 1 };
}
function hit(game) {
  game.player.vx = 0;
  game.player.vy = 0;
  game.hazards = [touchingHazard(game)];
  game.update(CONFIG.maxStep);
}
function approximately(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not approximately ${expected}`);
}

test("helpers clamp and include exact circle tangency", () => {
  assert.equal(clamp(8, 0, 5), 5);
  assert.equal(clamp(-2, 0, 5), 0);
  assert.equal(circlesOverlap({ x: 0, y: 0, radius: 4 }, { x: 7, y: 0, radius: 3 }), true);
  assert.equal(circlesOverlap({ x: 0, y: 0, radius: 4 }, { x: 8, y: 0, radius: 3 }), false);
  assert.equal(circlesOverlap(null, {}), false);
});

test("Mulberry32 is stable, seed-dependent and bounded", () => {
  const first = createRng(123456), second = createRng(123456), other = createRng(654321);
  const sequence = Array.from({ length: 30 }, () => first());
  assert.deepEqual(sequence, Array.from({ length: 30 }, () => second()));
  assert.notDeepEqual(sequence, Array.from({ length: 30 }, () => other()));
  assert.ok(sequence.every((value) => value >= 0 && value < 1));
});

test("title and paused states freeze the complete simulation", () => {
  const game = new GameModel({ seed: "tide" });
  const title = game.getSnapshot();
  game.update(20, { right: true });
  assert.deepEqual(game.getSnapshot(), title);
  assert.equal(game.pause(), false);
  assert.equal(game.queueDash(), false);
  game.start();
  game.update(0.4, { right: true });
  assert.equal(game.pause(), true);
  const paused = game.getSnapshot();
  game.update(20, { down: true });
  assert.deepEqual(game.getSnapshot(), paused);
  assert.equal(game.queueDash(), false);
  assert.equal(game.resume(), true);
  assert.equal(game.resume(), false);
  game.update(0.1, {});
  approximately(game.elapsed, 0.5);
});

test("restart restores counters, entities, timers and a reproducible initial run", () => {
  const game = startedGame("restart", true);
  const initial = game.getSnapshot();
  collect(game);
  game.queueDash();
  game.update(0.3, { down: true });
  game.restart();
  game.consumeEvents();
  assert.deepEqual(game.getSnapshot(), initial);
});

test("the countdown is exactly 75 seconds and gameover stays frozen", () => {
  const game = startedGame();
  game.update(74);
  assert.equal(game.phase, "playing");
  assert.equal(game.timeLeft, 1);
  game.update(1);
  assert.equal(game.phase, "gameover");
  assert.equal(game.timeLeft, 0);
  assert.equal(game.elapsed, ROUND_SECONDS);
  assert.equal(game.endReason, "time");
  const final = game.getSnapshot();
  game.update(10, { right: true });
  assert.deepEqual(game.getSnapshot(), final);
});

test("the last simulation tick still collects and resolves lethal collisions", () => {
  const game = startedGame();
  game.update(ROUND_SECONDS - CONFIG.maxStep);
  assert.equal(game.phase, "playing");
  game.lives = 1;
  game.sparks.push({ x: game.player.x, y: game.player.y, radius: CONFIG.sparkRadius, kind: "gold" });
  game.hazards.push(touchingHazard(game));
  game.update(CONFIG.maxStep);
  assert.equal(game.collected, 1);
  assert.equal(game.score, CONFIG.goldValue);
  assert.equal(game.lives, 0);
  assert.equal(game.timeLeft, 0);
  assert.equal(game.endReason, "lives");
  assert.deepEqual(game.consumeEvents().map((event) => event.type), ["collect", "damage", "gameover"]);
});

test("a large step runs collisions instead of skipping to the timeout", () => {
  const game = startedGame();
  game.lives = 1;
  game.hazards.push(touchingHazard(game));
  game.update(ROUND_SECONDS);
  assert.equal(game.phase, "gameover");
  assert.equal(game.endReason, "lives");
  assert.equal(game.elapsed, CONFIG.maxStep);
  assert.ok(game.timeLeft > 74);
});

test("gold gives points only; combo grows in readable capped tiers", () => {
  const game = startedGame();
  collect(game);
  assert.equal(game.score, CONFIG.sparkValue);
  assert.equal(game.multiplier, 1);
  const beforeGold = game.timeLeft;
  collect(game, "gold");
  assert.equal(game.score, CONFIG.sparkValue + CONFIG.goldValue);
  approximately(game.timeLeft, beforeGold - CONFIG.maxStep);
  for (let index = 0; index < 30; index += 1) collect(game);
  assert.equal(game.combo, 32);
  assert.equal(game.bestCombo, 32);
  assert.equal(game.collected, 32);
  assert.equal(game.multiplier, CONFIG.maxMultiplier);
  const previousScore = game.score;
  collect(game);
  assert.equal(game.score - previousScore, CONFIG.sparkValue * CONFIG.maxMultiplier);
});

test("combo expiration breaks the chain before collection on the expiry tick", () => {
  const game = startedGame();
  for (let index = 0; index < CONFIG.comboStep + 1; index += 1) collect(game);
  assert.equal(game.multiplier, 2);
  game.update(CONFIG.comboWindow - CONFIG.maxStep);
  assert.equal(game.combo, CONFIG.comboStep + 1);
  collect(game);
  assert.equal(game.combo, 1);
  assert.equal(game.multiplier, 1);
  assert.equal(game.bestCombo, CONFIG.comboStep + 1);
  assert.equal(game.consumeEvents().filter((event) => event.type === "combo-end").length, 1);
});

test("damage removes one life, resets combo, and starts full invulnerability", () => {
  const game = startedGame();
  collect(game);
  collect(game);
  hit(game);
  assert.equal(game.lives, CONFIG.initialLives - 1);
  assert.equal(game.combo, 0);
  assert.equal(game.comboTimer, 0);
  assert.equal(game.multiplier, 1);
  assert.equal(game.bestCombo, 2);
  assert.equal(game.player.invulnerable, CONFIG.damageInvulnerability);
  // More than one overlapping hazard is still only one damage event per tick.
  game.hazards = [touchingHazard(game), touchingHazard(game)];
  game.update(CONFIG.maxStep);
  assert.equal(game.lives, CONFIG.initialLives - 1);
  game.hazards = [];
  game.update(CONFIG.damageInvulnerability - 2 * CONFIG.maxStep);
  assert.ok(game.player.invulnerable > 0);
  hit(game);
  assert.equal(game.lives, CONFIG.initialLives - 2);
});

test("life zero ends the run immediately and prevents further damage", () => {
  const game = startedGame();
  for (let life = 3; life > 0; life -= 1) {
    game.player.invulnerable = 0;
    hit(game);
    assert.equal(game.lives, life - 1);
  }
  assert.equal(game.phase, "gameover");
  assert.equal(game.endReason, "lives");
  assert.ok(game.timeLeft > 74);
  const ended = game.getSnapshot();
  game.update(100);
  assert.deepEqual(game.getSnapshot(), ended);
  assert.equal(game.consumeEvents().filter((event) => event.type === "gameover").length, 1);
});

test("dash follows current input once, lasts .22 seconds and cools down in 2.4 seconds", () => {
  const game = startedGame();
  const { x, y } = game.player;
  assert.equal(game.queueDash(), true);
  assert.equal(game.queueDash(), false);
  game.update(0.2, { down: true });
  approximately(game.player.x, x);
  approximately(game.player.y - y, CONFIG.playerSpeed * CONFIG.dashMultiplier * 0.2);
  approximately(game.player.dashTimer, 0.02);
  approximately(game.player.dashCooldown, 2.2);
  assert.equal(game.queueDash(), false);
  game.update(0.025, { down: true });
  assert.equal(game.player.dashTimer, 0);
  assert.equal(game.player.invulnerable, 0);
  game.update(CONFIG.dashCooldown - 0.225);
  assert.equal(game.player.dashCooldown, 0);
  assert.equal(game.queueDash(), true);
  assert.equal(game.consumeEvents().filter((event) => event.type === "dash").length, 1);
});

test("dashing never grants immunity to a hazard", () => {
  const game = startedGame();
  game.hazards.push(touchingHazard(game));
  game.queueDash();
  game.update(CONFIG.maxStep, { right: true });
  assert.ok(game.player.dashTimer > 0);
  assert.equal(game.lives, CONFIG.initialLives - 1);
  assert.equal(game.consumeEvents().filter((event) => event.type === "damage").length, 1);
});

test("normal diagonal motion has the same speed cap and boundaries remain solid", () => {
  const straight = startedGame(), diagonal = startedGame();
  straight.update(1, { right: true });
  diagonal.update(1, { right: true, down: true });
  approximately(Math.hypot(straight.player.vx, straight.player.vy), CONFIG.playerSpeed);
  approximately(Math.hypot(diagonal.player.vx, diagonal.player.vy), CONFIG.playerSpeed);
  const game = startedGame();
  game.player.x = WORLD_WIDTH - game.player.radius - 2;
  game.player.y = game.player.radius + 2;
  game.update(1, { right: true, up: true });
  assert.equal(game.player.x, WORLD_WIDTH - game.player.radius);
  assert.equal(game.player.y, game.player.radius);
  assert.equal(game.player.vx, 0);
  assert.equal(game.player.vy, 0);
});

test("spark spawn fallback cannot place a spark directly on the player", () => {
  const game = startedGame();
  game.rng = () => 0.5; // Every random position is exactly the player's position.
  for (let index = 0; index < CONFIG.maxSparks + 10; index += 1) game._spawnSpark();
  assert.equal(game.sparks.length, CONFIG.maxSparks);
  for (const spark of game.sparks) {
    assert.ok(Math.hypot(spark.x - game.player.x, spark.y - game.player.y) >= CONFIG.sparkSafeDistance);
    assert.equal(circlesOverlap(game.player, spark), false);
  }
});

test("edge spawns and damage relocation retain player clearance, even at a corner", () => {
  const game = startedGame();
  game.player.x = game.player.radius;
  game.player.y = game.player.radius;
  game.rng = () => 0; // Repeated random candidate would overlap the player.
  for (let index = 0; index < CONFIG.maxHazards + 10; index += 1) game._spawnHazard();
  assert.equal(game.hazards.length, CONFIG.maxHazards);
  for (const hazard of game.hazards) {
    assert.ok(Math.hypot(hazard.x - game.player.x, hazard.y - game.player.y) >= CONFIG.hazardSafeDistance);
  }
  hit(game);
  assert.equal(game.lives, 2);
  assert.ok(Math.hypot(game.hazards[0].x - game.player.x, game.hazards[0].y - game.player.y) >= CONFIG.hazardSafeDistance);
});

test("full-length simulation caps sparks, hazards and event history", () => {
  const game = startedGame("full-run", true);
  game.player.invulnerable = ROUND_SECONDS + 1;
  for (let second = 0; second < ROUND_SECONDS; second += 1) {
    game.update(1, { x: Math.cos(second / 3), y: Math.sin(second / 3) });
    assert.ok(game.sparks.length <= CONFIG.maxSparks);
    assert.ok(game.hazards.length <= CONFIG.maxHazards);
    assert.ok(game.events.length <= CONFIG.maxEvents);
  }
  assert.equal(game.endReason, "time");
  assert.ok(game.difficulty > CONFIG.difficultyBase);
  for (let index = 0; index < 100; index += 1) game._emit("test-event");
  assert.equal(game.events.length, CONFIG.maxEvents);
});

test("same seeds and inputs reproduce simulation across different frame partitions", () => {
  const whole = startedGame("deterministic", true), split = startedGame("deterministic", true);
  whole.player.invulnerable = split.player.invulnerable = 100;
  for (let second = 0; second < 12; second += 1) {
    const input = { x: Math.cos(second), y: Math.sin(second) };
    if (second % 3 === 0) { whole.queueDash(); split.queueDash(); }
    whole.update(1, input);
    for (let frame = 0; frame < 100; frame += 1) split.update(0.01, input);
  }
  assert.deepEqual(whole.getSnapshot(), split.getSnapshot());
  assert.notDeepEqual(new GameModel({ seed: "a" }).start().sparks, new GameModel({ seed: "b" }).start().sparks);
});

test("snapshots and consumed events expose no nested mutable references", () => {
  const game = startedGame("snapshot", true);
  game.sparks[0].metadata = { tags: ["light"] };
  game._emit("nested", { detail: { values: [1, 2] } });
  const before = game.getSnapshot();
  const snapshot = game.getSnapshot();
  snapshot.player.facing.x = 99;
  snapshot.world.width = 1;
  snapshot.viewport.width = 1;
  snapshot.sparks[0].x = -999;
  snapshot.sparks[0].metadata.tags.push("changed");
  snapshot.hazards[0].speed = 999;
  snapshot.events[0].detail.values[0] = 99;
  snapshot.entityCounts.sparks = 0;
  assert.deepEqual(game.getSnapshot(), before);
  const internal = game.events[0];
  const consumed = game.consumeEvents();
  consumed[0].detail.values[0] = 999;
  assert.equal(internal.detail.values[0], 1);
  assert.equal(game.events.length, 0);
  assert.doesNotThrow(() => JSON.stringify(before));
});

test("invalid deltas are ignored and sub-tick duration accumulates", () => {
  const game = startedGame();
  const before = game.getSnapshot();
  for (const dt of [-1, NaN, Infinity, undefined]) game.update(dt);
  assert.deepEqual(game.getSnapshot(), before);
  game.update(CONFIG.maxStep / 2);
  assert.equal(game.elapsed, 0);
  game.update(CONFIG.maxStep / 2);
  assert.equal(game.elapsed, CONFIG.maxStep);
});
