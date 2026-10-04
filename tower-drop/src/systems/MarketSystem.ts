import type { Engine } from '../core/Engine';
import type { CitySystem } from './CitySystem';
import type { MarketSave, WeatherState } from '../types';

// ============================================================================
// The City Exchange — an educational stock market for young investors.
//
// Teaching goals (the same list the opening splash screen teaches):
//   shares · buy low / sell high · risk vs reward · diversification ·
//   news moves markets · dividends · patient long-term holding · index funds
//
// Design rules inherited from the rest of the game:
//   * own RNG — city.rng is NEVER touched, so the generated grid stays
//     byte-identical to before this feature existed
//   * its own private market news feed — city.news is never written to
//     (the newspaper assertions in the probes stay valid)
//   * money is a separate $1,000 allowance — the city treasury is untouched
// ============================================================================

export interface StockDef {
  id: string;
  icon: string;
  name: string;
  sector: string;
  blurb: string;
  /** fair value the price is pulled back towards (mean reversion) */
  base: number;
  /** per-tick noise — the "risk" of the stock */
  vol: number;
  risk: 'Low' | 'Medium' | 'High';
  /** fraction of value paid out on every dividend run (0 = growth stock) */
  div: number;
}

export interface StockState extends StockDef {
  price: number;
  /** today's opening price — drives the coloured change badge */
  open: number;
  /** decaying shock left over from a news event */
  impulse: number;
  hist: number[];
  shares: number;
  avg: number;
  /** seconds this position has been held (the "be patient" lesson) */
  holdT: number;
}

export interface MarketLine {
  day: number;
  text: string;
}

export interface TradeResult {
  ok: boolean;
  msg: string;
}

export interface LessonDef {
  id: string;
  icon: string;
  label: string;
}

/** Six things a player should walk away knowing how to do */
export const LESSONS: LessonDef[] = [
  { id: 'buy', icon: '🛒', label: 'Buy your first shares' },
  { id: 'diversify', icon: '🧺', label: 'Own 3 companies at once' },
  { id: 'profit', icon: '💵', label: 'Sell a trade at a profit' },
  { id: 'dividend', icon: '🪙', label: 'Collect a dividend' },
  { id: 'index', icon: '🏙️', label: 'Buy the City Index fund' },
  { id: 'hold', icon: '⏳', label: 'Hold one for a whole day' },
];

/** Eight fictional, kid-friendly companies spread across sectors and risks */
const DEFS: StockDef[] = [
  { id: 'burger', icon: '🍔', name: 'Burger Barn', sector: 'FOOD',
    blurb: 'Burgers and fries — people still eat when it rains.',
    base: 24, vol: 0.011, risk: 'Low', div: 0.012 },
  { id: 'powervolt', icon: '⚡', name: 'PowerVolt', sector: 'POWER',
    blurb: 'Keeps the lights on. Slow, steady, pays the biggest dividends.',
    base: 19, vol: 0.013, risk: 'Low', div: 0.016 },
  { id: 'kidbank', icon: '🏦', name: 'KidBank', sector: 'BANK',
    blurb: 'Saves and lends money — moves gently with the city.',
    base: 30, vol: 0.014, risk: 'Low', div: 0.014 },
  { id: 'metro', icon: '🚌', name: 'Metro Transit', sector: 'TRANSIT',
    blurb: 'Buses and trams. Clear roads mean happy profits.',
    base: 27, vol: 0.019, risk: 'Medium', div: 0.010 },
  { id: 'greenleaf', icon: '🌿', name: 'GreenLeaf Energy', sector: 'CLEAN',
    blurb: 'Wind and solar. Cleaner air is bigger business.',
    base: 33, vol: 0.021, risk: 'Medium', div: 0.008 },
  { id: 'brick', icon: '🧱', name: 'BrickWorks', sector: 'BUILD',
    blurb: 'Builds the city — construction booms keep the crews busy.',
    base: 36, vol: 0.026, risk: 'Medium', div: 0.006 },
  { id: 'pixel', icon: '🎮', name: 'Pixel Play', sector: 'TECH',
    blurb: 'Games and consoles — loved by kids, jumpy by nature.',
    base: 42, vol: 0.034, risk: 'High', div: 0.003 },
  { id: 'star', icon: '🚀', name: 'Star Rockets', sector: 'SPACE',
    blurb: 'Rockets to the moon. Huge swings up… and down. Pays no dividend.',
    base: 58, vol: 0.045, risk: 'High', div: 0 },
];

