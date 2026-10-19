/** Short synthesized cues; sound is optional and never gates gameplay. */
export class Soundscape {
  constructor() {
    this.context = null;
    this.master = null;
    this.muted = false;
    this.available = true;
  }

  async unlock() {
    if (!this.available || this.muted) return;
    try {
      if (!this.context) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) { this.available = false; return; }
        this.context = new Audio();
        this.master = this.context.createGain();
        this.master.gain.value = 0.1;
        this.master.connect(this.context.destination);
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { this.available = false; }
  }

  setMuted(value) {
    this.muted = Boolean(value);
    try {
      this.master?.gain.setTargetAtTime(this.muted ? 0 : 0.1, this.context.currentTime, 0.025);
    } catch { this.available = false; }
  }

  tone(frequency, duration = 0.12, type = 'sine', glide = 0) {
    if (!this.available || this.muted || this.context?.state !== 'running') return;
    try {
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, now);
      if (glide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + glide), now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.35, now + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch { this.available = false; }
  }

  start() { this.tone(330, 0.24, 'sine', 330); }
  collect(combo, golden) { this.tone(golden ? 780 : 390 + Math.min(combo, 8) * 26, golden ? 0.23 : 0.095, 'sine', 110); }
  dash() { this.tone(150, 0.17, 'triangle', 520); }
  hit() { this.tone(120, 0.25, 'triangle', -65); }
  finish() { this.tone(330, 0.38, 'sine', -130); }
  warning() { this.tone(240, 0.18, 'triangle', 100); }
  tide(kind) { this.tone(kind === 'calm' ? 440 : 620, 0.25, 'sine', 120); }
}
