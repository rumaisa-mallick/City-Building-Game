import type { Object3D } from 'three';
import type { CityStats, ToolId, BuildingStyle, TreeType, SceneId, ZoneType, WeatherMode, WeatherState, PlacedRecord } from '../types';
import { ZONE_NAMES, COSTS, MAP_ARCHETYPES, costBuilding, refundOfKind, TOOL_NAMES } from '../types';
import { UPKEEP } from '../systems/CitySystem';
import type { MapArchetype } from '../types';
import { Engine } from '../core/Engine';
import { CitySystem } from '../systems/CitySystem';
import { BuildSystem } from '../systems/BuildSystem';
import { SceneSystem, SCENES } from '../systems/SceneSystem';
import { AudioSystem } from '../systems/AudioSystem';
import type { WeatherSystem } from '../systems/WeatherSystem';
import { saveCity, loadCity } from '../systems/SaveSystem';
import type { Person } from '../entities/Person';
import { MarketSystem, LESSONS } from '../systems/MarketSystem';
import { ico } from './icons';
import { attachDirectionCursor } from './DirectionCursor';
import type { TradeResult } from '../systems/MarketSystem';

/** localStorage flag: the tip toast after dismiss only greets a brand new player */
const SPLASH_KEY = 'city-builder-splash-v1';
/** pseudo-ticker id used by the index-fund row */
const INDEX_ID = '__index__';

/** Whole-dollar money label shared by the shop, budget and selection card */
const money0 = (n: number): string => '$' + n.toLocaleString();

/**
 * The eight ideas the splash screen teaches before the exchange opens.
 * They are also the six checkboxes shown inside the exchange panel.
 */
const CONCEPTS: Array<{ icon: string; term: string; text: string }> = [
  { icon: '🧩', term: 'Shares',
    text: 'A share is one tiny slice of a company. Buy 3 shares and you own 3 slices of it.' },
  { icon: '📉📈', term: 'Buy low, sell high',
    text: 'Prices wobble every second. You earn money by selling for more than you paid.' },
  { icon: '⚖️', term: 'Risk vs reward',
    text: '🚀 Star Rockets can leap or crash. 🍔 Burger Barn barely moves — safer grows slower.' },
  { icon: '🧺', term: 'Diversify',
    text: 'Never put everything in one company. Spread across 3 or more and one bad day cannot sink you.' },
  { icon: '📰', term: 'News moves markets',
    text: 'Fires, storms, festivals and milestones shove prices around — watch the market feed.' },
  { icon: '🪙', term: 'Dividends',
    text: 'Part-owners get a slice of the profits just for holding, even when the price sits still.' },
  { icon: '⏳', term: 'Be patient',
    text: 'Hold an investment for a whole city day instead of a few seconds. Waiting beats rushing.' },
  { icon: '🏙️', term: 'Index funds',
    text: 'Cannot pick a winner? The City Index buys all 8 companies at once — instant spread.' },
];

/** Weather button: mode cycle order + labels + auto-transition toasts */
const WEATHER_ORDER: WeatherMode[] = ['auto', 'clear', 'cloudy', 'rain', 'storm'];
const WEATHER_LABEL: Record<WeatherMode, string> = {
  auto: '⛅ Auto', clear: '☀️ Clear', cloudy: '☁️ Cloudy', rain: '🌧 Rain', storm: '⛈ Storm',
};
// The label table doubles as toast copy, so it stays plain text; the button pulls
// its glyph from this separate map. Module scope rather than local to buildUI:
// the weatherChanged listener rewrites the same label later and would otherwise
// have no icon to re-emit (assigning textContent there silently killed the <svg>).
const WEATHER_IC: Record<string, string> = {
  auto: 'weather', clear: 'day', cloudy: 'cloud', rain: 'rain', storm: 'storm',
};
const WEATHER_TOAST: Record<WeatherState, string> = {
  clear: '☀️ Skies clearing', cloudy: '☁️ Clouds rolling in',
  rain: '🌧 Rain moving in', storm: '⛈ Storm overhead',
};

const TOOL_UI: Array<{ tool: ToolId; icon: string; name: string; hot: number | null }> = [
  { tool: 'building', icon: 'building', name: 'Building', hot: 1 },
  { tool: 'tree', icon: 'tree', name: 'Tree', hot: 2 },
  { tool: 'bush', icon: 'bush', name: 'Bush', hot: 3 },
  { tool: 'grass', icon: 'grass', name: 'Grass', hot: 4 },
  { tool: 'flower', icon: 'flower', name: 'Flower', hot: 5 },
  { tool: 'person', icon: 'person', name: 'Person', hot: 6 },
  { tool: 'car', icon: 'car', name: 'Car', hot: 7 },
  { tool: 'lamp', icon: 'lamp', name: 'Lamp', hot: 8 },
  { tool: 'bulldoze', icon: 'bulldoze', name: 'Bulldoze', hot: 9 },
  { tool: 'select', icon: 'select', name: 'Select', hot: null },
  { tool: 'zone', icon: 'zone', name: 'Zone', hot: null },
  { tool: 'bench', icon: 'bench', name: 'Bench', hot: null },
  { tool: 'fountain', icon: 'fountain', name: 'Fountain', hot: null },
  { tool: 'hospital', icon: 'hospital', name: 'Hospital', hot: null },
  { tool: 'grocery', icon: 'grocery', name: 'Grocery', hot: null },
  { tool: 'playground', icon: 'playground', name: 'Playground', hot: null },
  { tool: 'firestation', icon: 'firestation', name: 'Fire Station', hot: null },
  { tool: 'police', icon: 'police', name: 'Police Station', hot: null },
  { tool: 'busStop', icon: 'busStop', name: 'Bus Stop', hot: null },
  { tool: 'train', icon: 'train', name: 'Train', hot: null },
  { tool: 'dog', icon: 'dog', name: 'Dog', hot: null },
  { tool: 'cat', icon: 'cat', name: 'Cat', hot: null },
  { tool: 'duck', icon: 'duck', name: 'Duck', hot: null },
  { tool: 'cow', icon: 'cow', name: 'Cow', hot: null },
  { tool: 'snowman', icon: 'snowman', name: 'Snowman', hot: null },
];

const SIZES: Record<string, [number, number]> = {
  S: [8, 9],
  M: [11, 12],
  L: [15, 14],
};

/** The shop's one-line pitch for each item — what it does for the city */
const SHOP_DESC: Partial<Record<ToolId, string>> = {
  building: 'Homes and offices — more floors means more rent income.',
  tree: 'Cleans the air: every tree nudges the AQI chip down.',
  bush: 'Cheap greenery that still helps the air.',
  grass: 'The cheapest way to green an empty patch.',
  flower: 'A pop of colour for almost nothing.',
  person: 'A new resident — more residents means more tax.',
  car: 'Adds traffic: income rises, and so does pollution.',
  lamp: 'Streets stay lit at night for a small upkeep.',
  bench: 'Somewhere to sit. Tiny upkeep, lovely detail.',
  fountain: 'A plaza centrepiece that costs a little to run.',
  hospital: 'Cares for residents — big upkeep, big civic value.',
  grocery: 'Keeps a neighbourhood supplied and taxable.',
  playground: 'Families love it — lovely beside homes.',
  train: 'Fast transit round the loop. Costly to run.',
  dog: 'A wagging tail on four legs.',
  cat: 'Naps in the sun and patrols the pavements.',
  duck: 'Paddles about the park pond.',
  cow: 'Moo. Lives out by the fields.',
  busStop: 'A waiting shelter to tidy up the network.',
  firestation: 'Ready for storms and accidents.',
  police: 'Keeps the streets calm and orderly.',
  snowman: 'Winter only — it will not survive a warm season.',
  zone: 'Paint a whole block: zones decide what gets built.',
};

export class UISystem {
  private root: HTMLElement;
  private engine: Engine;
  private city: CitySystem;
  private build: BuildSystem;
  private sceneSys: SceneSystem;

  private statsEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private floorsVal!: HTMLElement;
  private selPanel!: HTMLElement;
  private selTitle!: HTMLElement;
  private audio: AudioSystem;
  private weather: WeatherSystem;
  private wxBtn: HTMLElement | null = null;

  // budget panel (built in buildUI before any cityUpdated arrives)
  private budPanel!: HTMLElement;
  private budSlider!: HTMLInputElement;
  private budTaxVal!: HTMLElement;
  private budSources!: HTMLElement;
  private budUpkeep!: HTMLElement;
  private budNet!: HTMLElement;
  private budBtn!: HTMLElement;

  // pause overlay + goals panel (meta layer)
  private pauseEl!: HTMLElement;
  private volNum!: HTMLElement;
  private photoCb!: HTMLInputElement;
  private muteBtn: HTMLElement | null = null;
  private goalsPanel!: HTMLElement;
  private goalsBody!: HTMLElement;
  private goalBtn!: HTMLElement;

  // newspaper panel (news) + selection card body
  private newsPanel!: HTMLElement;
  private newsBody!: HTMLElement;
  private newsBtn!: HTMLElement;
  private selBody!: HTMLElement;

  // map archetype picker (🗺 panel)
  private mapPanel!: HTMLElement;
  private mapCards!: HTMLElement;
  private mapBtn!: HTMLElement;
  private pendingArch: MapArchetype = 'grid';

  // underground cutaway button (tools rail → VIEW, hotkey X)
  private cutBtn!: HTMLElement;

