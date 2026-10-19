import { CONFIG, clamp } from './core.js';

const TAU = Math.PI * 2;

/** All coordinates below are in the fixed logical world, independent of CSS pixels. */
export class Renderer {
  constructor(canvas, onAssetError) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.particles = [];
    this.wake = [];
    this.labels = [];
    this.shake = 0;
    this.visualTime = 0;
    this.viewport = { width: 1600, height: 900, dpr: 1 };
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = this.motionQuery.matches;
    this.motionQuery.addEventListener('change', event => {
      this.reducedMotion = event.matches;
      this.reset();
    });
    this.assets = { background: 'loading', boat: 'loading' };
    this.background = this.load('background', './assets/moonlit-lagoon.png', onAssetError);
    this.boat = this.load('boat', './assets/lantern-boat.png', onAssetError);
    this.resize();
  }

  load(name, path, onError) {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => { this.assets[name] = 'ready'; };
    image.onerror = () => { this.assets[name] = 'failed'; onError(name); };
    image.src = path;
    return image;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, CONFIG.maxDpr);
    this.viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height), dpr };
    this.canvas.width = Math.round(this.viewport.width * dpr);
    this.canvas.height = Math.round(this.viewport.height * dpr);
  }

  reset() {
    this.particles.length = this.wake.length = this.labels.length = 0;
    this.shake = this.visualTime = 0;
  }

  burst(x, y, color, count) {
    count = this.reducedMotion ? 3 : count;
    for (let i = 0; i < count && this.particles.length < CONFIG.maxParticles; i++) {
      const angle = Math.random() * TAU;
      const speed = 30 + Math.random() * 130;
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 0.7, radius: 2 + Math.random() * 3, color });
    }
  }

  event(event) {
    if (event.type === 'collect') {
      const color = event.kind === 'gold' ? '#fff0a1' : '#7dfff0';
      this.burst(event.x, event.y, color, 14);
      this.labels.push({ x: event.x, y: event.y - 32, text: `+${event.points}`, color, life: 0.8 });
    } else if (event.type === 'damage') {
      this.burst(event.x, event.y, '#ff8c9a', 24);
      this.shake = this.reducedMotion ? 0 : 8;
      this.labels.push({ x: event.x, y: event.y - 40, text: '−1 灯火', color: '#ffb5b9', life: 1 });
    } else if (event.type === 'dash') {
      this.burst(event.x, event.y, '#c9fff6', 8);
    }
    if (this.labels.length > 12) this.labels.shift();
  }

  update(dt, state) {
    if (state.phase === 'paused' || state.phase === 'gameover') return;
    this.visualTime += dt;
    this.shake = Math.max(0, this.shake - dt * 30);
    if (state.phase === 'playing' && !this.reducedMotion) {
      const last = this.wake.at(-1);
      if (!last || Math.hypot(last.x - state.player.x, last.y - state.player.y) > 12) {
        this.wake.push({ x: state.player.x, y: state.player.y, life: 1 });
        if (this.wake.length > CONFIG.maxWakePoints) this.wake.shift();
      }
    }
    for (const point of this.wake) point.life -= dt;
    this.wake = this.wake.filter(point => point.life > 0);
    for (const particle of this.particles) {
      particle.life -= dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
    }
    this.particles = this.particles.filter(particle => particle.life > 0);
    for (const label of this.labels) {
      label.life -= dt;
      if (!this.reducedMotion) label.y -= dt * 25;
    }
    this.labels = this.labels.filter(label => label.life > 0);
  }

  render(state, pointer) {
    const ctx = this.ctx;
    const { width: W, height: H } = CONFIG;
    const time = this.reducedMotion ? 0 : this.visualTime;
    ctx.setTransform(this.canvas.width / W, 0, 0, this.canvas.height / H, 0, 0);
    ctx.fillStyle = '#08283d';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    if (this.shake) ctx.translate(Math.sin(time * 79) * this.shake, Math.cos(time * 63) * this.shake / 2);
    if (this.assets.background === 'ready') ctx.drawImage(this.background, 0, 0, W, H);
    ctx.fillStyle = 'rgba(2, 17, 29, 0.35)';
    ctx.fillRect(0, 0, W, H);
    if (state.challenge?.theme !== 'moon') {
      ctx.fillStyle = state.challenge?.theme === 'aurora' ? 'rgba(16,150,113,.12)' : 'rgba(230,116,42,.10)';
      ctx.fillRect(0, 0, W, H);
    }

    // A faint frame marks the actual navigable world, including on portrait screens.
    ctx.strokeStyle = 'rgba(181,255,238,.18)';
    ctx.lineWidth = 2;
    ctx.strokeRect(2, 2, W - 4, H - 4);
    for (let i = 0; i < (this.reducedMotion ? 8 : 24); i++) {
      const x = ((i * 0.618 + 0.07) % 1) * W + Math.sin(time * 0.4 + i) * 8;
      const y = ((i * 0.382 + 0.15) % 1) * H + Math.cos(time * 0.3 + i) * 6;
      ctx.fillStyle = `rgba(125,255,236,${0.15 + (1 + Math.sin(time * 2 + i)) * 0.1})`;
      this.circle(x, y, 1.5, true);
    }
    if (state.phase !== 'title') {
      this.drawTide(state);
      for (const point of this.wake) {
        ctx.strokeStyle = `rgba(155,255,242,${point.life * 0.3})`;
        ctx.lineWidth = 1.5;
        this.circle(point.x, point.y, 16 + (1 - point.life) * 22);
      }
      for (const spark of state.sparks) this.drawSpark(spark, time);
      for (const hazard of state.hazards) this.drawHazard(hazard, time);
      this.drawBoat(state.player, time);
      for (const particle of this.particles) {
        ctx.globalAlpha = clamp(particle.life / 0.7, 0, 1);
        ctx.fillStyle = particle.color;
        this.circle(particle.x, particle.y, particle.radius, true);
      }
      ctx.globalAlpha = 1;
      ctx.font = '600 21px system-ui';
      ctx.textAlign = 'center';
      for (const label of this.labels) {
        ctx.globalAlpha = Math.min(1, label.life * 3);
        ctx.strokeStyle = '#061725'; ctx.lineWidth = 4;
        ctx.strokeText(label.text, label.x, label.y);
        ctx.fillStyle = label.color;
        ctx.fillText(label.text, label.x, label.y);
      }
      ctx.globalAlpha = 1;
      if (pointer.active && state.phase === 'playing') {
        ctx.strokeStyle = 'rgba(195,255,245,.6)'; ctx.lineWidth = 2;
        this.circle(pointer.x, pointer.y, 14);
      }
    }
    ctx.restore();
  }

  circle(x, y, radius, fill = false) {
    this.ctx.beginPath(); this.ctx.arc(x, y, radius, 0, TAU);
    if (fill) this.ctx.fill(); else this.ctx.stroke();
  }

  drawTide(state) {
    const ctx = this.ctx, d = state.director;
    if (!d?.enabled) return;
    const event = d.pending || d.active;
    if (!event) return;
    ctx.save();
    const color = event.type === 'calm' ? '#8bf9dc' : event.type === 'hunt' ? '#ffb09b' : '#fff1a8';
    ctx.strokeStyle = color; ctx.globalAlpha = d.pending ? 0.6 : 0.16;
    ctx.lineWidth = 2; ctx.setLineDash([8, 12]);
    const points = event.points;
    ctx.beginPath();
    points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.stroke(); ctx.setLineDash([]);
    if (d.pending) {
      const progress = 1 - Math.max(0, d.pending.startsAt - state.elapsed) / 1.8;
      for (const p of points) this.circle(p.x, p.y, 22 + (1 - progress) * 35);
    }
    ctx.restore();
  }

  drawSpark(spark, time) {
    const ctx = this.ctx;
    const golden = spark.kind === 'gold';
    const color = golden ? '#fff0a1' : '#7dfff0';
    const radius = spark.radius * (1 + Math.sin(time * 4 + spark.pulse) * 0.12);
    ctx.save(); ctx.translate(spark.x, spark.y); ctx.rotate(time * 0.5 + spark.pulse);
    ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = golden ? 24 : 16;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 === 0 ? radius : radius * 0.4;
      const x = Math.cos(i * Math.PI / 4) * r, y = Math.sin(i * Math.PI / 4) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0; ctx.fillStyle = '#ffffff'; this.circle(0, 0, 2.5, true);
    ctx.restore();
  }

  drawHazard(hazard, time) {
    const ctx = this.ctx, r = hazard.radius;
    const kind = hazard.kind || 'chaser';
    const color = kind === 'ambusher' ? '#ffa37d' : kind === 'guardian' ? '#ffe5a1' : '#ec7b99';
    if (kind === 'ambusher' && hazard.mode === 'warning' && hazard.aim) {
      const length = hazard.telegraphDistance;
      ctx.save(); ctx.translate(hazard.x, hazard.y); ctx.rotate(Math.atan2(hazard.aim.y, hazard.aim.x));
      ctx.strokeStyle = '#ffc499c0'; ctx.fillStyle = '#ffae7922';
      ctx.fillRect(0, -r, length, r * 2);
      ctx.lineWidth = 2; ctx.setLineDash([10, 10]);
      ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(length, -r);
      ctx.moveTo(0, r); ctx.lineTo(length, r); ctx.stroke();
      ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(length - 14, -9);
      ctx.lineTo(length, 0); ctx.lineTo(length - 14, 9); ctx.stroke();
      ctx.restore();
    }
    ctx.save(); ctx.translate(hazard.x, hazard.y);
    ctx.rotate(kind === 'ambusher' && hazard.aim ? Math.atan2(hazard.aim.y, hazard.aim.x) + Math.PI / 2 : 0);
    if (hazard.spawnGrace > 0) { ctx.globalAlpha = 0.45; ctx.setLineDash([7, 8]); }
    const halo = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * 1.65);
    halo.addColorStop(0, 'rgba(255,105,137,.25)'); halo.addColorStop(1, 'rgba(255,105,137,0)');
    ctx.fillStyle = halo; this.circle(0, 0, r * 1.65, true);
    ctx.fillStyle = '#080f22'; this.circle(0, 0, r, true);
    // The solid ring is the collision radius; the glow is decorative.
    ctx.strokeStyle = color; ctx.lineWidth = 2.5; this.circle(0, 0, r);
    ctx.setLineDash([]);
    ctx.lineWidth = 3;
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 1 ? color : '#655c9c';
      const spin = time * (hazard.turn || 1);
      ctx.beginPath(); ctx.arc(0, 0, r * (0.25 + i * 0.2), i * 2 + spin, i * 2 + spin + Math.PI * 1.3); ctx.stroke();
    }
    ctx.fillStyle = color;
    if (kind === 'ambusher') {
      ctx.beginPath(); ctx.moveTo(0, -r * .55); ctx.lineTo(r * .45, r * .35); ctx.lineTo(-r * .45, r * .35); ctx.closePath(); ctx.fill();
    } else if (kind === 'guardian') {
      ctx.rotate(Math.PI / 4); ctx.strokeStyle = color; ctx.strokeRect(-r * .4, -r * .4, r * .8, r * .8);
    } else this.circle(0, 0, 4, true);
    ctx.restore();
  }

  drawBoat(player, time) {
    const ctx = this.ctx;
    ctx.save(); ctx.translate(player.x, player.y);
    ctx.rotate(Math.atan2(player.facing.y, player.facing.x) + Math.PI / 2);
    const halo = ctx.createRadialGradient(0, 0, 2, 0, 0, 65);
    halo.addColorStop(0, 'rgba(255,241,167,.5)'); halo.addColorStop(0.5, 'rgba(117,246,234,.15)'); halo.addColorStop(1, 'rgba(117,246,234,0)');
    ctx.fillStyle = halo; this.circle(0, 0, 65, true);
    if (player.invulnerable > 0) {
      ctx.strokeStyle = '#fff5c2'; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
      this.circle(0, 0, player.radius + 8); ctx.setLineDash([]);
      if (!this.reducedMotion) ctx.globalAlpha = 0.75 + Math.sin(time * 10) * 0.2;
    }
    if (this.assets.boat === 'ready') {
      // Crop only transparent margins at draw time; the authored PNG stays untouched.
      ctx.drawImage(this.boat, 408, 31, 438, 1192, -14, -36, 28, 76);
    } else {
      ctx.fillStyle = '#b0e2d9'; ctx.strokeStyle = '#effff8'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -32); ctx.quadraticCurveTo(26, 0, 13, 26);
      ctx.quadraticCurveTo(0, 34, -13, 26); ctx.quadraticCurveTo(-26, 0, 0, -32);
      ctx.fill(); ctx.stroke(); ctx.fillStyle = '#fff0a1'; this.circle(0, 0, 6, true);
    }
    if (player.dashTimer > 0) {
      ctx.strokeStyle = '#baffec'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-9, 28); ctx.lineTo(-6, 60); ctx.moveTo(9, 28); ctx.lineTo(6, 60); ctx.stroke();
    }
    ctx.restore();
  }
}
