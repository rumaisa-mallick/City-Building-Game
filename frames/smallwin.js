/* smallwin.js — the 1000x640 pass.
 *
 * The top bar's row 2 was changed from grid columns 2-3 to all three, so the
 * controls row now starts where the brand starts instead of ~130px in. That
 * has to hold at the narrowest supported window too: row 2 must still be one
 * line of 13 buttons, must still be flush left and right, and the splash and
 * every dashboard must still fit a 640px-tall viewport.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:/Users/HP/AppData/Local/Temp/opencode/shot/';
const W = 1000, H = 640;

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
  page.on('pageerror', (e) => errs.push(e.message));
  await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
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

  // --------------------------------------------------------------- top bar
  const bar = await ev(() => {
    const b = document.querySelector('.top-actions');
    const grps = [...document.querySelectorAll('.act-grp')];
    const bb = b.getBoundingClientRect();
    const brand = document.querySelector('.brand').getBoundingClientRect();
    const padL = parseFloat(getComputedStyle(document.querySelector('.hud-top')).paddingLeft);
    const hudL = document.querySelector('.hud-top').getBoundingClientRect().left + padL;
    return {
      buttons: b.querySelectorAll('button').length,
      rows: new Set(grps.map((g) => Math.round(g.getBoundingClientRect().top))).size,
      gapL: Math.round(grps[0].getBoundingClientRect().left - bb.left),
      gapR: Math.round(bb.right - grps[grps.length - 1].getBoundingClientRect().right),
      barL: Math.round(bb.left), hudL: Math.round(hudL),
      barR: Math.round(bb.right),
      hudR: Math.round(document.querySelector('.hud-top').getBoundingClientRect().right - padL),
      barBottom: Math.round(bb.bottom),
      // one flex row must not have wrapped: the tallest button sets the height
      h: Math.round(bb.height),
    };
  });
  check('1000w: 13 buttons', bar.buttons === 13, bar.buttons);
  check('1000w: 1 row', bar.rows === 1, bar.rows);
  check('1000w: gapL 0', bar.gapL === 0, bar.gapL);
  check('1000w: gapR 0', bar.gapR === 0, bar.gapR);
  check('1000w: row2 flush left', Math.abs(bar.barL - bar.hudL) <= 2, `${bar.barL} vs ${bar.hudL}`);
  check('1000w: row2 flush right', Math.abs(bar.barR - bar.hudR) <= 2, `${bar.barR} vs ${bar.hudR}`);
  check('1000w: row2 height sane', bar.h > 20 && bar.h < 70, bar.h);

  // --------------------------------------------------------------- tool rail
  const rail = await ev(() => {
    const t = document.querySelector('.tools');
    const r = t.getBoundingClientRect();
    return {
      inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
      bottom: Math.round(r.bottom), vh: innerHeight,
      scrolls: t.scrollHeight > t.clientHeight + 1,
    };
  });
  check('1000w: tool rail fits', rail.inView, `bottom=${rail.bottom} vh=${rail.vh}`);

  // ---------------------------------------------------------------- help bar
  const help = await ev(() => {
    const h = document.querySelector('.help');
    return {
      fits: h.scrollWidth <= h.clientWidth + 1,
      hasDig: h.textContent.includes('X dig'),
      inView: h.getBoundingClientRect().bottom <= innerHeight + 1,
      swcw: `${h.scrollWidth}/${h.clientWidth}`,
    };
  });
  check('1000w: help fits', help.fits, help.swcw);
  check('1000w: help has "X dig"', help.hasDig);
  check('1000w: help in view', help.inView);

  // ------------------------------------------------------------------ splash
  await ev(() => window.game.ui.showSplash(false));
  await waitFrames(3);
  const splash = await ev(() => {
    const s = document.querySelector('.splash');
    const box = document.querySelector('.sp-box') || s;
    const r = box.getBoundingClientRect();
    return {
      inView: r.top >= -1 && r.bottom <= innerHeight + 1,
      overY: Math.round(Math.max(0, r.bottom - innerHeight)),
      h: Math.round(r.height), vh: innerHeight,
      scrollW: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stage: !!document.querySelector('.sp-go'),
      roll: !!document.querySelector('.sp-roll'),
    };
  });
  check('1000w: splash fits vertically', splash.inView && splash.overY === 0, `over=${splash.overY} h=${splash.h}/${splash.vh}`);
  check('1000w: no h-scroll', splash.scrollW === 0, splash.scrollW);
  check('1000w: both splash options', splash.stage && splash.roll);
  await page.screenshot({ path: OUT + 'w_splash.png', timeout: 180000 });
  console.log('SHOT w_splash');
  await ev(() => window.game.ui.hideSplash());
  await waitFrames(2);

  // ------------------------------------------------------------------ panels
  const PANELS = [
    ['budget', 'budget'], ['goals', 'goals'], ['news', 'news'],
    ['map', 'map'], ['stocks', '\u0000'], ['shop', '\u0000'],
  ];
  for (const [name, label] of PANELS) {
    if (label === '\u0000') {
      await ev(() => [...document.querySelectorAll('.top-actions button')]
        .find((b) => /budget/i.test(b.textContent || ''))?.click());
      await waitFrames(2);
      await ev((n) => document.querySelector(n === 'stocks' ? '.bud-stk' : '.bud-shop')?.click(), name);
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
        over: Math.round(Math.max(0, r.bottom - innerHeight, r.right - innerWidth)),
        h: Math.round(r.height),
      };
    }, '.' + (name === 'stocks' ? 'stocks' : name === 'shop' ? 'shop' : name) + '-panel');
    check(`1000w: ${name} fits`, !info.missing && info.inView, JSON.stringify(info));
    await ev(() => document.querySelector('.budget-panel .pn-x, .goals-panel .pn-x, .news-panel .pn-x, .map-panel .pn-x, .stocks-panel .pn-x, .shop-panel .pn-x')?.click());
    await waitFrames(2);
  }

  check('1000w: no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 4)));

  // final HUD shot with nothing open
  await waitFrames(2);
  await page.screenshot({ path: OUT + 'w_hud.png', timeout: 180000 });
  console.log('SHOT w_hud');

  console.log('---');
  console.log(fail.length === 0 ? 'SMALLWIN PASS' : `SMALLWIN FAIL (${fail.length}): ${fail.join(' | ')}`);
  await browser.close();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