  // educational stock exchange: entry button sits inside the budget panel
  private market: MarketSystem;
  private stocksPanel!: HTMLElement;
  private stocksBtn!: HTMLElement;
  private stocksWallet!: HTMLElement;
  private stocksRows!: HTMLElement;
  private stocksCoach!: HTMLElement;
  private stocksLessons!: HTMLElement;
  private stocksFeed!: HTMLElement;
  private stocksQty!: HTMLElement;
  /** comma-joined lesson ids at last render — used to toast fresh lessons */
  private lastLessons = '';

  // educational splash screen (first visit only)
  private splashEl!: HTMLElement;
  private splashGone = false;

  // city shop: buy objects with visible prices, or resell them for cash
  private shopPanel!: HTMLElement;
  private shopBtn!: HTMLElement;
  private shopWallet!: HTMLElement;
  private shopList!: HTMLElement;
  private shopTabsEl!: HTMLElement;
  private shopTab: 'buy' | 'sell' = 'buy';
  /** live price badge inside each tool-rail button, keyed by tool id */
  private toolCostEls = new Map<string, HTMLElement>();

  // selection card extras: what it cost, its upkeep, what it sells for
  private selMeta!: HTMLElement;
  private selSell!: HTMLElement;

  /** top-actions bar — right-rail panels park below it (wraps at small sizes) */
  private actionsEl!: HTMLElement;

  constructor(
    root: HTMLElement,
    engine: Engine,
    city: CitySystem,
    build: BuildSystem,
    sceneSys: SceneSystem,
    audio: AudioSystem,
    weather: WeatherSystem,
    market: MarketSystem
  ) {
    this.root = root;
    this.engine = engine;
    this.city = city;
    this.build = build;
    this.sceneSys = sceneSys;
    this.audio = audio;
    this.weather = weather;
    this.market = market;
    this.buildUI();
    attachDirectionCursor();

    engine.on('cityUpdated', ({ stats }) => {
      this.renderStats(stats);
      this.renderBudget();
      if (!this.goalsPanel.classList.contains('hidden')) this.renderGoals();
      if (!this.shopPanel.classList.contains('hidden')) this.renderShop(); // wallet + affordability
    });
    engine.on('sceneChanged', ({ scene }) => this.highlightScene(scene));
    engine.on('notice', ({ message }) => {
      this.toast(message);
      this.syncSellMode(); // Esc / right-click can turn resell mode off from outside
    });
    engine.on('selectionChanged', ({ obj }) => this.renderSelection(obj));
    engine.on('newsUpdated', () => {
      if (!this.newsPanel.classList.contains('hidden')) this.renderNews();
    });
    engine.on('marketUpdated', () => {
      if (!this.stocksPanel.classList.contains('hidden')) this.renderStocks();
    });
    engine.on('pauseRequested', () => this.togglePause());
    engine.on('gameStateChanged', ({ state }) => {
      this.pauseEl.classList.toggle('hidden', state !== 'paused');
    });
    engine.on('weatherChanged', ({ state, mode }) => {
      // innerHTML, never textContent: textContent replaces the whole child list,
      // which destroyed the inline SVG and left a bare emoji label behind.
      if (this.wxBtn) this.wxBtn.innerHTML = `${ico(WEATHER_IC[mode] ?? 'weather')} ${WEATHER_LABEL[mode]}`;
      if (mode === 'auto') this.toast(WEATHER_TOAST[state]);
    });
  }

  // =====================================================================
  // Selection panel (select tool)
  // =====================================================================

  private renderSelection(obj: Object3D | null): void {
    if (!obj) {
      this.selPanel.classList.add('hidden');
      // leave the card clean: nothing selected, nothing for sale
      this.selMeta.classList.add('hide');
      this.selSell.classList.add('hide');
      return;
    }
    const kind = (obj.userData.kind as string) || 'object';
    this.selMeta.classList.add('hide');
    this.selSell.classList.add('hide');
    if (kind === 'person') {
      // citizen card: real name + where they're strolling right now
      const p = obj.userData.person as Person | undefined;
      this.selTitle.textContent = `🚶 ${p ? p.name : 'A citizen'}`;
      if (p) {
        const pace = p.speed < 1.45 ? 'strolling' : 'walking briskly';
        this.selBody.textContent =
          `${pace} near ${this.city.placeLabelAt(p.group.position.x, p.group.position.z)}`;
      } else {
        this.selBody.textContent = 'Out and about town';
      }
      this.selBody.classList.remove('hide');
    } else {
      const entry = TOOL_UI.find((t) => t.tool === kind);
      this.selTitle.textContent = `✋ ${entry ? entry.name : TOOL_NAMES[kind as ToolId] ?? kind}`;
      this.selBody.classList.add('hide');

      // what it cost to buy, what it costs to keep, how many you already own
      const rec = obj.userData.record as PlacedRecord | undefined;
      const price = rec?.building ? costBuilding(rec.building) : (COSTS[kind as ToolId] ?? 0);
      const up = UPKEEP[kind] ?? 0;
      const owned = this.city.kindCounts()[kind] ?? 0;
      this.selMeta.innerHTML =
        `<span>💰 ${price > 0 ? money0(price) : 'free'}</span>` +
        (up ? `<span>🔧 ${money0(up)}/min</span>` : '') +
        `<span>📦 ${owned} built</span>`;
      this.selMeta.classList.remove('hide');

      const refund = this.build.refundQuote();
      if (rec && refund > 0) {
        this.selSell.textContent = `💰 Sell ${money0(refund)}`;
        this.selSell.classList.remove('hide');
      }
    }
    this.selPanel.classList.remove('hidden');
  }