/**
 * "News moves the market": real city notices nudge the sectors they touch.
 * The impulse decays over the next few ticks, so prices jump then settle.
 */
interface Reaction {
  re: RegExp;
  up?: string[];
  down?: string[];
  text: string;
}

const REACTIONS: Reaction[] = [
  { re: /Fire breaks out/, up: ['brick'], down: ['metro'],
    text: '🔥 Fire! BrickWorks braces for a rebuild boom while Metro Transit detours.' },
  { re: /Fire extinguished/, up: ['brick'],
    text: '✅ Fire out — the rebuilding starts and BrickWorks climbs.' },
  { re: /Power restored/, up: ['pixel', 'powervolt'],
    text: '🔌 Power is back on — Pixel Play and PowerVolt bounce up.' },
  { re: /Power outage/, up: ['greenleaf'], down: ['pixel', 'powervolt'],
    text: '⚡ Blackout! Pixel Play and PowerVolt slide while GreenLeaf backup power jumps.' },
  { re: /Street festival/, up: ['burger', 'pixel'],
    text: '🎪 Festival crowds fill the park — Burger Barn and Pixel Play race higher.' },
  { re: /Festival wrapped/, down: ['burger', 'pixel'],
    text: '🎪 The fair is over — Burger Barn and Pixel Play settle back down.' },
  { re: /broke down|Towed away/, down: ['metro'],
    text: '🚚 Breakdowns snarl the roads — Metro Transit slips.' },
  { re: /Building complete/, up: ['brick'],
    text: '🏢 A new building is finished — BrickWorks shares climb.' },
  { re: /Milestone:/, up: ['star', 'brick', 'kidbank'],
    text: '🏆 A city milestone is reached — investors cheer and Star Rockets, BrickWorks and KidBank rise.' },
  { re: /Hazardous smog|Smog warning/, up: ['greenleaf'], down: ['powervolt'],
    text: '😷 Smog alert — the city wants cleaner air: GreenLeaf jumps, PowerVolt falls.' },
  { re: /smoggy haze/, up: ['greenleaf'], down: ['powervolt'],
    text: '🌫 A hazy haze drifts in — GreenLeaf Energy rises as PowerVolt dips.' },
  { re: /clean breeze|haze is lifting/, up: ['powervolt'], down: ['greenleaf'],
    text: '🌬️ Clear skies return — PowerVolt recovers while GreenLeaf cools off.' },
];

const START_ALLOWANCE = 1000;
/** seconds between price ticks (a "trading round") */
const TICK = 1.2;
/** one whole in-game day of holding unlocks the patience lesson */
const HOLD_SECONDS = 60;
/** seconds between dividend runs */
const DIV_EVERY = 70;
/** a market headline lands roughly this often */
const NEWS_EVERY = 26;
/** don't stack several event headlines on top of each other */
const REACT_COOL = 6;
const FEED_CAP = 40;
const HIST_CAP = 48;

