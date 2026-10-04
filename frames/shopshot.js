/* shopshot.js — one frame: the shop dashboard at 1440x900.
 *
 * design.js reached d_06 (map) before the dev server was restarted out from
 * under it, so Shop is the only panel never reviewed visually. This captures
 * just that, plus the stocks panel for a same-session comparison of the two
 * dense grid layouts, rather than re-running the whole 11-frame pass.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:/Users/HP/Desktop/Game/frames/';
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

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
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 250)));
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

  const shoot = async (name) => {
    await page.screenshot({ path: OUT + name + '.png', timeout: 180000 });
    console.log('SHOT ' + name);
  };

  // shop
  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /budget/i.test(b.textContent || ''))?.click());
  await waitFrames(2);
  await ev(() => document.querySelector('.bud-shop')?.click());
  await waitFrames(4);
  await shoot('d_08_shop_1440');

  const shopGeom = await ev(() => {
    const p = document.querySelector('.shop-panel');
    const r = p.getBoundingClientRect();
    return {
      box: `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)},${Math.round(r.left)}`,
      inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
      rows: document.querySelectorAll('.sh-row').length,
      labels: [...document.querySelectorAll('.sh-lbl')].map((e) => e.textContent.trim()),
      stats: [...document.querySelectorAll('.sh-stat')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()),
      buttons: p.querySelectorAll('button').length,
      scrolls: p.scrollHeight > p.clientHeight + 1,
      scroll: `${p.scrollHeight}/${p.clientHeight}`,
      // the list has its own cap — report it separately from panel-level scroll
      listScroll: (() => {
        const l = p.querySelector('.shop-list');
        return l ? `${l.scrollHeight}/${l.clientHeight}` : null;
      })(),
    };
  });
  console.log('SHOP ' + JSON.stringify(shopGeom));

  // close, then the exchange, for a side-by-side of the two dense grids
  await ev(() => document.querySelector('.shop-panel .pn-x')?.click());
  await waitFrames(2);
  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /budget/i.test(b.textContent || ''))?.click());
  await waitFrames(2);
  await ev(() => document.querySelector('.bud-stk')?.click());
  await waitFrames(4);
  await shoot('d_07_stocks_1440');

  console.log('PAGE ERRORS ' + errs.length + ' ' + JSON.stringify(errs.slice(0, 4)));
  console.log('SHOPSHOT DONE');
  await browser.close();
})().catch((e) => { console.error('CRASH', String(e).slice(0, 400)); process.exit(1); });