  private el(tag: string, cls = '', html = ''): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }

  private buildUI(): void {
    this.root.innerHTML = '';

    // ---------------- top bar ----------------
    const top = this.el('div', 'hud-top');
    top.appendChild(this.el('div', 'brand', `${ico('brand')} CITY&nbsp;BUILDER`));

    this.statsEl = this.el('div', 'stats');
    top.appendChild(this.statsEl);

    const scenes = this.el('div', 'scenes');
    for (const s of SCENES) {
      // s.name ships as "🌅 Morning" — strip the emoji and give the pill a real
      // icon so the switcher shares one visual language with the rest of the chrome
      const b = this.el('button', 'scene-pill', `${ico(s.id)} ${s.name.replace(/^[^\w]+/, '')}`);
      b.dataset.scene = s.id;
      b.addEventListener('click', () => this.sceneSys.apply(s.id));
      scenes.appendChild(b);
    }
    top.appendChild(scenes);

    const actions = this.el('div', 'top-actions');
    this.actionsEl = actions;
    // The bar is three clusters spread across the row — world controls,
    // dashboards, session — not one clump hugging the right edge. That anchors
    // it to both sides (the wallet chips above on the left, the scene pills on
    // the right) and leaves no dead band beside the brand. `cluster` is where
    // every button lands; it is re-pointed as each group starts, so the append
    // sites below read unchanged. The wrappers are plain divs, so
    // `.top-actions button` still resolves to the same 13 buttons.
    const grpWorld = this.el('div', 'act-grp');
    const grpPanels = this.el('div', 'act-grp');
    const grpSession = this.el('div', 'act-grp');
    actions.append(grpWorld, grpPanels, grpSession);
    let cluster = grpWorld;
    const muteBtn = this.btn(this.audio.muted ? ico('soundOff') : ico('sound'), () => {
      this.audio.setMuted(!this.audio.muted);
      muteBtn.innerHTML = this.audio.muted ? ico('soundOff') : ico('sound');
      this.toast(this.audio.muted ? '🔇 Ambience muted' : '🔊 Ambience on');
    });
    muteBtn.classList.add('btn-icon');
    muteBtn.title = 'Toggle ambient sound';
    cluster.appendChild(muteBtn);
    this.muteBtn = muteBtn;

    // HTML labels (icon + word) rather than text: these get swapped on click,
    // so they have to go back through innerHTML or the icon would vanish.
    const SEASON_LABEL: Record<string, string> = {
      spring: `${ico('spring')} Spring`, summer: `${ico('summer')} Summer`,
      autumn: `${ico('autumn')} Autumn`, winter: `${ico('winter')} Winter`,
    };
    const seasonBtn = this.btn(SEASON_LABEL[this.city.season] ?? SEASON_LABEL.summer, () => {
      const s = this.city.cycleSeason();
      seasonBtn.innerHTML = SEASON_LABEL[s] ?? s;
    });
    seasonBtn.title = 'Cycle the season (foliage, ground, petals / leaves)';
    cluster.appendChild(seasonBtn);

    const tlBtn = this.btn(`${ico('timelapse')} Timelapse`, () => {
      const on = this.sceneSys.toggleTimelapse();
      tlBtn.innerHTML = on ? `${ico('stop')} Stop lapse` : `${ico('timelapse')} Timelapse`;
      this.toast(on ? '🎬 Time-lapse running — dawn rises over the eastern ridge' : '⏸ Time-lapse stopped');
    });
    tlBtn.title = 'Roll night → dawn over the mountains → day → sunset on a loop';
    cluster.appendChild(tlBtn);

    const paceBtn = this.btn(`${ico('pace')} ${this.sceneSys.paceSeconds}s`, () => {
      const s = this.sceneSys.cyclePace();
      paceBtn.innerHTML = `${ico('pace')} ${s}s`;
      this.toast(`⏱ Time-lapse pace: ${s}s per phase (dawn runs ${Math.round(s * 1.5)}s)`);
    });
    paceBtn.title = 'Time-lapse duration per phase — 12 / 20 / 40s (dawn is 50% longer)';
    cluster.appendChild(paceBtn);

    const wxBtn = this.btn(`${ico(WEATHER_IC[this.weather.mode] ?? 'weather')} ${WEATHER_LABEL[this.weather.mode]}`, () => {
      const i = WEATHER_ORDER.indexOf(this.weather.mode);
      const next = WEATHER_ORDER[(i + 1) % WEATHER_ORDER.length];
      this.weather.setMode(next);
      wxBtn.innerHTML = `${ico(WEATHER_IC[next] ?? 'weather')} ${WEATHER_LABEL[next]}`;
      this.toast(next === 'auto'
        ? '⛅ Auto weather — clouds, rain and storms roll through on their own'
        : `${WEATHER_LABEL[next]} — holding steady`);
    });
    wxBtn.title = 'Auto weather rolls clear → cloudy → rain → storm; the named modes hold (winter turns rain to snow)';
    wxBtn.dataset.weather = 'btn';
    this.wxBtn = wxBtn;
    cluster.appendChild(wxBtn);

    // ---- cluster 2: the four right-rail dashboards ----
    cluster = grpPanels;
    const budBtn = this.btn(`${ico('budget')} Budget`, () => {
      this.toggleRail(this.budPanel, this.budBtn, () => this.renderBudget());
    });
    budBtn.title = 'Budget: tax rate slider, income sources and service upkeep';
    budBtn.dataset.budget = 'btn';
    this.budBtn = budBtn;
    cluster.appendChild(budBtn);

    const goalBtn = this.btn(`${ico('goals')} Goals`, () => {
      this.toggleRail(this.goalsPanel, this.goalBtn, () => this.renderGoals());
    });
    goalBtn.title = 'Milestones: live progress and one-time cash rewards';
    goalBtn.dataset.goals = 'btn';
    this.goalBtn = goalBtn;
    cluster.appendChild(goalBtn);

    const newsBtn = this.btn(`${ico('news')} News`, () => this.toggleNews());
    newsBtn.title = 'City newspaper: headlines as they happen (N)';
    newsBtn.dataset.news = 'btn';
    this.newsBtn = newsBtn;
    cluster.appendChild(newsBtn);

    const mapBtn = this.btn(`${ico('map')} Map`, () => this.toggleMap());
    mapBtn.title = 'Pick a map archetype, then generate a fresh city in that layout';
    mapBtn.dataset.map = 'btn';
    this.mapBtn = mapBtn;
    cluster.appendChild(mapBtn);

    const panel = this.el('div', 'budget-panel hidden');
    panel.innerHTML = `
      <div class="pn-head">
        <span class="bud-title">${ico('budget')} CITY BUDGET</span>
        <button class="pn-x" title="Close (Esc)">✕</button>
      </div>
      <div class="bud-tax">
        <span>Tax rate</span>
        <input type="range" min="50" max="200" step="5" value="100" />
        <span class="bud-tax-val">100%</span>
      </div>
      <div class="pn-lbl">INCOME</div>
      <div class="bud-rows bud-sources"></div>
      <div class="pn-lbl">UPKEEP</div>
      <div class="bud-rows bud-upkeep"></div>
      <div class="bud-stocks">
        <div class="bud-net"></div>
        <div class="bud-links">
          <button class="btn bud-stk" data-market="btn">${ico('stock')} Stock Exchange</button>
          <button class="btn bud-shop" data-shop="btn" title="Buy objects, or resell what you own">${ico('shop')} Shop</button>
          <button class="btn bud-help" data-learn="btn" title="Re-read the game guide and investing lessons">${ico('learn')} Learn</button>
        </div>
        <span class="bud-stk-hint">Your own $1,000 allowance — learn to invest</span>
      </div>`;
    this.root.appendChild(panel);
    this.budPanel = panel;
    panel.querySelector('.pn-x')?.addEventListener('click', () => this.toggleRail(this.budPanel, this.budBtn));
    this.stocksBtn = panel.querySelector('.bud-stk') as HTMLElement;
    this.stocksBtn.addEventListener('click', () => this.toggleStocks());
    this.shopBtn = panel.querySelector('.bud-shop') as HTMLElement;
    this.shopBtn.addEventListener('click', () => this.toggleShop());
    (panel.querySelector('.bud-help') as HTMLElement).addEventListener('click', () => this.showSplash(true));
    this.budSlider = panel.querySelector('input') as HTMLInputElement;
    this.budTaxVal = panel.querySelector('.bud-tax-val') as HTMLElement;
    this.budSources = panel.querySelector('.bud-sources') as HTMLElement;
    this.budUpkeep = panel.querySelector('.bud-upkeep') as HTMLElement;
    this.budNet = panel.querySelector('.bud-net') as HTMLElement;
    this.budSlider.value = String(Math.round(this.city.taxRate * 100));
    this.budSlider.addEventListener('input', () => {
      this.city.setTaxRate(Number(this.budSlider.value) / 100); // emits cityUpdated → renderBudget
    });
    this.renderBudget();

    const goalsPanel = this.el('div', 'goals-panel hidden');
    goalsPanel.innerHTML = `
      <div class="pn-head">
        <span class="goal-title">${ico('goals')} MILESTONES</span>
        <button class="pn-x" title="Close (Esc)">✕</button>
      </div>
      <div class="goal-rows"></div>`;
    this.root.appendChild(goalsPanel);
    this.goalsPanel = goalsPanel;
    this.goalsBody = goalsPanel.querySelector('.goal-rows') as HTMLElement;
    goalsPanel.querySelector('.pn-x')?.addEventListener('click', () => this.toggleRail(this.goalsPanel, this.goalBtn));

    const newsPanel = this.el('div', 'news-panel hidden');
    newsPanel.innerHTML = `
      <div class="pn-head">
        <span class="news-title">${ico('news')} CITY DESK</span>
        <button class="pn-x" title="Close (Esc)">✕</button>
      </div>
      <div class="pn-lbl">HEADLINES</div>
      <div class="news-rows"></div>`;
    this.root.appendChild(newsPanel);
    this.newsPanel = newsPanel;
    this.newsBody = newsPanel.querySelector('.news-rows') as HTMLElement;
    newsPanel.querySelector('.pn-x')?.addEventListener('click', () => this.toggleRail(this.newsPanel, this.newsBtn));

    const mapPanel = this.el('div', 'map-panel hidden');
    mapPanel.innerHTML = `
      <div class="pn-head">
        <span class="map-title">${ico('map')} CHOOSE A MAP</span>
        <button class="pn-x" title="Close (Esc)">✕</button>
      </div>
      <div class="map-cards"></div>
      <div class="map-lay"></div>`;
    this.root.appendChild(mapPanel);
    this.mapPanel = mapPanel;
    this.mapCards = mapPanel.querySelector('.map-cards') as HTMLElement;
    mapPanel.querySelector('.pn-x')?.addEventListener('click', () => this.toggleRail(this.mapPanel, this.mapBtn));
    const layWrap = mapPanel.querySelector('.map-lay') as HTMLElement;
    layWrap.appendChild(this.btn(`${ico('dice')} Generate this map`, () => this.applyMap()));

    // ---------------- stock exchange (educational market) ----------------
    const stocks = this.el('div', 'stocks-panel hidden');
    stocks.innerHTML = `
      <div class="pn-head">
        <span class="stk-title">${ico('stock')} STOCK EXCHANGE</span>
        <button class="pn-x" title="Close (Esc)">✕</button>
      </div>
      <div class="stk-wallet"></div>
      <div class="stk-qty">
        <span class="stk-qty-lbl">Trade</span>
        <button class="btn btn-mini stk-step stk-down" title="Fewer shares per trade">−</button>
        <b class="stk-qval">1</b>
        <button class="btn btn-mini stk-step stk-up" title="More shares per trade">+</button>
        <button class="btn btn-mini stk-learn" title="Re-read the investing lessons">${ico('learn')} Lessons</button>
      </div>
      <div class="stk-rows"></div>
      <div class="stk-coach"></div>
      <div class="stk-lessons"></div>
      <div class="stk-feed-title">MARKET FEED</div>
      <div class="stk-feed"></div>
      <div class="stk-actions"></div>`;
    this.root.appendChild(stocks);
    this.stocksPanel = stocks;
    stocks.querySelector('.pn-x')?.addEventListener('click', () => this.toggleStocks());
    this.stocksWallet = stocks.querySelector('.stk-wallet') as HTMLElement;
    this.stocksRows = stocks.querySelector('.stk-rows') as HTMLElement;
    this.stocksCoach = stocks.querySelector('.stk-coach') as HTMLElement;
    this.stocksLessons = stocks.querySelector('.stk-lessons') as HTMLElement;
    this.stocksFeed = stocks.querySelector('.stk-feed') as HTMLElement;
    this.stocksQty = stocks.querySelector('.stk-qval') as HTMLElement;
    stocks.querySelector('.stk-down')?.addEventListener('click', () => {
      this.market.qty = Math.max(1, this.market.qty - 1);
      this.renderStocks();
    });
    stocks.querySelector('.stk-up')?.addEventListener('click', () => {
      this.market.qty = Math.min(99, this.market.qty + 1);
      this.renderStocks();
    });
    stocks.querySelector('.stk-learn')?.addEventListener('click', () => this.showSplash(true));
    const stkActions = stocks.querySelector('.stk-actions') as HTMLElement;
    const resetBtn = this.btn('↺ Start over — back to $1,000', () => {
      this.market.reset();
      this.renderStocks();
      this.toast('↺ Portfolio reset to your $1,000 allowance');
    });
    resetBtn.classList.add('stk-reset');
    stkActions.appendChild(resetBtn);

    // ---------------- city shop: buy objects, resell them for cash ----------------
    const shop = this.el('div', 'shop-panel hidden');
    shop.innerHTML = `
      <div class="pn-head">
        <span class="shop-title">${ico('shop')} CITY SHOP</span>
        <button class="pn-x" title="Close (Esc)">✕</button>
      </div>
      <div class="shop-tabs">
        <button class="shop-tab on" data-tab="buy">${ico('cart')} Buy</button>
        <button class="shop-tab" data-tab="sell">${ico('money')} Sell</button>
      </div>
      <div class="shop-wallet"></div>
      <div class="shop-list"></div>`;
    this.root.appendChild(shop);
    this.shopPanel = shop;
    this.shopWallet = shop.querySelector('.shop-wallet') as HTMLElement;
    this.shopList = shop.querySelector('.shop-list') as HTMLElement;
    this.shopTabsEl = shop.querySelector('.shop-tabs') as HTMLElement;
    shop.querySelector('.pn-x')?.addEventListener('click', () => this.toggleShop());
    for (const t of this.shopTabsEl.querySelectorAll<HTMLButtonElement>('.shop-tab')) {
      t.addEventListener('click', () => {
        const next = t.dataset.tab === 'sell' ? 'sell' : 'buy';
        if (next === 'buy') this.stopSelling(); // leaving Sell always ends resell mode
        this.shopTab = next;
        this.renderShop();
      });
    }

    // ---------------- educational splash (first visit) ----------------
    this.buildSplash();

    // ---- cluster 3: session controls ----
    cluster = grpSession;
    const pauseBtn = this.btn(`${ico('pause')} Pause`, () => this.togglePause());
    pauseBtn.title = 'Freeze the city (Esc or P also pause)';
    pauseBtn.dataset.pause = 'btn';
    cluster.appendChild(pauseBtn);

    cluster.appendChild(this.btn(`${ico('save')} Save`, () => this.saveGame()));
    cluster.appendChild(this.btn(`${ico('load')} Load`, () => this.loadGame()));
    cluster.appendChild(this.btn(`${ico('newCity')} New City`, () => this.newCity()));
    top.appendChild(actions);
    this.root.appendChild(top);

    // ---------------- tools panel ----------------
    const tools = this.el('div', 'tools');

    // building params
    const buildSec = this.el('div', 'tool-section');
    buildSec.appendChild(this.el('div', 'sec-title', 'BUILD'));
    buildSec.appendChild(this.el('label', 'field-label', 'Style'));
    const styleSel = this.el('select', 'field') as HTMLSelectElement;
    for (const st of ['glass', 'brick', 'concrete', 'classic', 'warehouse', 'neon'] as BuildingStyle[]) {
      const o = document.createElement('option');
      o.value = st;
      o.textContent = st.charAt(0).toUpperCase() + st.slice(1);
      styleSel.appendChild(o);
    }
    styleSel.value = this.build.params.style;
    styleSel.addEventListener('change', () => {
      this.build.setParams({ style: styleSel.value as BuildingStyle });
      this.build.setTool('building');
      this.highlightTool();
    });
    buildSec.appendChild(styleSel);

    const floorRow = this.el('div', 'field-row');
    floorRow.appendChild(this.el('label', 'field-label', 'Floors'));
    this.floorsVal = this.el('span', 'field-value', String(this.build.params.floors));
    floorRow.appendChild(this.floorsVal);
    buildSec.appendChild(floorRow);
    const floors = this.el('input', 'field') as HTMLInputElement;
    floors.type = 'range';
    floors.min = '1';
    floors.max = '24';
    floors.value = String(this.build.params.floors);
    floors.addEventListener('input', () => {
      this.floorsVal.textContent = floors.value;
      this.build.setParams({ floors: parseInt(floors.value, 10) });
      this.build.setTool('building');
      this.highlightTool();
    });
    buildSec.appendChild(floors);

    const sizeRow = this.el('div', 'field-row');
    sizeRow.appendChild(this.el('label', 'field-label', 'Size*'));
    const sizeSel = this.el('select', 'field field-inline') as HTMLSelectElement;
    for (const k of Object.keys(SIZES)) {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = k;
      sizeSel.appendChild(o);
    }
    sizeSel.value = 'M';
    sizeSel.addEventListener('change', () => {
      const [w, d] = SIZES[sizeSel.value];
      this.build.setParams({ width: w, depth: d });
      this.build.setTool('building');
      this.highlightTool();
    });
    sizeRow.appendChild(sizeSel);
    const dice = this.btn(ico('dice'), () => {
      this.build.setParams({ variant: (this.build.params.variant + 1) % 4 });
      this.build.setTool('building');
      this.highlightTool();
    });
    // icon-only, and ico() marks its SVG aria-hidden — so without this the
    // button has no name at all. It also sits on the Size row, where it reads
    // as part of the size control when it actually cycles the facade.
    dice.title = "Cycle this building's facade variant — same size, a different look";
    dice.setAttribute('aria-label', dice.title);
    dice.classList.add('btn-mini');
    sizeRow.appendChild(dice);
    buildSec.appendChild(sizeRow);
    buildSec.appendChild(this.el('div', 'field-hint', '*Size used outside the road ring'));
    tools.appendChild(buildSec);

    // zoning
    const zoneSec = this.el('div', 'tool-section');
    zoneSec.appendChild(this.el('div', 'sec-title', 'ZONE'));
    const zoneRow = this.el('div', 'field-row');
    zoneRow.appendChild(this.el('label', 'field-label', 'Type'));
    const zoneSel = this.el('select', 'field field-inline') as HTMLSelectElement;
    for (let z = 0; z < ZONE_NAMES.length; z++) {
      const o = document.createElement('option');
      o.value = String(z);
      o.textContent = ZONE_NAMES[z];
      zoneSel.appendChild(o);
    }
    zoneSel.value = String(this.build.zoneType);
    zoneSel.addEventListener('change', () => {
      this.build.zoneType = parseInt(zoneSel.value, 10) as ZoneType;
      this.build.setTool('zone');
      this.highlightTool();
    });
    zoneRow.appendChild(zoneSel);
    zoneSec.appendChild(zoneRow);
    zoneSec.appendChild(
      this.el('div', 'field-hint', `Click a block to zone it ($${COSTS.zone}/block). Zones steer styles + income.`)
    );
    tools.appendChild(zoneSec);

    // tree type
    const natureSec = this.el('div', 'tool-section');
    natureSec.appendChild(this.el('div', 'sec-title', 'ELEMENTS'));
    const grid = this.el('div', 'tool-grid');
    for (const t of TOOL_UI) {
      const b = this.el('button', 'tool-btn');
      b.innerHTML =
        `<span class="tool-ico">${ico(t.icon)}</span>` +
        `<span class="tool-name">${t.name}</span>` +
        `<span class="tool-end">` +
        `<i class="tool-cost"></i>` +
        (t.hot ? `<kbd>${t.hot}</kbd>` : '<kbd class="kbd-empty">·</kbd>') +
        `</span>`;
      b.dataset.tool = t.tool;
      b.addEventListener('click', () => {
        this.build.setTool(t.tool);
        this.highlightTool();
      });
      this.toolCostEls.set(t.tool, b.querySelector('.tool-cost') as HTMLElement);
      grid.appendChild(b);
    }
    natureSec.appendChild(grid);

    const treeRow = this.el('div', 'field-row');
    treeRow.appendChild(this.el('label', 'field-label', 'Tree'));
    const treeSel = this.el('select', 'field field-inline') as HTMLSelectElement;
    for (const tt of ['oak', 'pine', 'birch'] as TreeType[]) {
      const o = document.createElement('option');
      o.value = tt;
      o.textContent = tt.charAt(0).toUpperCase() + tt.slice(1);
      treeSel.appendChild(o);
    }
    treeSel.addEventListener('change', () => {
      this.build.treeType = treeSel.value as TreeType;
      this.build.setTool('tree');
      this.highlightTool();
    });
    treeRow.appendChild(treeSel);
    natureSec.appendChild(treeRow);
    tools.appendChild(natureSec);

    // view controls: underground cutaway
    const viewSec = this.el('div', 'tool-section');
    viewSec.appendChild(this.el('div', 'sec-title', 'VIEW'));
    const cutBtn = this.el('button', 'tool-btn');
    cutBtn.innerHTML =
      `<span class="tool-ico">${ico('pick')}</span>` +
      `<span class="tool-name">Cutaway</span>` +
      `<span class="tool-end"><kbd>X</kbd></span>`;
    cutBtn.dataset.cutaway = 'btn';
    cutBtn.title = 'Slice the street open and expose the metro, pipes and soil (X)';
    cutBtn.addEventListener('click', () => this.toggleCutaway());
    this.cutBtn = cutBtn;
    viewSec.appendChild(cutBtn);
    tools.appendChild(viewSec);

    this.root.appendChild(tools);

    // ---------------- selection panel (select tool) ----------------
    this.selPanel = this.el('div', 'sel-panel hidden');
    this.selTitle = this.el('div', 'sel-title', '');
    this.selPanel.appendChild(this.selTitle);
    this.selBody = this.el('div', 'sel-body hide', '');
    this.selPanel.appendChild(this.selBody);
    this.selMeta = this.el('div', 'sel-meta hide', '');
    this.selPanel.appendChild(this.selMeta);
    const selBtns = this.el('div', 'sel-btns');
    selBtns.appendChild(this.btn('↻ Rotate', () => this.build.selectRotate()));
    this.selSell = this.btn(`${ico('money')} Sell`, () => {
      const refund = this.build.selectSell();
      this.toast(refund > 0 ? `💰 Sold — ${money0(refund)} back in the treasury` : 'Nothing to sell');
    });
    this.selSell.classList.add('sel-sell', 'hide');
    this.selSell.title = 'Resell this object: 50% of its price back (buildings 40%)';
    selBtns.appendChild(this.selSell);
    selBtns.appendChild(this.btn(`${ico('copy')} Duplicate`, () => this.build.selectDuplicate()));
    selBtns.appendChild(this.btn(`${ico('trash')} Delete`, () => this.build.selectDelete()));
    this.selPanel.appendChild(selBtns);
    this.selPanel.appendChild(
      this.el('div', 'sel-hint', 'Click to drop · R / ⇧+drag rotates · Esc cancels')
    );
    this.root.appendChild(this.selPanel);

    // ---------------- toast / help ----------------
    this.toastEl = this.el('div', 'toast');
    this.root.appendChild(this.toastEl);

    // Grouped the same way the action bar is: what you build with, how you look
    // around, and everything that is not either. A single run of thirteen
    // shortcuts forced you to read all thirteen to find one; a label per group
    // lets you skip to the group you need. The separators come from CSS, so the
    // text stays a clean stream for anything that reads it.
    const help = this.el('div', 'help');
    help.innerHTML =
      '<span class="hg"><span class="hl">BUILD</span> ' +
      '<b>Click</b> place · <b>✋ Select</b> pick-up/drop · <b>⇧+drag</b> rotate · ' +
      '<b>R</b>/<b>⇧+scroll</b> 90° · <b>1-9</b> tools · <b>X</b> dig</span>' +
      '<span class="hg"><span class="hl">CAMERA</span> ' +
      '<b>Right-drag</b> orbit · <b>WASD</b> pan · <b>Scroll</b> zoom</span>' +
      '<span class="hg"><span class="hl">SYSTEM</span> ' +
      '<b>Ctrl+Z</b> undo · <b>Ctrl+S</b> save · <b>M</b> scene · <b>N</b> news · ' +
      '<b>F</b> photo · <b>Esc/P</b> pause</span>';
    this.root.appendChild(help);

    // ---------------- pause overlay ----------------
    const pause = this.el('div', 'pause-overlay hidden');
    pause.innerHTML = `
      <div class="pause-card">
        <div class="pause-title">${ico('pause')} Paused</div>
        <div class="pause-sub">The city waits for you</div>
        <div class="pause-btns"></div>
        <div class="pause-set">
          <label class="pause-row">
            <span>Volume</span>
            <input type="range" min="0" max="100" class="pause-vol">
            <b class="pause-volnum">100%</b>
          </label>
          <label class="pause-row">
            <span>Photo mode</span>
            <input type="checkbox" class="pause-photo">
          </label>
        </div>
        <div class="pause-hint">Esc or P resumes · F toggles photo mode</div>
      </div>`;
    const pbtns = pause.querySelector('.pause-btns') as HTMLElement;
    pbtns.appendChild(this.btn(`${ico('play')} Resume`, () => this.togglePause()));
    pbtns.appendChild(this.btn(`${ico('save')} Save`, () => this.saveGame()));
    pbtns.appendChild(this.btn(`${ico('load')} Load`, () => this.loadGame()));
    pbtns.appendChild(this.btn(`${ico('newCity')} New City`, () => {
      this.newCity();
      if (this.engine.state === 'paused') this.engine.setState('playing');
    }));
    // The slider drives the ambience master gain; dragging it while muted
    // would be silent, so it unmutes and flips the top-bar icon in step.
    const vol = pause.querySelector('.pause-vol') as HTMLInputElement;
    this.volNum = pause.querySelector('.pause-volnum') as HTMLElement;
    vol.value = String(Math.round(this.audio.volume * 100));
    this.volNum.textContent = `${vol.value}%`;
    vol.addEventListener('input', () => {
      if (this.audio.muted) {
        this.audio.setMuted(false);
        if (this.muteBtn) this.muteBtn.innerHTML = ico('sound');
      }
      this.audio.setVolume(Number(vol.value) / 100);
      this.volNum.textContent = `${vol.value}%`;
    });
    this.photoCb = pause.querySelector('.pause-photo') as HTMLInputElement;
    this.photoCb.addEventListener('change', () => this.togglePhoto(this.photoCb.checked));
    this.root.appendChild(pause);
    this.pauseEl = pause;

    this.highlightTool();
    this.highlightScene(this.sceneSys.current);
    this.renderStats(this.city.stats());

    // The splash is the title screen: every launch opens on it. Automated runs
    // (headless probes) never see it unprompted, so nothing is ever blocked for
    // them — they call showSplash() directly to inspect it.
    const automated = (navigator as Navigator & { webdriver?: boolean }).webdriver === true;
    if (localStorage.getItem(SPLASH_KEY) === '1') this.splashGone = true;
    if (!automated) this.showSplash();
  }

  private btn(label: string, onClick: () => void): HTMLElement {
    const b = this.el('button', 'btn', label);
    b.addEventListener('click', onClick);
    return b;
  }

  selectDigit(n: number): void {
    const found = TOOL_UI.find((t) => t.hot === n);
    if (found) {
      this.build.setTool(found.tool);
      this.highlightTool();
    }
  }

  private highlightTool(): void {
    this.root.querySelectorAll('.tool-btn').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.tool === this.build.tool);
    });
    this.refreshToolCosts(); // the building's price moves with floors / size
  }

  /**
   * Price tags on the tool rail — the live cost, turned red the moment the
   * treasury cannot cover it, plus a tooltip spelling out upkeep.
   */
  private refreshToolCosts(): void {
    const money = this.city.money;
    for (const t of TOOL_UI) {
      const el = this.toolCostEls.get(t.tool);
      if (!el) continue;
      const c = this.build.toolCost(t.tool);
      el.textContent = c > 0 ? money0(c) : '';
      el.classList.toggle('cant', c > money);
      const btn = el.closest('.tool-btn') as HTMLElement | null;
      if (btn) {
        const up = UPKEEP[t.tool] ?? 0;
        btn.title = c > 0
          ? `${t.name}: ${money0(c)} each${up ? ` · ${money0(up)}/min upkeep` : ''}`
          : `${t.name} — free to use`;
      }
    }
  }

  private highlightScene(id: SceneId): void {
    this.root.querySelectorAll('.scene-pill').forEach((b) => {
      b.classList.toggle('active', (b as HTMLElement).dataset.scene === id);
    });
  }

  private renderStats(s: CityStats): void {
    this.refreshToolCosts(); // affordability flips as the treasury moves
    // air-quality index: pollution 0..1 → AQI 20..180 (colour-coded chip)
    const aqi = Math.round(20 + Math.max(0, Math.min(1, s.pollution ?? 0)) * 160);
    const aqiCls = aqi < 50 ? 'aqi-ok' : aqi < 100 ? 'aqi-mid' : 'aqi-bad';
    // The strip splits in two: the wallet (treasury + its burn rate) reads left of
    // the rule, the city census right of it. The census figures are bare numbers
    // beside a 13px glyph — 142 and 113 could each be anything without decoding the
    // icon — so each stacks a micro-label under the figure, with the full word in
    // the tooltip. Money and income are self-describing and keep their own line.
    this.statsEl.innerHTML = `
      <span class="chip chip-money" title="Treasury — the Budget panel spends it">${ico('money')} $${s.money.toLocaleString()}</span>
      <span class="chip chip-income ${s.income >= 0 ? 'pos' : 'neg'}" title="Net income per minute">${ico('chart')} ${s.income >= 0 ? '+' : '−'}$${Math.abs(s.income).toLocaleString()}/min</span>
      <span class="chip chip-stat" title="Buildings placed">${ico('building')}<span class="cstack"><span class="cv">${s.buildings}</span><span class="cl">bldg</span></span></span>
      <span class="chip chip-stat" title="Trees planted">${ico('tree')}<span class="cstack"><span class="cv">${s.trees}</span><span class="cl">trees</span></span></span>
      <span class="chip chip-stat" title="Citizens in the city">${ico('person')}<span class="cstack"><span class="cv">${s.people}</span><span class="cl">pop</span></span></span>
      <span class="chip chip-stat" title="Cars on the road">${ico('car')}<span class="cstack"><span class="cv">${s.cars}</span><span class="cl">cars</span></span></span>
      <span class="chip chip-stat" title="Decorations placed">${ico('spark')}<span class="cstack"><span class="cv">${s.decor}</span><span class="cl">decor</span></span></span>
      <span class="chip ${aqiCls}" title="Air quality index">${ico('weather')} AQI ${aqi}</span>
      <span class="chip chip-day" title="Current day">${ico('clock')} Day ${this.city.day}</span>
    `;
  }

  /** Refresh the budget panel from city.budget() (called on every cityUpdated) */
  private renderBudget(): void {
    const b = this.city.budget();
    const amt = (n: number): string => (n < 0 ? '−' : '+') + '$' + Math.abs(n).toLocaleString();
    /* No icons here: these four carried ico() while every upkeep row below
       was bare text, and both spans start flush — so the income labels sat
       ~16px right of the upkeep ones and the label axis broke at UPKEEP. */
    this.budSources.innerHTML = `
      <div class="bud-row"><span>Property</span><b>${amt(b.sources.property)}</b></div>
      <div class="bud-row"><span>Residents</span><b>${amt(b.sources.residents)}</b></div>
      <div class="bud-row"><span>Traffic</span><b>${amt(b.sources.traffic)}</b></div>
      <div class="bud-row"><span>Zones</span><b>${amt(b.sources.zones)}</b></div>
      <div class="bud-row bud-sub"><span>Gross income</span><b>${amt(b.gross)}</b></div>`;
    this.budUpkeep.innerHTML =
      b.upkeepLines
        .map((l) => `<div class="bud-row neg"><span>${l.label}</span><b>−$${l.amount.toLocaleString()}</b></div>`)
        .join('') +
      `<div class="bud-row bud-sub"><span>Total upkeep</span><b>−$${b.upkeep.toLocaleString()}</b></div>`;
    this.budNet.innerHTML = `<span>${ico('money')} Net / min</span><span class="${b.net >= 0 ? 'up' : 'down'}">${amt(b.net)}</span>`;
    const pct = Math.round(b.taxRate * 100);
    if (Number(this.budSlider.value) !== pct) this.budSlider.value = String(pct);
    this.budTaxVal.textContent = pct + '%';
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    const t = this.toastEl as HTMLElement & { _t?: number };
    clearTimeout(t._t);
    t._t = window.setTimeout(() => this.toastEl.classList.remove('show'), 2400);
  }

  // =====================================================================
  // Pause & meta (save/load shared with the top bar and the pause overlay)
  // =====================================================================

  /** Freeze/unfreeze the sim — engine keeps rendering the city behind it */
  togglePause(): void {
    if (this.engine.state === 'playing') this.engine.setState('paused');
    else if (this.engine.state === 'paused') this.engine.setState('playing');
  }

  /** Photo mode: every piece of chrome steps aside for a clean shot of the
   *  city. F toggles it; the pause overlay stays visible — that plus F is
   *  always the way back out. */
  togglePhoto(on?: boolean): void {
    const photo = on ?? !this.root.classList.contains('photo');
    this.root.classList.toggle('photo', photo);
    this.photoCb.checked = photo;
    if (photo) this.toast('📷 Photo mode — F or Esc brings the menu back');
  }

  saveGame(): void {
    const ok = saveCity(this.city, this.sceneSys.current, this.market);
    this.toast(ok ? '💾 City saved!' : '❌ Save failed');
  }

  loadGame(): void {
    const s = loadCity(this.city, this.market);
    if (s) { this.sceneSys.apply(s); this.toast('📂 City loaded!'); }
    else this.toast('No save found');
  }

  newCity(): void {
    this.city.generate(Math.floor(Math.random() * 1e9));
    // re-apply the active scene so fresh materials get its lighting
    this.sceneSys.apply(this.sceneSys.current);
    this.toast('✨ Fresh city generated');
  }

  /** Milestone rows: icon, label, live progress, and the reward on offer */
  private renderGoals(): void {
    const rows = this.city.goalStatus();
    const done = rows.filter((r) => r.done).length;
    this.goalsBody.innerHTML =
      rows
        .map(
          (r) => `
        <div class="goal-row${r.done ? ' done' : ''}">
          <span class="goal-ic">${r.icon}</span>
          <span class="goal-txt">
            <span class="goal-label">${r.label}</span>
            <span class="goal-prog">${
              r.done ? 'Completed' : `${r.value.toLocaleString()} / ${r.target.toLocaleString()}`
            }</span>
          </span>
          <span class="goal-reward">${r.done ? '✓' : '+$' + r.reward.toLocaleString()}</span>
        </div>`
        )
        .join('') +
      `<div class="goal-sum">${done} / ${rows.length} milestones reached</div>`;
  }

  // =====================================================================
  // City newspaper
  // =====================================================================

  /** Headline rows: day stamp + text, newest first */
  private renderNews(): void {
    const items = this.city.news;
    if (items.length === 0) {
      this.newsBody.innerHTML =
        '<div class="news-empty">Nothing in the paper yet — the city is quiet.</div>';
      return;
    }
    // Stamping every row stacked seven identical "DAY 1" labels in a column: a
    // repeated label stops being a label and becomes noise. The day is printed
    // once per run of same-day entries and again only when it actually changes,
    // which keeps the chronology and makes the change itself the visible event.
    let day: number | null = null;
    this.newsBody.innerHTML = items
      .map((n) => {
        const stamp = n.day === day ? '' : `<span class="news-day">DAY ${n.day}</span>`;
        day = n.day;
        return `
        <div class="news-row">
          ${stamp}
          <span class="news-text">${n.text}</span>
        </div>`;
      })
      .join('');
  }

  /** Open/close the newspaper (📰 button or N) — one rail panel at a time */
  toggleNews(): void {
    this.toggleRail(this.newsPanel, this.newsBtn, () => this.renderNews());
  }

  /** Open/close the underground cutaway (⛏ button or X) */
  toggleCutaway(): void {
    const on = !this.city.cutawayOn;
    this.city.setCutaway(on);
    this.cutBtn.classList.toggle('on', on);
    this.toast(on ? '⛏ Street excavation open — mind the drop!' : '⛏ Street surface restored');
  }

  // =====================================================================
  // Map archetypes
  // =====================================================================

  // =====================================================================
  // Right-rail dashboards (budget, goals, news, map, exchange, shop)
  // =====================================================================

  /** Every rail panel paired with the button that owns it */
  private railPanels(): Array<[HTMLElement, HTMLElement]> {
    return [
      [this.budPanel, this.budBtn],
      [this.goalsPanel, this.goalBtn],
      [this.newsPanel, this.newsBtn],
      [this.mapPanel, this.mapBtn],
      [this.stocksPanel, this.stocksBtn],
      [this.shopPanel, this.shopBtn],
    ];
  }

  /**
   * One dashboard at a time: pressing the open panel's button closes it,
   * opening another closes the rest. Whichever one opens is parked under the
   * top bar, capped to the viewport and repainted — identical behaviour for
   * all six panels instead of six hand-rolled copies.
   */
  private toggleRail(panel: HTMLElement, btn: HTMLElement, render?: () => void): void {
    const hidden = panel.classList.toggle('hidden');
    btn.classList.toggle('on', !hidden);
    if (hidden) {
      if (panel === this.shopPanel) this.stopSelling(); // closing the shop ends resell mode
    } else {
      for (const [p, b] of this.railPanels()) {
        if (p === panel) continue;
        if (p === this.shopPanel && !p.classList.contains('hidden')) this.stopSelling();
        p.classList.add('hidden');
        b.classList.remove('on');
      }
      this.railPlace(panel);
      this.clampRail(panel);
      render?.();
    }
    this.syncSellMode();
  }

  /**
   * Cap a rail panel to what is actually left on screen. The top bar wraps to
   * extra rows on narrower windows, so railPlace can park a panel well below
   * 66px — without this, tall panels spilled past the bottom edge.
   */
  private clampRail(panel: HTMLElement): void {
    const topPx = parseFloat(panel.style.top || '66') || 66;
    panel.style.maxHeight = `${Math.max(240, window.innerHeight - topPx - 14)}px`;
  }

  /** Resell mode paints a crosshair over the city while the shop is open */
  private syncSellMode(): void {
    const on = this.build.sellMode && !this.shopPanel.classList.contains('hidden');
    document.body.classList.toggle('sell-mode', on);
  }

  private stopSelling(): void {
    if (this.build.sellMode) this.build.exitSellMode();
    document.body.classList.remove('sell-mode');
  }

  /**
   * Park a right-rail panel just below the top-actions bar — it wraps to extra
   * rows on smaller windows (13 buttons now), and overlapping it looked broken.
   */
  private railPlace(panel: HTMLElement): void {
    const bottom = this.actionsEl.getBoundingClientRect().bottom;
    panel.style.top = `${Math.max(66, Math.round(bottom) + 8)}px`;
  }

  /** Card grid: one card per archetype, the pending pick highlighted */
  private renderMap(): void {
    this.mapCards.innerHTML = MAP_ARCHETYPES.map(
      (a) => `
      <button class="map-card${a.id === this.pendingArch ? ' on' : ''}" data-arch="${a.id}">
        <span class="map-ic">${a.icon}</span>
        <span class="map-txt">
          <span class="map-name">${a.name}</span>
          <span class="map-blurb">${a.blurb}</span>
        </span>
      </button>`
    ).join('');
    for (const c of this.mapCards.querySelectorAll<HTMLButtonElement>('.map-card')) {
      c.addEventListener('click', () => {
        this.pendingArch = (c.dataset.arch ?? 'grid') as MapArchetype;
        this.renderMap(); // repaint just the selection state
      });
    }
  }

  /** Open/close the map picker (🗺 button) — one rail panel at a time */
  toggleMap(): void {
    this.toggleRail(this.mapPanel, this.mapBtn, () => {
      this.pendingArch = this.city.archetype;
      this.renderMap();
    });
  }

  /** Switch archetype and lay out a fresh city in that map (🎲 button) */
  private applyMap(): void {
    const arch = MAP_ARCHETYPES.find((a) => a.id === this.pendingArch);
    if (!arch) return;
    if (arch.id !== this.city.archetype) this.city.archetype = arch.id;
    this.city.generate(Math.floor(Math.random() * 1e9));
    this.sceneSys.apply(this.sceneSys.current); // fresh materials need the lighting
    this.toast(`🗺️ ${arch.icon} ${arch.name} map generated`);
    this.mapPanel.classList.add('hidden');
    this.mapBtn.classList.remove('on');
  }

  // =====================================================================
  // Stock exchange (educational market)
  // =====================================================================

  /** Open/close the exchange — the 📈 button inside the budget panel */
  toggleStocks(): void {
    this.toggleRail(this.stocksPanel, this.stocksBtn, () => {
      this.lastLessons = ''; // merely opening the panel must not toast old lessons
      this.renderStocks();
    });
  }

  /** Repaint wallet, quotes, coach, lessons and the private market feed */
  private renderStocks(): void {
    const m = this.market;
    const st = m.status();
    const fmt = (n: number): string =>
      '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const signed = (n: number): string => (n >= 0 ? '+' : '−') + '$' + Math.abs(n).toFixed(2);
    const tone = st.gain > 0.004 ? 'up' : st.gain < -0.004 ? 'down' : '';

    this.stocksWallet.innerHTML = `
      <div class="stk-stat"><i>${ico('money')} Cash</i><b>${fmt(st.cash)}</b></div>
      <div class="stk-stat"><i>${ico('chart')} Invested</i><b>${fmt(st.invested)}</b></div>
      <div class="stk-stat"><i>${ico('money')} Total</i><b>${fmt(st.total)}</b></div>
      <div class="stk-stat"><i>vs $1,000</i><b class="${tone}">${signed(st.gain)}</b></div>`;
    this.stocksQty.textContent = String(m.qty);

    // sparkline: recent ticks as thin bars, downsampled to ~24 columns
    const spark = (hist: number[]): string => {
      if (hist.length < 2) return '';
      const lo = Math.min(...hist);
      const hi = Math.max(...hist);
      const span = hi - lo || 1;
      const step = Math.max(1, Math.ceil(hist.length / 24));
      let out = '';
      for (let i = 0; i < hist.length; i += step) {
        out += `<i style="height:${Math.max(10, Math.round(((hist[i] - lo) / span) * 100))}%"></i>`;
      }
      return out;
    };

    const row = (o: {
      id: string; icon: string; name: string; meta: string; blurb: string;
      price: number; chg: number; own: string; hist: number[];
      canBuy: boolean; canSell: boolean;
    }): string => `
      <div class="stk-row${o.canSell ? ' owned' : ''}" data-id="${o.id}">
        <span class="stk-ic">${o.icon}</span>
        <span class="stk-main">
          <span class="stk-nm">${o.name}</span>
          <span class="stk-meta">${o.meta}</span>
          <span class="stk-blurb">${o.blurb}</span>
          <span class="stk-own">${o.own}</span>
        </span>
        <span class="stk-px ${o.chg >= 0 ? 'up' : 'down'}">
          <b>${fmt(o.price)}</b>
          <i class="stk-chg ${o.chg >= 0 ? 'up' : 'down'}">${(o.chg >= 0 ? '+' : '−') + Math.abs(o.chg).toFixed(1)}%</i>
          <span class="stk-spark">${spark(o.hist)}</span>
        </span>
        <span class="stk-tr">
          <button class="btn btn-mini stk-buy"${o.canBuy ? '' : ' disabled'}>Buy</button>
          <button class="btn btn-mini stk-sell"${o.canSell ? '' : ' disabled'}>Sell</button>
        </span>
      </div>`;

    const rows: string[] = [];
    for (const s of m.stocks) {
      const chg = s.open > 0 ? ((s.price - s.open) / s.open) * 100 : 0;
      const cost = s.price * m.qty;
      const pl = s.shares > 0 ? s.shares * s.price - s.shares * s.avg : 0;
      rows.push(row({
        id: s.id,
        icon: s.icon,
        name: s.name,
        meta: `${s.sector} · ${s.risk} risk · pays ${(s.div * 100).toFixed(1)}%`,
        blurb: s.blurb,
        price: s.price,
        chg,
        hist: s.hist,
        canBuy: cost <= m.cash + 1e-6,
        canSell: s.shares >= m.qty,
        own: s.shares > 0
          ? `${s.shares} share${s.shares === 1 ? '' : 's'} · avg ${fmt(s.avg)} · ${signed(pl)} so far`
          : 'Not owned yet',
      }));
    }
    {
      const ip = m.indexPrice();
      rows.push(row({
        id: INDEX_ID,
        icon: '🏙️',
        name: 'City Index Fund',
        meta: `INDEX · Diversified · pays ${(m.indexDividend() * 100).toFixed(1)}%`,
        blurb: 'Owns all 8 companies at once — the instant, no-picking way to diversify.',
        price: ip,
        chg: m.indexChange(),
        hist: m.indexHist,
        canBuy: ip * m.qty <= m.cash + 1e-6,
        canSell: m.indexShares >= m.qty,
        own: m.indexShares > 0
          ? `${m.indexShares} unit${m.indexShares === 1 ? '' : 's'} · avg ${fmt(m.indexAvg)} · all 8 companies`
          : 'Not owned yet',
      }));
    }
    this.stocksRows.innerHTML = rows.join('');
    for (const el of this.stocksRows.querySelectorAll<HTMLElement>('.stk-row')) {
      const id = el.dataset.id ?? '';
      el.querySelector('.stk-buy')?.addEventListener('click', () => this.doTrade(id, true));
      el.querySelector('.stk-sell')?.addEventListener('click', () => this.doTrade(id, false));
    }

    const c = m.coach();
    this.stocksCoach.innerHTML =
      `<div class="stk-tip ${c.tone}">${c.text}</div><div class="stk-next">${c.next}</div>`;

    this.stocksLessons.innerHTML = LESSONS.map((l) => {
      const done = !!m.lessons[l.id];
      return `<span class="stk-lesson${done ? ' done' : ''}">${done ? '✓' : '○'} ${l.icon} ${l.label}</span>`;
    }).join('');

    // Same rule as CITY DESK: print the day once per run of same-day entries.
    // Stamping every row stacked identical labels until the label stopped
    // carrying information — it should return only when the day actually changes.
    if (m.feed.length === 0) {
      this.stocksFeed.innerHTML = '<div class="stk-empty">No market news yet.</div>';
    } else {
      let day: number | null = null;
      this.stocksFeed.innerHTML = m.feed
        .slice(0, 6)
        .map((f) => {
          const stamp = f.day === day ? '' : `<span class="stk-fday">DAY ${f.day}</span>`;
          day = f.day;
          return `
        <div class="stk-feed-row">
          ${stamp}
          <span class="stk-ftxt">${f.text}</span>
        </div>`;
        })
        .join('');
    }

    this.syncLessonToast();
  }

  private doTrade(id: string, buy: boolean): void {
    const m = this.market;
    let res: TradeResult;
    if (id === INDEX_ID) res = buy ? m.buyIndex() : m.sellIndex();
    else res = buy ? m.buy(id) : m.sell(id);
    this.toast(res.ok ? res.msg : `⚠️ ${res.msg}`);
    this.renderStocks();
  }

  /** Toast a lesson the moment it is completed while the panel is open */
  private syncLessonToast(): void {
    const done = LESSONS.filter((l) => this.market.lessons[l.id]);
    const key = done.map((l) => l.id).join(',');
    if (this.lastLessons !== '') {
      const known = this.lastLessons.split(',');
      for (const l of done) if (!known.includes(l.id)) this.toast(`📚 Lesson: ${l.icon} ${l.label}`);
    }
    this.lastLessons = key;
  }

  // =====================================================================
  // City shop — buy objects (with prices), resell what you own
  // =====================================================================

  /** Open/close the shop — the 🛒 button inside the budget panel */
  toggleShop(): void {
    this.toggleRail(this.shopPanel, this.shopBtn, () => this.renderShop());
  }

  /** Repaint wallet, tabs and whichever list is showing */
  private renderShop(): void {
    const money = this.city.money;
    const counts = this.city.kindCounts();

    for (const t of this.shopTabsEl.querySelectorAll<HTMLElement>('.shop-tab')) {
      t.classList.toggle('on', (t.dataset.tab === 'sell' ? 'sell' : 'buy') === this.shopTab);
    }

    const built = Object.values(counts).reduce((a, b) => a + b, 0);
    const resale = this.city.refundLines().reduce((a, l) => a + l.total, 0);
    this.shopWallet.innerHTML = `
      <div class="sh-stat"><i>${ico('budget')} Treasury</i><b>${money0(money)}</b></div>
      <div class="sh-stat"><i>${ico('package')} Built</i><b>${built}</b></div>
      <div class="sh-stat"><i>${ico('refresh')} Resale value</i><b>${money0(resale)}</b></div>`;

    this.shopList.innerHTML =
      this.shopTab === 'sell' ? this.sellListHtml() : this.buyListHtml(counts, money);

    this.shopList.querySelectorAll<HTMLButtonElement>('.sh-buy').forEach((b) => {
      b.addEventListener('click', () => {
        const row = b.closest('.sh-row') as HTMLElement | null;
        const tool = (row?.dataset.tool ?? '') as ToolId;
        if (!tool) return;
        this.build.setTool(tool);
        this.highlightTool();
        this.toggleShop(); // close the shop so the map is visible for placing
        const cost = this.build.toolCost(tool);
        this.toast(
          `✅ ${TOOL_NAMES[tool] ?? tool} selected — ${cost > 0 ? money0(cost) : 'free'}` +
            ' each, click the map to place it'
        );
      });
    });

    this.shopList.querySelector('.sh-toggle')?.addEventListener('click', () => {
      if (this.build.sellMode) {
        this.stopSelling();
      } else {
        this.build.enterSellMode();
        this.toast('💰 Resell mode — click any object in the city to sell it back');
      }
      this.renderShop();
    });

    this.syncSellMode(); // repaint must never leave the crosshair out of step
  }

  /** Buy tab: every item, its price, its upkeep and how many you own */
  private buyListHtml(counts: Record<string, number>, money: number): string {
    const rows = TOOL_UI.filter((t) => t.tool !== 'select' && t.tool !== 'bulldoze')
      .map((t) => {
        const cost = this.build.toolCost(t.tool);
        const up = UPKEEP[t.tool] ?? 0;
        const own = counts[t.tool] ?? 0;
        const live =
          t.tool === 'person' ? this.city.people.length
          : t.tool === 'car' ? this.city.cars.length
          : t.tool === 'train' ? this.city.trains.length
          : null;
        const owned = live !== null ? `${live} in town` : own > 0 ? `${own} built` : 'none yet';
        const short = cost > money;
        return `
      <div class="sh-row" data-tool="${t.tool}">
        <span class="sh-ic">${ico(t.icon)}</span>
        <span class="sh-main">
          <span class="sh-nm">${TOOL_NAMES[t.tool] ?? t.name}<em>${owned}</em></span>
          <span class="sh-desc">${SHOP_DESC[t.tool] ?? ''}</span>
        </span>
        <span class="sh-meta">
          <b class="sh-px${short ? ' poor' : ''}">${cost > 0 ? money0(cost) : 'free'}</b>
          <i class="sh-up${up ? '' : ' ok'}">${up ? `−${money0(up)}/min` : 'no upkeep'}</i>
        </span>
        <button class="btn btn-mini sh-buy"${short ? ' disabled' : ''}>Buy</button>
      </div>`;
      })
      .join('');

    return `
      <div class="sh-lbl">WHAT YOU CAN BUY</div>
      ${rows}
      <div class="sh-tip"><b>Buy</b> selects the tool — then click the map to place it. The
      price is charged when you place, and the same tag shows on the rail at the left.</div>`;
  }

  /** Sell tab: turn on resell mode, and show exactly what you could get back */
  private sellListHtml(): string {
    const lines = this.city.refundLines();
    const total = lines.reduce((a, l) => a + l.total, 0);
    const selling = this.build.sellMode;
    const icon = (kind: string): string => {
      const t = TOOL_UI.find((x) => x.tool === kind);
      return t ? ico(t.icon) : ico('package');
    };

    const rows = lines
      .map((l) => {
        const each = Math.round(l.total / l.n);
        return `
      <div class="sh-row">
        <span class="sh-ic">${icon(l.kind)}</span>
        <span class="sh-main">
          <span class="sh-nm">${TOOL_NAMES[l.kind as ToolId] ?? l.kind}<em>×${l.n}</em></span>
          <span class="sh-desc">${
            l.n > 1 ? `${money0(each)} each · ${money0(l.total)} all up` : `${money0(each)} back`
          }</span>
        </span>
        <span class="sh-meta"><b class="sh-px">${money0(each)}</b><i class="sh-up">per one</i></span>
      </div>`;
      })
      .join('');

    return `
      <div class="sh-callout">💰 Click any object in the city to sell it back. Buildings
      return <b>40%</b> of what they cost — everything else returns <b>50%</b>.</div>
      <div class="sh-sellbar">
        <button class="btn sh-toggle${selling ? ' on' : ''}">${
          selling ? '⏹ Stop reselling' : '▶ Start reselling'
        }</button>
        <span class="sh-state${selling ? ' on' : ''}">${
          selling ? 'Resell mode ON — click the city' : 'Resell mode OFF'
        }</span>
      </div>
      <div class="sh-lbl">WHAT YOU OWN${lines.length ? ` · ${money0(total)} back` : ''}</div>
      <div class="sh-rows">
        ${
          lines.length === 0
            ? '<div class="sh-empty">Nothing placed yet — buy something first.</div>'
            : rows
        }
      </div>
      <div class="sh-tip">Press <b>Esc</b> or right-click to stop. To sell a single thing,
      use ✋ Select and its <b>💰 Sell</b> button.</div>`;
  }

  // =====================================================================
  // Educational splash screen
  // =====================================================================

  private buildSplash(): void {
    const s = this.el('div', 'splash hidden');
    const cards = CONCEPTS.map((c) => `
      <div class="sp-card">
        <span class="sp-ic">${c.icon}</span>
        <span class="sp-txt"><b>${c.term}</b><i>${c.text}</i></span>
      </div>`).join('');
    const goals = LESSONS.map((l) => `<span class="sp-goal">${l.icon} ${l.label}</span>`).join('');
    const feats = [
      '🏗️ Build & zone', '🌦 Weather & seasons', '🚶 Citizens with lives',
      '🚇 Metro cutaway', '🗺 Six map styles', '📈 Stock exchange',
    ]
      .map((f) => `<span class="sp-feat">${f}</span>`)
      .join('');

    s.innerHTML = `
      <div class="sp-hud" aria-hidden="true">
        <div class="sp-live">
          <i></i><span>LIVE SIMULATION</span><b class="sp-live-t">warming up…</b>
        </div>
        <div class="sp-strip">
          <div class="sp-caps">
            <span>Traffic, weather and a day–night cycle are all running behind this card</span>
            <span>Draw roads, zone blocks and raise buildings wherever you click</span>
            <span>Cut the street open and watch the metro run underneath</span>
            <span>Six map styles — coast, desert, winter, river and more</span>
            <span>Then open your own stock exchange and trade with $1,000</span>
          </div>
        </div>
      </div>
      <div class="sp-box">
        <div class="sp-split">
          <div class="sp-hero">
            <div class="sp-logo">🏙️</div>
            <div class="sp-brand">CITY BUILDER</div>
            <div class="sp-tag">A realistic 3D city sandbox — every pixel drawn by code</div>
            <div class="sp-feats">${feats}</div>
            <div class="sp-pitch">
              Lay out roads and blocks, raise buildings, watch residents go to work, dig the
              street open for the metro — and now run a <b>stock exchange</b> of your own.
            </div>
            <div class="sp-stats">
              <span><b class="ss-b">0</b> buildings</span>
              <span><b class="ss-p">0</b> citizens</span>
              <span><b class="ss-c">0</b> vehicles</span>
              <span><b class="ss-t">0</b> trees</span>
            </div>
          </div>
          <div class="sp-lessons">
            <div class="sp-eyebrow">BEFORE YOU BEGIN</div>
            <div class="sp-title">📈 Learn to Invest</div>
            <div class="sp-lead">
              The city has a stock exchange now. Read these eight ideas, then practise them with a
              <b>$1,000 allowance</b> separate from the city treasury — a bad trade can never
              bankrupt the town.
            </div>
            <div class="sp-how">
              <b>Three steps to your first trade</b>
              <ol class="sp-steps">
                <li>Press <b>💼 Budget</b> in the top bar.</li>
                <li>Press <b>📈 Stock Exchange</b> — prices tick on their own and the
                  <b>📰 Market Feed</b> explains every move.</li>
                <li>Buy a little, wait, then sell for more than you paid.</li>
              </ol>
            </div>
            <div class="sp-goals"><span class="sp-goals-t">Your six lessons</span>${goals}</div>
          </div>
        </div>
        <div class="sp-grid">${cards}</div>
        <div class="sp-foot">
          <button class="btn sp-go">🚀 Start building</button>
          <button class="btn sp-roll">🎲 New city</button>
          <span class="sp-note">Re-read this any time with <b>📖 Learn</b> in the budget panel.</span>
        </div>
      </div>`;
    this.root.appendChild(s);
    this.splashEl = s;
    s.querySelector('.sp-go')?.addEventListener('click', () => this.hideSplash());
    // Both options leave the card, but they mean opposite things: commit to the
    // city that is behind it, or throw that one away and roll a fresh map first.
    s.querySelector('.sp-roll')?.addEventListener('click', () => {
      this.newCity();
      this.hideSplash();
    });
    // keep the live counters honest while the card is up (they read 0 the very
    // first time — the world is generated a beat after the UI is built)
    window.setInterval(() => this.refreshSplashStats(), 1200);
    this.refreshSplashStats();
  }

  /** Live world counters shown on the title card and its HUD badge. */
  private refreshSplashStats(): void {
    if (!this.splashEl || this.splashEl.classList.contains('hidden')) return;
    const s = this.city.stats();
    const put = (sel: string, v: string): void => {
      const n = this.splashEl.querySelector(sel);
      if (n) n.textContent = v;
    };
    put('.ss-b', String(s.buildings));
    put('.ss-p', String(s.people));
    put('.ss-c', String(s.cars));
    put('.ss-t', String(s.trees));
    put('.sp-live-t', `${s.buildings} buildings · ${s.people} citizens`);
  }

  /**
   * The card is a single screen — the guide sits beside the title, so there is
   * no stage to switch and nothing hidden behind a click. Opening it from
   * 📖 Learn still has to mean something, so it marks the guide column as the
   * focus (and, on a window too short to hold the whole card, scrolls to it).
   */
  showSplash(fromLessons = false): void {
    this.splashEl.classList.toggle('sp-focus', fromLessons);
    this.splashEl.classList.remove('hidden');
    this.refreshSplashStats();
    if (fromLessons) {
      (this.splashEl.querySelector('.sp-lessons') as HTMLElement | null)?.scrollIntoView({
        block: 'nearest',
      });
    }
  }

  /** Dismiss it — remembers the choice so a headless run never meets it again */
  hideSplash(): void {
    this.splashEl.classList.add('hidden');
    try {
      localStorage.setItem(SPLASH_KEY, '1');
    } catch {
      /* storage unavailable — we simply show it again next time */
    }
    if (!this.splashGone) {
      this.splashGone = true;
      this.toast('💼 Budget → 📈 Stock Exchange — your $1,000 allowance is waiting');
    }
  }
}