function mulberry32(a: number): () => number {
  let s = a >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const money = (n: number): string => '$' + n.toFixed(2);
const signed = (n: number): string => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
const pct = (a: number, b: number): number => (b <= 0 ? 0 : ((a - b) / b) * 100);
const pctStr = (n: number): string => (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(1) + '%';

export class MarketSystem {
  readonly stocks: StockState[];
  /** personal allowance — deliberately separate from the city treasury */
  cash = START_ALLOWANCE;
  /** trade size used by the Buy / Sell buttons */
  qty = 1;
  indexShares = 0;
  indexAvg = 0;
  indexHold = 0;
  /** recent index prices — sparkline for the City Index row */
  indexHist: number[] = [];
  readonly lessons: Record<string, boolean> = {};
  /** private market feed (never city.news) — trades + market headlines */
  feed: MarketLine[] = [];

  private engine: Engine;
  private city: CitySystem;
  /** own private stream — city.rng must never be consumed by the market */
  private rand: () => number;
  private tickAcc = 0;
  private newsAcc = NEWS_EVERY;
  private divAcc = DIV_EVERY;
  private reactCool = 0;
  private lastDay = 1;

  constructor(engine: Engine, city: CitySystem) {
    this.engine = engine;
    this.city = city;
    // own seed: wall clock mixed with a fresh draw — independent of the city
    this.rand = mulberry32((Date.now() ^ Math.floor(Math.random() * 0x9d3c1)) >>> 0);
    this.stocks = DEFS.map((d) => ({
      ...d,
      price: d.base,
      open: d.base,
      impulse: 0,
      hist: [d.base],
      shares: 0,
      avg: 0,
      holdT: 0,
    }));
    for (const l of LESSONS) this.lessons[l.id] = false;
    this.indexHist = [this.indexPrice()];
    this.lastDay = city.day;
    // reading city events is fine — nothing is ever written back to the city
    engine.on('notice', ({ message }) => this.react(message));
    engine.on('weatherChanged', ({ state }) => this.reactWeather(state));
    this.push('📈 The City Exchange is open — your $1,000 allowance is ready.');
  }

  // =====================================================================
  // Reading the market
  // =====================================================================

  /** Mean of all eight companies — the "whole market at once" index fund */
  indexPrice(): number {
    let sum = 0;
    for (const s of this.stocks) sum += s.price;
    return Math.round((sum / this.stocks.length) * 100) / 100;
  }

  private indexOpen(): number {
    let sum = 0;
    for (const s of this.stocks) sum += s.open;
    return sum / this.stocks.length;
  }

  /** Today's percentage move of the index fund */
  indexChange(): number {
    const o = this.indexOpen();
    return o > 0 ? ((this.indexPrice() - o) / o) * 100 : 0;
  }

  /** Average dividend of the basket, as a fraction of value per run */
  indexDividend(): number {
    let d = 0;
    for (const s of this.stocks) d += s.div;
    return d / this.stocks.length;
  }

  /** Cash + everything owned, marked at today's prices */
  status(): {
    cash: number;
    invested: number;
    total: number;
    gain: number;
    dayChange: number;
    held: number;
  } {
    let invested = 0;
    let openValue = 0;
    let held = 0;
    for (const s of this.stocks) {
      if (s.shares <= 0) continue;
      held++;
      invested += s.shares * s.price;
      openValue += s.shares * s.open;
    }
    if (this.indexShares > 0) {
      held++;
      invested += this.indexShares * this.indexPrice();
      openValue += this.indexShares * this.indexOpen();
    }
    invested = Math.round(invested * 100) / 100;
    const total = Math.round((this.cash + invested) * 100) / 100;
    return {
      cash: Math.round(this.cash * 100) / 100,
      invested,
      total,
      gain: Math.round((total - START_ALLOWANCE) * 100) / 100,
      dayChange: Math.round((invested - openValue) * 100) / 100,
      held,
    };
  }

  /** Biggest slice sitting in a single company (0..1). The index is excluded
   *  from the numerator — it already holds all eight, so it is never "one basket". */
  concentration(): number {
    const st = this.status();
    if (st.invested <= 0) return 0;
    let biggest = 0;
    for (const s of this.stocks) biggest = Math.max(biggest, s.shares * s.price);
    return biggest / st.invested;
  }

  /** How much of the portfolio rides on the diversified index fund */
  indexShareOf(): number {
    const st = this.status();
    if (st.invested <= 0) return 0;
    return (this.indexShares * this.indexPrice()) / st.invested;
  }

  /** The coaching line — always one concrete, teachable next thought */
  coach(): { text: string; tone: 'info' | 'good' | 'warn'; next: string } {
    const st = this.status();
    const next = LESSONS.find((l) => !this.lessons[l.id]);
    const nextLabel = next ? `Next lesson: ${next.icon} ${next.label}` : 'All six lessons complete — you are an investor now! 🎓';
    if (st.held === 0 && st.cash >= START_ALLOWANCE - 0.001) {
      return { tone: 'info', text: '👋 Nothing owned yet — pick a company and press Buy to own a slice of it.', next: nextLabel };
    }
    if (this.indexShareOf() >= 0.5) {
      return { tone: 'good', text: '🏙️ Most of your money sits in the City Index — all 8 companies at once. That is instant diversification.', next: nextLabel };
    }
    if (this.concentration() > 0.7) {
      return { tone: 'warn', text: '🧺 More than 70% of your money sits in ONE company — spread it across 3 or more.', next: nextLabel };
    }
    if (st.held >= 3) {
      return { tone: 'good', text: '✅ Nicely diversified — a bad day for one company will not sink your savings.', next: nextLabel };
    }
    if (st.invested > 0 && st.cash < st.total * 0.1) {
      return { tone: 'warn', text: '💰 Almost fully invested — keep some cash so you can buy bargains later.', next: nextLabel };
    }
    if (st.gain > 60) {
      return { tone: 'good', text: `📈 You are up ${money(st.gain)} — sell a little to lock in a real profit.`, next: nextLabel };
    }
    if (st.gain < -60) {
      return { tone: 'warn', text: `📉 You are down ${money(Math.abs(st.gain))} — prices recover; do not panic-sell at the bottom.`, next: nextLabel };
    }
    return { tone: 'info', text: '📰 Watch the market feed: city news moves prices — buy low, sell high.', next: nextLabel };
  }

  // =====================================================================
  // Trading
  // =====================================================================

  buy(id: string, n = this.qty): TradeResult {
    const s = this.stocks.find((x) => x.id === id);
    if (!s) return this.trade(false, 'That company is not listed.');
    const qty = Math.floor(n);
    if (!Number.isFinite(qty) || qty < 1) return this.trade(false, 'Choose at least 1 share.');
    const cost = s.price * qty;
    if (cost > this.cash + 1e-6) {
      return this.trade(false, `Buying ${qty} would cost ${money(cost)} — you only have ${money(this.cash)}.`);
    }
    const wasEmpty = s.shares <= 0;
    this.cash -= cost;
    s.avg = (s.avg * s.shares + cost) / (s.shares + qty);
    s.shares += qty;
    if (wasEmpty) s.holdT = 0;
    this.learn('buy');
    this.checkDiversify();
    this.push(`🛒 You bought ${qty} ${s.icon} ${s.name} share${qty > 1 ? 's' : ''} at ${money(s.price)}.`);
    this.emit();
    return this.trade(true, `Bought ${qty} ${s.icon} ${s.name} for ${money(cost)}`);
  }

  sell(id: string, n = this.qty): TradeResult {
    const s = this.stocks.find((x) => x.id === id);
    if (!s) return this.trade(false, 'That company is not listed.');
    const qty = Math.floor(n);
    if (!Number.isFinite(qty) || qty < 1) return this.trade(false, 'Choose at least 1 share.');
    if (qty > s.shares) return this.trade(false, `You only own ${s.shares} ${s.icon} ${s.name} share${s.shares === 1 ? '' : 's'}.`);
    const proceeds = s.price * qty;
    const basis = s.avg * qty;
    this.cash += proceeds;
    s.shares -= qty;
    if (s.shares <= 0) {
      s.shares = 0;
      s.avg = 0;
      s.holdT = 0;
    }
    const gain = proceeds - basis;
    if (gain > 0) this.learn('profit');
    this.checkDiversify();
    this.push(
      `📉 You sold ${qty} ${s.icon} ${s.name} at ${money(s.price)} for ${money(proceeds)} (${signed(gain)}).`
    );
    this.emit();
    return this.trade(true, `Sold ${qty} ${s.icon} ${s.name} — ${signed(gain)} versus what you paid`);
  }

  buyIndex(n = this.qty): TradeResult {
    const qty = Math.floor(n);
    const price = this.indexPrice();
    if (!Number.isFinite(qty) || qty < 1) return this.trade(false, 'Choose at least 1 unit.');
    const cost = price * qty;
    if (cost > this.cash + 1e-6) {
      return this.trade(false, `The Index costs ${money(cost)} — you only have ${money(this.cash)}.`);
    }
    const wasEmpty = this.indexShares <= 0;
    this.cash -= cost;
    this.indexAvg = (this.indexAvg * this.indexShares + cost) / (this.indexShares + qty);
    this.indexShares += qty;
    if (wasEmpty) this.indexHold = 0;
    this.learn('index');
    this.checkDiversify();
    this.push(`🏙️ You bought ${qty} City Index unit${qty > 1 ? 's' : ''} at ${money(price)} — all 8 companies in one.`);
    this.emit();
    return this.trade(true, `Bought ${qty} City Index for ${money(cost)}`);
  }

  sellIndex(n = this.qty): TradeResult {
    const qty = Math.floor(n);
    if (!Number.isFinite(qty) || qty < 1) return this.trade(false, 'Choose at least 1 unit.');
    if (qty > this.indexShares) return this.trade(false, `You only own ${this.indexShares} index units.`);
    const price = this.indexPrice();
    const proceeds = price * qty;
    const gain = proceeds - this.indexAvg * qty;
    this.cash += proceeds;
    this.indexShares -= qty;
    if (this.indexShares <= 0) {
      this.indexShares = 0;
      this.indexAvg = 0;
      this.indexHold = 0;
    }
    if (gain > 0) this.learn('profit');
    this.checkDiversify();
    this.push(`📉 You sold ${qty} City Index unit${qty > 1 ? 's' : ''} for ${money(proceeds)} (${signed(gain)}).`);
    this.emit();
    return this.trade(true, `Sold ${qty} City Index — ${signed(gain)} versus what you paid`);
  }

  /** Fresh start: sell everything and return to the $1,000 allowance */
  reset(): void {
    this.cash = START_ALLOWANCE;
    this.indexShares = 0;
    this.indexAvg = 0;
    this.indexHold = 0;
    for (const s of this.stocks) {
      s.shares = 0;
      s.avg = 0;
      s.holdT = 0;
    }
    this.push('↺ Portfolio reset — you are back to your $1,000 allowance.');
    this.emit();
  }

  private trade(ok: boolean, msg: string): TradeResult {
    return { ok, msg };
  }

  private checkDiversify(): void {
    const st = this.status();
    if (st.held >= 3) this.learn('diversify');
  }

  private learn(id: string): void {
    if (this.lessons[id]) return;
    const l = LESSONS.find((x) => x.id === id);
    if (!l) return;
    this.lessons[id] = true;
    this.push(`📚 Lesson complete: ${l.icon} ${l.label}`);
    this.emit();
  }

  // =====================================================================
  // Simulation
  // =====================================================================

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.reactCool = Math.max(0, this.reactCool - dt);

    this.tickAcc += dt;
    let ticked = false;
    while (this.tickAcc >= TICK) {
      this.tickAcc -= TICK;
      this.tickPrices();
      ticked = true;
    }

    // patience: a position held for a whole city day completes that lesson
    for (const s of this.stocks) {
      if (s.shares <= 0) continue;
      s.holdT += dt;
      if (s.holdT >= HOLD_SECONDS) this.learn('hold');
    }
    if (this.indexShares > 0) {
      this.indexHold += dt;
      if (this.indexHold >= HOLD_SECONDS) this.learn('hold');
    }

    // a new in-game day re-bases the change badges
    const day = this.city.day;
    if (day !== this.lastDay) {
      this.lastDay = day;
      for (const s of this.stocks) s.open = s.price;
      this.push(`🔔 Day ${day} opens — the City Index stands at ${money(this.indexPrice())}.`);
      ticked = true;
    }

    this.divAcc -= dt;
    if (this.divAcc <= 0) {
      this.divAcc = DIV_EVERY;
      this.payDividends();
      ticked = true;
    }

    this.newsAcc -= dt;
    if (this.newsAcc <= 0) {
      this.newsAcc = NEWS_EVERY + this.rand() * 14;
      this.ambientHeadline();
      ticked = true;
    }

    if (ticked) this.emit();
  }

  /** One trading round: pull toward fair value + noise + any news shock */
  private tickPrices(): void {
    for (const s of this.stocks) {
      const dev = (s.base - s.price) / s.base;
      const move = dev * 0.03 + this.gauss() * s.vol + s.impulse;
      const next = s.price * (1 + move);
      s.price = Math.round(Math.max(s.base * 0.35, Math.min(s.base * 2.6, next)) * 100) / 100;
      s.impulse *= 0.55;
      if (Math.abs(s.impulse) < 0.0015) s.impulse = 0;
      s.hist.push(s.price);
      if (s.hist.length > HIST_CAP) s.hist.shift();
    }
    this.indexHist.push(this.indexPrice());
    if (this.indexHist.length > HIST_CAP) this.indexHist.shift();
  }

  private payDividends(): void {
    let paid = 0;
    for (const s of this.stocks) {
      if (s.shares <= 0 || s.div <= 0) continue;
      const amt = s.shares * s.price * s.div;
      if (!(amt > 0)) continue;
      this.cash += amt;
      paid += amt;
      this.push(`🪙 ${s.icon} ${s.name} paid ${money(amt)} in dividends — part-owners get paid just for holding.`);
      this.learn('dividend');
    }
    if (this.indexShares > 0) {
      let avgDiv = 0;
      for (const s of this.stocks) avgDiv += s.div;
      avgDiv /= this.stocks.length;
      const amt = this.indexShares * this.indexPrice() * avgDiv;
      if (amt > 0) {
        this.cash += amt;
        paid += amt;
        this.push(`🪙 Your City Index paid ${money(amt)} — the whole market shares its profits.`);
        this.learn('dividend');
      }
    }
    if (paid > 0) this.emit();
  }

  /** Ambient market copy that quietly repeats the lessons */
  private ambientHeadline(): void {
    let best = this.stocks[0];
    let worst = this.stocks[0];
    let bestPct = -Infinity;
    let worstPct = Infinity;
    let rising = 0;
    for (const s of this.stocks) {
      const p = pct(s.price, s.open);
      if (p > bestPct) { bestPct = p; best = s; }
      if (p < worstPct) { worstPct = p; worst = s; }
      if (s.price >= s.open) rising++;
    }
    const roll = this.rand();
    if (bestPct > 1.5) {
      this.push(`🚀 ${best.icon} ${best.name} leads the market today, ${pctStr(bestPct)}.`);
    } else if (worstPct < -1.5) {
      this.push(`📉 ${worst.icon} ${worst.name} is the day's loser at ${pctStr(worstPct)} — buyers are waiting.`);
    } else if (roll < 0.3) {
      this.push(`📈 The City Index is trading at ${money(this.indexPrice())} — ${rising} of 8 companies are up today.`);
    } else if (roll < 0.6) {
      this.push('🧺 Reminder: spreading your money across companies lowers the risk.');
    } else if (roll < 0.8) {
      this.push('⏳ Time in the market beats rushing — patient investors ride out the wobbles.');
    } else {
      this.push('📰 Traders are watching the city desk for the next headline.');
    }
  }

  // =====================================================================
  // News → prices
  // =====================================================================

  /** A real city notice just fired — nudge the sectors it touches */
  react(message: string): void {
    for (const r of REACTIONS) {
      if (!r.re.test(message)) continue;
      this.nudge(r.up, 0.03);
      this.nudge(r.down, -0.03);
      if (this.reactCool <= 0) {
        this.reactCool = REACT_COOL;
        this.push(r.text);
      }
      this.emit();
      return;
    }
  }

  private reactWeather(state: WeatherState): void {
    if (state === 'storm') {
      this.nudge(['metro', 'star'], -0.03);
      this.nudge(['burger'], 0.015);
      this.announce('⛈ A storm rolls in — Metro Transit and Star Rockets are hit while Burger Barn holds up.');
    } else if (state === 'rain') {
      this.nudge(['metro'], -0.015);
      this.announce('🌧 Rain slows the whole city — Metro Transit eases back.');
    } else if (state === 'clear') {
      this.nudge(['metro'], 0.015);
      this.nudge(['greenleaf'], 0.01);
      this.announce('☀️ Sunshine returns — Metro Transit and GreenLeaf pick up.');
    } else if (state === 'cloudy') {
      this.nudge(['greenleaf'], -0.008);
      this.announce('☁️ Grey skies over the city — GreenLeaf solar farms produce less.');
    }
  }

  private nudge(ids: string[] | undefined, amount: number): void {
    if (!ids) return;
    for (const id of ids) {
      const s = this.stocks.find((x) => x.id === id);
      if (!s) continue;
      s.impulse = Math.max(-0.08, Math.min(0.08, s.impulse + amount));
    }
  }

  private announce(text: string): void {
    if (this.reactCool > 0) return;
    this.reactCool = REACT_COOL;
    this.push(text);
    this.emit();
  }

  private gauss(): number {
    let u = 0;
    let v = 0;
    while (u === 0) u = this.rand();
    while (v === 0) v = this.rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // =====================================================================
  // Feed & plumbing
  // =====================================================================

  /** Add a line to the PRIVATE market feed (city.news is never touched) */
  private push(text: string): void {
    this.feed.unshift({ day: this.city.day, text });
    if (this.feed.length > FEED_CAP) this.feed.pop();
  }

  private emit(): void {
    this.engine.emit('marketUpdated', {});
  }

  // =====================================================================
  // Save / load
  // =====================================================================

  serialize(): MarketSave {
    const shares: Record<string, { n: number; avg: number; hold: number }> = {};
    for (const s of this.stocks) {
      if (s.shares > 0) shares[s.id] = { n: s.shares, avg: Math.round(s.avg * 100) / 100, hold: Math.round(s.holdT) };
    }
    return {
      cash: Math.round(this.cash * 100) / 100,
      index: this.indexShares,
      indexAvg: Math.round(this.indexAvg * 100) / 100,
      indexHold: Math.round(this.indexHold),
      shares,
      lessons: LESSONS.filter((l) => this.lessons[l.id]).map((l) => l.id),
    };
  }

  /** Absent key (an older save) restores a clean, fresh portfolio */
  restore(s?: MarketSave): void {
    this.cash = START_ALLOWANCE;
    this.indexShares = 0;
    this.indexAvg = 0;
    this.indexHold = 0;
    for (const st of this.stocks) {
      st.shares = 0;
      st.avg = 0;
      st.holdT = 0;
    }
    for (const l of LESSONS) this.lessons[l.id] = false;
    if (!s) return;
    if (typeof s.cash === 'number' && Number.isFinite(s.cash) && s.cash >= 0) this.cash = s.cash;
    if (typeof s.index === 'number' && s.index > 0) {
      this.indexShares = Math.floor(s.index);
      this.indexAvg = typeof s.indexAvg === 'number' && s.indexAvg > 0 ? s.indexAvg : this.indexPrice();
      this.indexHold = typeof s.indexHold === 'number' ? s.indexHold : 0;
    }
    if (s.shares) {
      for (const st of this.stocks) {
        const rec = s.shares[st.id];
        if (!rec || typeof rec.n !== 'number' || !(rec.n > 0)) continue;
        st.shares = Math.floor(rec.n);
        st.avg = typeof rec.avg === 'number' && rec.avg > 0 ? rec.avg : st.base;
        st.holdT = typeof rec.hold === 'number' && rec.hold > 0 ? rec.hold : 0;
      }
    }
    if (Array.isArray(s.lessons)) {
      for (const id of s.lessons) if (id in this.lessons) this.lessons[id] = true;
    }
    this.push('📂 Portfolio restored from your save.');
    this.emit();
  }
}
