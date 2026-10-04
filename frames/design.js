/* design.js — visual audit of every screen, both supported windows.
 *
 * The functional sweeps (verify.js, smallwin.js) prove counts, fit and absence
 * of overflow; none of that says whether a panel *looks* designed. This captures
 * each screen at 1440x900 and the two most-relied-on views again at 1000x640 so
 * spacing, hierarchy, alignment and colour can be judged directly.
 *
 * News, Map and Shop have never been reviewed visually — their frames were lost
 * when the temp directory was wiped — so those come first in the capture order.
 *
 * Screenshots are the expensive part (~60s each under SwiftShader), so the pass
 * opens a panel, waits for a repaint, shoots, and closes again rather than
 * keeping all six open and screenshotting once.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:/Users/HP/AppData/Local/Temp/opencode/shot/';
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

  // ---------------------------------------------------------------- 1440x900
  // splash first: it is only reachable from a clean load state
  await ev(() => window.game.ui.showSplash(false));
  await waitFrames(3);
  await shoot('d_01_splash_1440');
  await ev(() => window.game.ui.hideSplash());
  await waitFrames(3);

  await shoot('d_02_hud_1440');

  for (const [i, name] of ['budget', 'goals', 'news', 'map', 'stocks', 'shop'].entries()) {
    await openPanel(name);
    await shoot(`d_0${i + 3}_${name}_1440`);
    await closePanel(name);
  }

  // --------------------------------------------------------------- 1000x640
  await page.setViewport({ width: 1000, height: 640, deviceScaleFactor: 1 });
  await waitFrames(4);
  await shoot('d_09_hud_1000');
  await openPanel('budget');
  await shoot('d_10_budget_1000');
  await closePanel('budget');
  await ev(() => window.game.ui.showSplash(false));
  await waitFrames(3);
  await shoot('d_11_splash_1000');
  await ev(() => window.game.ui.hideSplash());
  await waitFrames(2);

  // geometry worth having alongside the images: what each panel actually is
  const geom = await ev(() => {
    const out = {};
    for (const cls of ['budget', 'goals', 'news', 'map', 'stocks', 'shop']) {
      out[cls] = [...document.querySelectorAll('.' + cls + '-panel')]
        .map((p) => {
          const r = p.getBoundingClientRect();
          return `${Math.round(r.width)}x${Math.round(r.height)}@${Math.round(r.top)},${Math.round(r.left)}`;
        }).join(',');
    }
    return { out, vh: innerHeight, vw: innerWidth };
  });
  console.log('GEOM ' + JSON.stringify(geom));

  console.log('PAGE ERRORS ' + errs.length + ' ' + JSON.stringify(errs.slice(0, 4)));
  console.log('---');
  console.log('DESIGN SHOTS ' + shots.length + ': ' + shots.join(' '));
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
