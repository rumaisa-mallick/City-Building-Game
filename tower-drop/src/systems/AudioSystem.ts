import type { SceneId } from '../types';
import type { SceneSystem } from './SceneSystem';
import type { CitySystem } from './CitySystem';
import type { WeatherSystem } from './WeatherSystem';

const MUTE_KEY = 'city-builder-muted';
const VOL_KEY = 'city-builder-volume';
const MASTER = 0.55;

/**
 * Fully procedural ambient audio (zero assets, WebAudio):
 * city hum, rain hiss, birdsong by day, crickets at night, random thunder
 * in rain, passing-car whooshes and an occasional train horn.
 * Everything starts suspended until the first user gesture (browser policy).
 */
export class AudioSystem {
  muted = false;
  /** user volume 0..1, scaled onto the fixed master gain */
  volume = 1;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private birdsGain: GainNode | null = null;
  private cricketsGain: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private started = false;

  private birdT = 2.5;
  private cricketT = 1;
  private whooshT = 6;
  private thunderT = 18;
  private hornT = 35;
  private pendingThunder = -1; // countdown to a strike's thunderclap
  private prevFlash = 0;
  private sceneSys: SceneSystem;
  private city: CitySystem;
  private weather: WeatherSystem | null;

  constructor(sceneSys: SceneSystem, city: CitySystem, weather: WeatherSystem | null = null) {
    this.sceneSys = sceneSys;
    this.city = city;
    this.weather = weather;
    try { this.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* private mode */ }
    try {
      const v = parseFloat(localStorage.getItem(VOL_KEY) ?? '');
      if (!isNaN(v)) this.volume = Math.min(1, Math.max(0, v));
    } catch { /* private mode */ }
    window.addEventListener('pointerdown', () => this.start());
    window.addEventListener('keydown', () => this.start());
  }

