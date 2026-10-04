import { Engine } from '../core/Engine';
import type { Season, WeatherMod, WeatherMode, WeatherState } from '../types';

/**
 * Dynamic weather: a slow-rolling state machine (clear → cloudy → rain →
 * storm) that produces a *modifier* layered on top of whatever time-of-day
 * preset is active. SceneSystem paints the modifier every frame, so a storm
 * can roll through a sunny morning — and clear out again — without ever
 * changing the base scene. In winter the rain modifier becomes snowfall.
 *
 * The modifier object is shared live (attachWeather), so there is no event
 * plumbing to keep in sync — consumers simply read it in their update loop.
 */

type ModBase = Omit<WeatherMod, 'flash' | 'snow'>;

const TARGETS: Record<WeatherState, ModBase> = {
  clear:  { clouds: 0,    gray: 0,    dim: 0,    wet: 0, rain: 0,    tilt: 0 },
  cloudy: { clouds: 0.55, gray: 0.35, dim: 0.25, wet: 0, rain: 0,    tilt: 0 },
  rain:   { clouds: 0.8,  gray: 0.6,  dim: 0.5,  wet: 1, rain: 0.75, tilt: 0.35 },
  storm:  { clouds: 1,    gray: 0.8,  dim: 0.72, wet: 1, rain: 1,    tilt: 1 },
};

/** Weighted next-state picks for the automatic roll of the dice */
const ROLLS: Record<WeatherState, [WeatherState, number][]> = {
  clear:  [['clear', 0.35], ['cloudy', 0.5], ['rain', 0.15]],
  cloudy: [['clear', 0.3], ['cloudy', 0.2], ['rain', 0.4], ['storm', 0.1]],
  rain:   [['clear', 0.15], ['cloudy', 0.3], ['rain', 0.35], ['storm', 0.2]],
  storm:  [['rain', 0.6], ['cloudy', 0.3], ['storm', 0.1]],
};

function pick(table: [WeatherState, number][], r: number): WeatherState {
  let acc = 0;
  for (const [s, w] of table) {
    acc += w;
    if (r <= acc) return s;
  }
  return table[table.length - 1][0];
}

export class WeatherSystem {
  mode: WeatherMode = 'auto';
  state: WeatherState = 'clear'; // last *arrived-at* state
  /** Live modifier — SceneSystem/CitySystem/AudioSystem read it every frame */
  readonly mod: WeatherMod = { clouds: 0, gray: 0, dim: 0, wet: 0, rain: 0, snow: 0, tilt: 0, flash: 0 };

  private engine: Engine;
  private season: () => Season;

  private cur: ModBase = { ...TARGETS.clear }; // live blended values
  private to: ModBase = { ...TARGETS.clear };
  private toState: WeatherState = 'clear';
  private t = 1;     // transition progress (1 = settled)
  private dur = 1;
  private hold = 26; // seconds until the next automatic roll
  private strikeT = 4;
  private reFlash = -1; // pending second lightning strike (double-flash)

  constructor(engine: Engine, season: () => Season) {
    this.engine = engine;
    this.season = season;
    this.hold = 16 + Math.random() * 30; // first auto roll arrives soon-ish
  }

  /** Manual override / back to auto — starts a transition toward the target */
  setMode(mode: WeatherMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode !== 'auto') this.goTo(mode);
    this.hold = 14 + Math.random() * 26;
    this.engine.emit('weatherChanged', { state: this.state, mode: this.mode });
  }

  /** Immediate automatic roll (UI-free entry point; probes use it too) */
  rollNow(): WeatherState {
    if (this.mode !== 'auto') return this.state;
    const next = pick(ROLLS[this.state], Math.random());
    this.goTo(next);
    return next;
  }

  /** Fire a lightning flash — called by the storm scheduler, and by probes */
  strike(): void {
    this.mod.flash = 1;
    this.reFlash = Math.random() < 0.5 ? 0.12 + Math.random() * 0.1 : -1;
  }

  private goTo(next: WeatherState): void {
    if (next === this.state && this.t >= 1) return;
    // `cur` always holds the live raw blend (mod is derived from it), so the
    // new transition simply interpolates from where we are — no jump
    this.to = { ...TARGETS[next] };
    this.toState = next;
    this.t = 0;
    this.dur = 10 + Math.random() * 6;
  }

  update(dt: number): void {
    // --- transition blend ---
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt / this.dur);
      const e = this.t * this.t * (3 - 2 * this.t);
      const L = (a: number, b: number): number => a + (b - a) * e;
      this.cur = {
        clouds: L(this.cur.clouds, this.to.clouds),
        gray: L(this.cur.gray, this.to.gray),
        dim: L(this.cur.dim, this.to.dim),
        wet: L(this.cur.wet, this.to.wet),
        rain: L(this.cur.rain, this.to.rain),
        tilt: L(this.cur.tilt, this.to.tilt),
      };
      if (this.t >= 1) {
        this.state = this.toState;
        this.engine.emit('weatherChanged', { state: this.state, mode: this.mode });
      }
    }

    // --- automatic rolls ---
    if (this.mode === 'auto') {
      this.hold -= dt;
      if (this.hold <= 0) {
        this.rollNow();
        this.hold = 34 + Math.random() * 46;
      }
    }

    // --- lightning: only a fully settled storm cracks if ---
    if (this.state === 'storm' && this.t >= 1) {
      this.strikeT -= dt;
      if (this.strikeT <= 0) {
        this.strike();
        this.strikeT = 5 + Math.random() * 9;
      }
    }
    if (this.reFlash > 0) {
      this.reFlash -= dt;
      if (this.reFlash <= 0) {
        this.mod.flash = Math.max(this.mod.flash, 0.85);
        this.reFlash = -1;
      }
    }
    if (this.mod.flash > 0) this.mod.flash = Math.max(0, this.mod.flash - dt * 5.5);

    // --- derive the live modifier (winter turns rain into snowfall) ---
    const winter = this.season() === 'winter';
    const rain = this.cur.rain;
    this.mod.clouds = this.cur.clouds;
    this.mod.gray = this.cur.gray;
    this.mod.dim = this.cur.dim;
    this.mod.wet = this.cur.wet * (winter ? 0.4 : 1);
    this.mod.rain = winter ? 0 : rain;
    this.mod.snow = winter ? rain : 0;
    this.mod.tilt = winter ? 0 : this.cur.tilt;
  }
}
