/* stockscheck.js — proves the two market-feed fixes.
 *
 * 1. DAY stamps: renderNews got grouped earlier but the market kept its own
 *    private feed with its own renderer, so it still stamped every row — two
 *    identical "DAY 1" labels sat stacked under MARKET FEED. Stamps must now
 *    equal the number of day-runs, not the number of rows.
 * 2. Label: .stk-feed-title was 11.5px/0.9px accent-green with a glyph — a third
 *    dressing for what .pn-lbl already does at 11px/1.1px near-white with a
 *    trailing rule. It must now be indistinguishable from .pn-lbl.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 600000,
    args: [
      '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
    ],
  });
  const page = await browser.newPage();
  const errs = [];
  const ext = [];
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 250)));
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://localhost:5273') && !u.startsWith('data:')) ext.push(u);
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5273', { waitUntil: 'load', timeout: 180000 });
  console.log('waiting for game...');
  await page.waitForFunction(() => window.game && window.game.city.stats().buildings > 0, {
    timeout: 420000, polling: 2000,
  });
  console.log('game ready');

  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const waitFrames = async (n) => {
    const f0 = await ev(() => {
      if (window.__fc === undefined) {
        window.__fc = 0;
        (function tick() { window.__fc++; requestAnimationFrame(tick); })();
      }
      return window.__fc;
    });
    await page.waitForFunction((t) => window.__fc >= t, { timeout: 300000, polling: 250 }, f0 + n);
  };

  await ev(() => {
    const g = window.game;
    g.engine.paused = false;
    g.weather.setMode('clear');
    g.sceneSystem.apply('day');
    g.city.generate(777);
    g.build.setTool('select');
    g.ui.hideSplash();
  });
  await waitFrames(3);

  const fail = [];
  const check = (l, ok, d) => {
    console.log((ok ? 'OK   ' : 'FAIL ') + l + (d === undefined ? '' : '  ' + d));
    if (!ok) fail.push(l);
  };

  const base = await ev(() => ({
    top: document.querySelectorAll('.top-actions button').length,
    tools: document.querySelectorAll('.tools .tool-btn').length,
    cash: window.game.market.cash,
    costs: document.querySelectorAll('.tool-cost').length,
    links: document.querySelectorAll('.bud-stk, .bud-stocks a, .bud-stocks button').length,
  }));
  check('13 top-actions', base.top === 13, base.top);
  check('26 tool buttons', base.tools === 26, base.tools);
  check('market cash 1000', base.cash === 1000, base.cash);
  check('25 tool costs', base.costs === 25, base.costs);

  // budget is the entry point to the exchange
  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /budget/i.test(b.textContent || ''))?.click());
  await waitFrames(2);
  await ev(() => document.querySelector('.bud-stk')?.click());
  await waitFrames(5);

  const r = await ev(() => {
    const lbl = document.querySelector('.stk-feed-title');
    const ref = document.querySelector('.pn-lbl');
    const cs = lbl ? getComputedStyle(lbl) : null;
    const rs = ref ? getComputedStyle(ref) : null;
    const after = lbl ? getComputedStyle(lbl, '::after') : null;

    const rows = [...document.querySelectorAll('.stk-feed-row')];
    const raw = window.game.market.feed.map((f) => f.day);
    let runs = 0;
    let prev = null;
    for (const d of raw) { if (d !== prev) { runs++; prev = d; } }

    return {
      label: (lbl?.textContent || '').trim(),
      icons: lbl ? lbl.querySelectorAll('svg, .ic, img').length : -1,
      color: cs?.color || null,
      refColor: rs?.color || null,
      size: cs?.fontSize || null,
      refSize: rs?.fontSize || null,
      track: cs?.letterSpacing || null,
      refTrack: rs?.letterSpacing || null,
      display: cs?.display || null,
      refDisplay: rs?.display || null,
      rule: after?.content || null,
      ruleFlex: after?.flexGrow || null,

      feedRows: rows.length,
      stamps: document.querySelectorAll('.stk-fday').length,
      expectedRuns: runs,
      feedDays: raw,
      textRows: rows.filter((x) => (x.textContent || '').trim().length > 0).length,
      rows: document.querySelectorAll('.stk-row').length,
      lessons: document.querySelectorAll('.stk-lesson').length,
      wallet: (document.querySelector('.stk-wallet')?.textContent || '').replace(/\s+/g, ' ').trim(),
      panel: (() => {
        const p = document.querySelector('.stocks-panel').getBoundingClientRect();
        return { inView: p.bottom <= innerHeight + 1 && p.right <= innerWidth + 1, h: Math.round(p.height) };
      })(),
    };
  });

  check('label text', r.label === 'MARKET FEED', JSON.stringify(r.label));
  check('no icon in label', r.icons === 0, r.icons);
  check('label colour == pn-lbl', r.color === r.refColor, `${r.color} vs ${r.refColor}`);
  check('label size == pn-lbl', r.size === r.refSize, `${r.size} vs ${r.refSize}`);
  check('label tracking == pn-lbl', r.track === r.refTrack, `${r.track} vs ${r.refTrack}`);
  check('label display == pn-lbl', r.display === r.refDisplay, `${r.display} vs ${r.refDisplay}`);
  check('trailing rule present', r.rule !== 'none', r.rule);
  check('rule grows to fill', r.ruleFlex === '1', r.ruleFlex);

  check('feed rows rendered', r.feedRows > 0, r.feedRows);
  check('stamps == day runs', r.stamps === r.expectedRuns, `${r.stamps} vs ${r.expectedRuns}`);
  check('stamps < rows (grouped)', r.stamps < r.feedRows, `${r.stamps} < ${r.feedRows}`);
  check('every feed row has text', r.textRows === r.feedRows, `${r.textRows}/${r.feedRows}`);
  console.log('  feed days ' + JSON.stringify(r.feedDays));

  check('9 stock rows', r.rows === 9, r.rows);
  check('6 lessons', r.lessons === 6, r.lessons);
  check('wallet shown', /\$1,000/.test(r.wallet), JSON.stringify(r.wallet));
  check('stocks panel in view', r.panel.inView, `${r.panel.h}px`);

  check('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  check('no external requests', ext.length === 0, JSON.stringify(ext.slice(0, 3)));

  console.log('---');
  console.log(fail.length === 0
    ? 'STOCKSCHECK PASS'
    : `STOCKSCHECK FAIL (${fail.length}): ${fail.join(' | ')}`);
  await browser.close();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', String(e).slice(0, 400)); process.exit(1); });