  private start(): void {
    if (this.started) return;
    this.started = true;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    void ctx.resume?.().catch(() => void 0);

    this.master = ctx.createGain();
    this.master.gain.value = this.outGain();
    this.master.connect(ctx.destination);

    // shared white-noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // city hum — always on, very low
    const hum = ctx.createBufferSource();
    hum.buffer = buf;
    hum.loop = true;
    const humF = ctx.createBiquadFilter();
    humF.type = 'lowpass';
    humF.frequency.value = 240;
    const humG = ctx.createGain();
    humG.gain.value = 0.05;
    hum.connect(humF).connect(humG).connect(this.master);
    hum.start();

    // rain hiss — scene-gated
    const rain = ctx.createBufferSource();
    rain.buffer = buf;
    rain.loop = true;
    const rainHP = ctx.createBiquadFilter();
    rainHP.type = 'highpass';
    rainHP.frequency.value = 550;
    const rainLP = ctx.createBiquadFilter();
    rainLP.type = 'lowpass';
    rainLP.frequency.value = 7200;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    rain.connect(rainHP).connect(rainLP).connect(this.rainGain).connect(this.master);
    rain.start();

    // scene-gated send buses for one-shots
    this.birdsGain = ctx.createGain();
    this.birdsGain.gain.value = 0;
    this.birdsGain.connect(this.master);
    this.cricketsGain = ctx.createGain();
    this.cricketsGain.gain.value = 0;
    this.cricketsGain.connect(this.master);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(MUTE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.outGain(), this.ctx.currentTime, 0.06);
    }
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    try { localStorage.setItem(VOL_KEY, String(this.volume)); } catch { /* ignore */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.outGain(), this.ctx.currentTime, 0.06);
    }
  }

  /** what the master gain should be right now: mute wins, then the slider */
  private outGain(): number {
    return this.muted ? 0 : MASTER * this.volume;
  }

  // ---- one-shots -------------------------------------------------------

  private chirp(): void {
    const ctx = this.ctx;
    if (!ctx || !this.birdsGain) return;
    const now = ctx.currentTime;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      const g = ctx.createGain();
      const t0 = now + i * (0.08 + Math.random() * 0.05);
      const f0 = 2300 + Math.random() * 900;
      o.frequency.setValueAtTime(f0, t0);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.7, t0 + 0.08);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.085, t0 + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
      o.connect(g).connect(this.birdsGain);
      o.start(t0);
      o.stop(t0 + 0.11);
    }
  }

  private cricket(): void {
    const ctx = this.ctx;
    if (!ctx || !this.cricketsGain) return;
    const now = ctx.currentTime;
    for (let i = 0; i < 4; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 4300 + Math.random() * 500;
      const g = ctx.createGain();
      const t0 = now + i * 0.07;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.05, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05);
      o.connect(g).connect(this.cricketsGain);
      o.start(t0);
      o.stop(t0 + 0.06);
    }
  }

  private noiseVoice(
    filterType: BiquadFilterType, freq: number, q: number, peak: number, attack: number, decay: number
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noiseBuf || !this.master) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + attack + decay + 0.1);
  }

  private horn(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 750;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.055, now + 0.06);
    g.gain.setValueAtTime(0.055, now + 0.85);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    lp.connect(g).connect(this.master);
    for (const freq of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.connect(lp);
      o.start(now);
      o.stop(now + 1.15);
    }
  }

  // ---- per-frame -------------------------------------------------------

  update(dt: number): void {
    if (!this.ctx || !this.master) return;
    const scene: SceneId = this.sceneSys.current;
    const day = scene === 'morning' || scene === 'day' || scene === 'sunset';
    const night = scene === 'night';
    const rainAmt = Math.max(scene === 'rain' ? 1 : 0, this.weather?.mod.rain ?? 0);
    const storm = (this.weather?.state ?? 'clear') === 'storm';

    // scene gates
    const lerp = (g: GainNode | null, target: number): void => {
      if (!g) return;
      g.gain.value += (target - g.gain.value) * Math.min(1, dt * 2.5);
    };
    lerp(this.rainGain, rainAmt > 0 ? Math.min(0.13, 0.03 + rainAmt * 0.1) : 0);
    lerp(this.birdsGain, day && rainAmt < 0.3 ? 1 : 0); // birds hush when rain builds
    lerp(this.cricketsGain, night && rainAmt < 0.3 ? 1 : 0);

    // lightning flash → thunder a beat later (the delay sells the distance)
    const flash = this.weather?.mod.flash ?? 0;
    if (flash >= 0.5 && this.prevFlash < 0.5) this.pendingThunder = 0.4 + Math.random() * 1.6;
    this.prevFlash = flash;

    if (this.muted) return;

    if (day) {
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.chirp();
        this.birdT = 1.6 + Math.random() * 3.2;
      }
    }
    if (night) {
      this.cricketT -= dt;
      if (this.cricketT <= 0) {
        this.cricket();
        this.cricketT = 0.7 + Math.random() * 1.1;
      }
    }

    this.whooshT -= dt;
    if (this.whooshT <= 0) {
      this.noiseVoice('bandpass', 700 + Math.random() * 500, 0.8, 0.04, 0.18, 0.55);
      this.whooshT = 4.5 + Math.random() * 7;
    }

    if (this.pendingThunder >= 0) {
      this.pendingThunder -= dt;
      if (this.pendingThunder <= 0) {
        this.noiseVoice('lowpass', 170, 0.7, 0.2, 0.05, 2.1);
        this.pendingThunder = -1;
      }
    }

    if (scene === 'rain' || storm) {
      this.thunderT -= dt;
      if (this.thunderT <= 0) {
        this.noiseVoice('lowpass', 170, 0.7, 0.2, 0.05, 2.1);
        this.thunderT = scene === 'rain' ? 14 + Math.random() * 24 : 20 + Math.random() * 30;
      }
    }

    if (this.city.trains.length > 0) {
      this.hornT -= dt;
      if (this.hornT <= 0) {
        this.horn();
        this.hornT = 38 + Math.random() * 40;
      }
    }
  }
}
