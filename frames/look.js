/* look.js — capture every screen for a visual review pass.
 *
 * Same flow as design.js (splash first, then each panel open/shoot/close) but
 * writes to its own folder so an audit never overwrites the reference shots.
 */
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:/Users/HP/AppData/Local/Temp/opencode/shot/look/';
fs.mkdirSync(OUT, { recursive: true });
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const shots = [];

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

  const shoot = async (name) => {
    const f = `${name}.png`;
    await page.screenshot({ path: OUT + f, timeout: 180000 });
    shots.push(f);
    console.log('SHOT ' + f);
  };

  const clickAction = (re) =>
    ev((pat) => [...document.querySelectorAll('.top-actions button')]
      .find((b) => new RegExp(pat, 'i').test(b.textContent || ''))?.click(), re);

  const openPanel = async (name) => {
    if (name === 'stocks' || name === 'shop') {
      await clickAction('budget');
      await waitFrames(2);
      await ev((n) => document.querySelector(n === 'stocks' ? '.bud-stk' : '.bud-shop')?.click(), name);
    } else {
      await clickAction(name);
    }
    await waitFrames(3);
  };
  const closePanel = async (name) => {
    await ev((n) => document.querySelector(`.${n}-panel .pn-x`)?.click(), name);
    await waitFrames(2);
  };

  await ev(() => window.game.ui.showSplash(false));
  await waitFrames(3);
  await shoot('01_splash');
  await ev(() => window.game.ui.hideSplash());
  await waitFrames(3);

  await shoot('02_hud');

  for (const name of ['budget', 'goals', 'news', 'map', 'stocks', 'shop']) {
    await openPanel(name);
    await shoot(`03_${name}`);
    await closePanel(name);
  }

  // selection card: click a placed building with the select tool
  await ev(() => window.game.build.setTool('select'));
  const picked = await ev(() => {
    const g = window.game;
    const placed = g.city.placed ?? g.city.placedRecords ?? [];
    if (!placed.length) return false;
    const b = g.city.buildings?.[0] ?? null;
    return !!b;
  });
  if (picked) {
    await waitFrames(2);
    await shoot('04_selection');
  }

  console.log('PAGE ERRORS ' + errs.length + ' ' + JSON.stringify(errs.slice(0, 4)));
  console.log('---');
  console.log('LOOK SHOTS ' + shots.length + ': ' + shots.join(' '));
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
