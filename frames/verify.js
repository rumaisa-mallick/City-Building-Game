/* verify.js — single consolidated check after the realism + UI pass.
 *
 * Covers the standing invariants (button/row/tool counts, market cash, the help
 * bar, fonts), the two structural changes made this round (top-bar row 2 now
 * spans all three grid columns; stock rows split name and tag line), and every
 * right-rail panel's fit. Screenshots the HUD and the exchange so the row
 * restructure can be eyeballed rather than trusted from numbers alone.
 *
 * Frames are ~10 s under SwiftShader, so anything that depends on a repaint is
 * gated on requestAnimationFrame ticks, never on a sleep.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:/Users/HP/AppData/Local/Temp/opencode/shot/';
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = [];
const check = (label, ok, detail) => {
  console.log((ok ? 'OK   ' : 'FAIL ') + label + (detail === undefined ? '' : '  ' + detail));
  if (!ok) fail.push(label);
};

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
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('request', (r) => {
    const u = r.url();
    if (/^https?:/.test(u) && !u.startsWith('http://localhost:5273')) ext.push(u);
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('http://localhost:5273', { waitUntil: 'load', timeout: 180000 });
  console.log('waiting for game...');
  await page.waitForFunction(() => window.game && window.game.city.stats().buildings > 0, {
    timeout: 300000, polling: 2000,
  });

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

  // ---------------------------------------------------------------- invariants
  const inv = await ev(() => {
    const help = document.querySelector('.help');
    const cs = (s) => getComputedStyle(document.querySelector(s) || document.body);
    const kbd = document.querySelector('.tool-btn kbd') || document.querySelector('.help kbd');
    return {
      actions: document.querySelectorAll('.top-actions button').length,
      tools: document.querySelectorAll('.tools .tool-btn').length,
      toolCost: document.querySelectorAll('.tool-cost').length,
      chips: document.querySelectorAll('.chip').length,
      budLinks: document.querySelectorAll('.bud-stocks .btn').length,
      budParts: ['bud-sources', 'bud-sub', 'bud-upkeep', 'bud-net', 'bud-row', 'bud-tax-val']
        .filter((c) => document.querySelector('.' + c)).length,
      cash: window.game.market.cash,
      // target the cutaway button specifically: the first .tool-btn in the rail
      // is "Building", whose hotkey is 1
      cutKbd: (document.querySelector('[data-cutaway] kbd') || {}).textContent,
      helpText: help.textContent,
      helpFits: help.scrollWidth <= help.clientWidth + 1,
      helpH: Math.round(help.getBoundingClientRect().height),
      helpW: `${help.scrollWidth}/${help.clientWidth}`,
      fontUI: cs(':root').getPropertyValue('--font-ui').trim(),
      fontDisp: cs(':root').getPropertyValue('--font-display').trim(),
      kbdFont: kbd ? getComputedStyle(kbd).fontFamily.split(',')[0] : null,
      bodyFont: getComputedStyle(document.body).fontFamily.split(',')[0],
      statsOverflow:
        document.querySelector('.stats').scrollWidth >
        document.querySelector('.stats').clientWidth + 1,
    };
  });

  check('13 top-actions buttons', inv.actions === 13, inv.actions);
  check('26 tool buttons', inv.tools === 26, inv.tools);
  check('9 census chips', inv.chips === 9, inv.chips);
  check('25 tool costs', inv.toolCost === 25, inv.toolCost);
  check('3 budget stock links', inv.budLinks === 3, inv.budLinks);
  check('budget parts complete', inv.budParts === 6, inv.budParts);
  check('market cash 1000', inv.cash === 1000, inv.cash);
  check('cutaway kbd X', (inv.cutKbd || '').trim() === 'X', JSON.stringify(inv.cutKbd));
  check('help includes "X dig"', inv.helpText.includes('X dig'));
  check('help fits', inv.helpFits, inv.helpW + ' h=' + inv.helpH);
  check('ui font Pixelify Sans', /Pixelify Sans/.test(inv.fontUI), inv.fontUI);
  check('display font Pixelify Sans', /Pixelify Sans/.test(inv.fontDisp), inv.fontDisp);
  check('kbd font Cascadia Mono', /Cascadia Mono/.test(inv.kbdFont || ''), inv.kbdFont);
  check('body font Pixelify Sans', /Pixelify Sans/.test(inv.bodyFont), inv.bodyFont);
  check('stats no h-scroll', !inv.statsOverflow);

  // ------------------------------------------------------------------- top bar
  const bar = await ev(() => {
    const b = document.querySelector('.top-actions');
    const grps = [...document.querySelectorAll('.act-grp')];
    const bb = b.getBoundingClientRect();
    const brand = document.querySelector('.brand').getBoundingClientRect();
    return {
      rows: new Set(grps.map((g) => Math.round(g.getBoundingClientRect().top))).size,
      grps: grps.length,
      gapL: Math.round(grps[0].getBoundingClientRect().left - bb.left),
      gapR: Math.round(bb.right - grps[grps.length - 1].getBoundingClientRect().right),
      barL: Math.round(bb.left),
      brandL: Math.round(brand.left),
      r2flush: Math.round(bb.right),
      hudPadR: Math.round(
        document.querySelector('.hud-top').getBoundingClientRect().right -
        parseFloat(getComputedStyle(document.querySelector('.hud-top')).paddingRight)
      ),
    };
  });
  check('top bar 1 row', bar.rows === 1, bar.rows);
  check('3 action groups', bar.grps === 3, bar.grps);
  check('row2 gapL 0', bar.gapL === 0, bar.gapL);
  check('row2 gapR 0', bar.gapR === 0, bar.gapR);
  check('row2 flush with brand', Math.abs(bar.barL - bar.brandL) <= 2, `${bar.barL} vs ${bar.brandL}`);
  check('row2 right flush', Math.abs(bar.r2flush - bar.hudPadR) <= 2, `${bar.r2flush} vs ${bar.hudPadR}`);

  // ------------------------------------------------------------ stock rows
  const openStocks = async () => {
    await ev(() => [...document.querySelectorAll('.top-actions button')]
      .find((b) => /budget/i.test(b.textContent || ''))?.click());
    await waitFrames(2);
    await ev(() => document.querySelector('.bud-stk')?.click());
    await waitFrames(3);
  };
  await openStocks();

  const stk = await ev(() => {
    const nms = [...document.querySelectorAll('.stk-nm')];
    const metas = [...document.querySelectorAll('.stk-meta')];
    const p = document.querySelector('.stocks-panel');
    const r = p.getBoundingClientRect();
    return {
      rows: document.querySelectorAll('.stk-row').length,
      hasIndex: !!document.querySelector('.stk-row[data-id="__index__"]'),
      hasBurger: !!document.querySelector('.stk-row[data-id="burger"]'),
      // a single-line 12px name is ~15px tall; anything much larger wrapped
      nmHeights: nms.map((e) => Math.round(e.getBoundingClientRect().height)),
      nmWrapCount: nms.filter((e) => e.getBoundingClientRect().height > 20).length,
      metaClipped: metas.filter((e) => e.scrollWidth > e.clientWidth + 1).length,
      metaTotal: metas.length,
      names: nms.map((e) => e.textContent),
      inView: r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
      h: Math.round(r.height),
    };
  });
  check('stock rows present', stk.rows > 0, stk.rows);
  check('index fund row', stk.hasIndex);
  check('burger row', stk.hasBurger);
  check('no name wraps', stk.nmWrapCount === 0, JSON.stringify(stk.nmHeights));
  check('tag lines not clipped', stk.metaClipped === 0, `${stk.metaClipped}/${stk.metaTotal}`);
  check('stocks panel in view', stk.inView, 'h=' + stk.h);
  console.log('  names ' + JSON.stringify(stk.names));

  await page.screenshot({ path: OUT + 'v_stocks.png', timeout: 180000 });
  console.log('SHOT v_stocks');

  // -------------------------------------------------------------- other panels
  const close = async (sel) => {
    // target the panel just opened: a combined selector would match a hidden
    // sibling first, since querySelector does not care about display:none
    await ev((s) => document.querySelector(s + ' .pn-x')?.click(), sel);
    await waitFrames(2);
  };
  const PANELS = [
    ['budget', '.budget-panel', 'budget'],
    ['goals', '.goals-panel', 'goals'],
    ['news', '.news-panel', 'news'],
    ['map', '.map-panel', 'map'],
    ['shop', '.shop-panel', '\u0000'],
  ];
  for (const [name, sel, label] of PANELS) {
    if (label === '\u0000') {
      await ev(() => [...document.querySelectorAll('.top-actions button')]
        .find((b) => /budget/i.test(b.textContent || ''))?.click());
      await waitFrames(2);
      await ev(() => document.querySelector('.bud-shop')?.click());
    } else {
      await ev((l) => [...document.querySelectorAll('.top-actions button')]
        .find((b) => new RegExp(l, 'i').test(b.textContent || ''))?.click(), label);
    }
    await waitFrames(3);
    const info = await ev((s) => {
      const p = document.querySelector(s);
      if (!p) return { missing: true };
      const r = p.getBoundingClientRect();
      return {
        inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
        w: Math.round(r.width), h: Math.round(r.height),
        clipped: p.scrollHeight > p.clientHeight + 1
          && getComputedStyle(p).overflowY === 'visible',
        // goals and shop render their rows on open (toggleRail's render callback),
        // so this is the first moment their row counts exist
        rows: p.querySelectorAll('.goal-row, .sh-row, .news-row, .map-card, .bud-row').length,
      };
    }, sel);
    check(name + ' panel fits', !info.missing && info.inView && !info.clipped,
      JSON.stringify(info));
    if (name === 'goals') check('8 goal rows', info.rows === 8, info.rows);
    if (name === 'shop') check('23 shop rows', info.rows === 23, info.rows);
    if (name === 'news') check('news rows rendered', info.rows > 0, info.rows);
    if (name === 'map') check('4 map cards', info.rows === 4, info.rows);
    await close(sel);
  }

  // ------------------------------------------------------------------ HUD shot
  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /goals/i.test(b.textContent || ''))?.click());
  await waitFrames(3);
  await page.screenshot({ path: OUT + 'v_hud.png', timeout: 180000 });
  console.log('SHOT v_hud');

  // ----------------------------------------------------------- edge panning
  // push the pointer into the right edge band: the camera target has to drift
  // that way, then hold still again once it leaves the band
  const tgt = () => ev(() => {
    const t = window.game.cameraSystem.target;
    return { x: t.x, z: t.z };
  });
  const t0 = await tgt();
  await page.mouse.move(1439, 450); // canvas strip past the goals panel
  await waitFrames(3);
  const t1 = await tgt();
  check('edge pan drifts right', t1.x - t0.x > 1, (t1.x - t0.x).toFixed(2));
  await page.mouse.move(720, 450);
  await waitFrames(2);
  const t2 = await tgt();
  await waitFrames(3);
  const t3 = await tgt();
  check('edge pan holds still off-edge',
    Math.abs(t3.x - t2.x) < 0.1 && Math.abs(t3.z - t2.z) < 0.1,
    (t3.x - t2.x).toFixed(2));

  check('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 4)));
  check('no external requests', ext.length === 0, JSON.stringify(ext.slice(0, 4)));

  console.log('---');
  console.log(fail.length === 0 ? 'VERIFY PASS' : `VERIFY FAIL (${fail.length}): ${fail.join(' | ')}`);
  await browser.close();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
