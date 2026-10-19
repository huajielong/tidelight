import test from 'node:test';
import assert from 'node:assert/strict';
import { GameModel, CONFIG } from '../src/core.js';
import { DEFAULT_CHALLENGE, localChallenge, encodeChallenge, decodeChallenge } from '../src/challenge.js';
import { moveHazard } from '../src/director.js';

function gameFor(challenge = DEFAULT_CHALLENGE) {
  const game = new GameModel({ seed: challenge.seed, challenge }); game.start();
  game.sparks = []; game.hazards = []; game._sparkSpawnTimer = Infinity; game._hazardSpawnTimer = Infinity;
  game.player.invulnerable = 100; game.consumeEvents(); return game;
}
test('director warns for 1.8 seconds before adding a route, then permits a finale even when full', () => {
  const game = gameFor(); game.update(12);
  assert.equal(game.director.pending.type, 'trail'); assert.equal(game.sparks.length, 0);
  game.update(1.79); assert.equal(game.director.active, null);
  game.update(.02); assert.equal(game.director.active.type, 'trail'); assert.ok(game.sparks.some(s => s.route));
  game.update(48.1); assert.equal(game.director.active.type, 'finale');
  assert.ok(game.sparks.filter(s => s.route && s.kind === 'gold').length >= 3);
  assert.ok(game.sparks.length <= CONFIG.maxSparks);
});
test('damage arranges visible recovery and slows enemies without altering score/duration', () => {
  const game = gameFor(); game.player.invulnerable = 0;
  game.hazards = [{ x: 800, y: 450, radius: 30, speed: 0 }]; game.update(.02);
  assert.equal(game.lives, 2); assert.equal(game.director.pending.type, 'calm');
  game.hazards = []; game.update(1.81);
  assert.ok(game.director.reliefUntil > game.elapsed); assert.equal(game.score, 0); assert.equal(game.duration, 75);
  const h = { x: 400, y: 400, radius: 30, speed: 100, kind: 'chaser', turn: 0 };
  moveHazard(game, h, .1, 1); assert.ok(Math.abs(Math.hypot(h.vx, h.vy) - 55) < 1e-8);
});
test('combo reward replaces hunt but does not secretly accelerate enemies', () => {
  const game = gameFor({ ...DEFAULT_CHALLENGE, events: ['hunt', 'hunt', 'hunt', 'finale'] });
  game.update(11.9, { x: 1, y: 0 }); game.combo = 5; game.comboTimer = 2;
  game.update(.1, { x: 0, y: 1 }); assert.equal(game.director.pending.type, 'trail');
  assert.equal(game.director.pending.reason, '连击奖励路线');
  assert.equal(game.difficulty, game._difficultyForTime(12));
});
test('ambusher locks aim, waits 1.5s, then strikes straight and rests', () => {
  const game = gameFor(); const h = { x: 300, y: 450, radius: 30, speed: 100, kind: 'ambusher', mode: 'rest', timer: 0 };
  moveHazard(game, h, .01, 1); assert.equal(h.mode, 'warning'); const aim = { ...h.aim };
  game.player.y = 50;
  for (let i = 0; i < 149; i++) moveHazard(game, h, .01, 1);
  assert.equal(h.mode, 'warning'); assert.equal(h.x, 300); assert.equal(h.y, 450); assert.deepEqual(h.aim, aim);
  moveHazard(game, h, .02, 1); assert.equal(h.mode, 'strike');
  moveHazard(game, h, .1, 1); assert.equal(h.x, 327); assert.equal(h.y, 450);
  for (let i = 0; i < 80; i++) moveHazard(game, h, .01, 1);
  assert.equal(h.mode, 'rest');
});
test('guardian follows a gold anchor, not the player, and retargets after collection', () => {
  const a = gameFor(), b = gameFor();
  a.player.x = 20; b.player.x = 1580;
  a.sparks = b.sparks = [{ id: 'gold', kind: 'gold', x: 800, y: 450 }];
  const h1 = { x: 700, y: 450, radius: 30, speed: 100, kind: 'guardian', turn: 1 }, h2 = { ...h1 };
  for (let i = 0; i < 50; i++) { moveHazard(a, h1, .02, 1); moveHazard(b, h2, .02, 1); }
  assert.deepEqual(h1, h2); assert.equal(h1.guardId, 'gold');
  a.sparks = [{ id: 'new-gold', kind: 'gold', x: 300, y: 200 }]; moveHazard(a, h1, .02, 1);
  assert.equal(h1.guardId, 'new-gold');
});
test('new enemies have visible grace and cannot damage during that grace', () => {
  const game = gameFor(); game.player.invulnerable = 0;
  game.hazards = [{ x: 800, y: 450, radius: 30, speed: 0, kind: 'chaser', spawnGrace: 1.8 }];
  game.update(1.7); assert.equal(game.lives, 3);
  game.update(.2); assert.equal(game.lives, 2);
});
test('enemy selection is honored by initial spawn, timed spawn and director events', () => {
  const c = localChallenge('全程追逐'); const game = new GameModel({ seed: c.seed, challenge: c }); game.start();
  game.player.invulnerable = 100;
  for (let i = 0; i < 75; i++) {
    game.update(1, { x: Math.sin(i), y: Math.cos(i) });
    assert.ok(game.hazards.every(h => h.kind === 'chaser'));
    assert.ok(game.hazards.length <= CONFIG.maxHazards); assert.ok(game.sparks.length <= CONFIG.maxSparks);
  }
});
test('complete challenge-code replay survives frame partitioning and resets all director state', () => {
  const c = localChallenge('极光金色环形'); const decoded = decodeChallenge(encodeChallenge(c));
  const a = new GameModel({ seed: c.seed, challenge: c }), b = new GameModel({ seed: decoded.seed, challenge: decoded });
  a.start(); b.start(); a.player.invulnerable = b.player.invulnerable = 100;
  for (let i = 0; i < 75; i++) {
    const input = { x: Math.sin(i / 4), y: Math.cos(i / 4) };
    a.update(1, input); for (let j = 0; j < 60; j++) b.update(1 / 60, input);
  }
  assert.deepEqual(a.getSnapshot(), b.getSnapshot()); assert.equal(a.elapsed, 75);
  assert.ok(a.director.history.length >= 4);
  const snap = a.getSnapshot(); snap.challenge.events[0] = 'hunt'; snap.director.history[0].type = 'hunt';
  assert.notDeepEqual(a.getSnapshot(), snap);
  a.returnToTitle(); assert.equal(a.phase, 'title'); assert.equal(a.director.history.length, 0);
  a.restart(); const fresh = new GameModel({ seed: c.seed, challenge: c }); fresh.start();
  assert.deepEqual(a.getSnapshot(), fresh.getSnapshot());
});
