/* diag.js — why does window.game never appear?
 *
 * design.js loaded the page fine (goto resolved) but the readiness predicate
 * never became true for 6+ minutes, where earlier probes reached it in ~60s
 * against the same server. This captures everything needed to tell the four
 * candidates apart: a thrown script error, a request that never settles, a
 * Vite transform still pending, or simply a slow boot.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 120000,
    args: [
      '--no-sandbox', '--enable-unsafe-swiftshader', '--use-angle=swiftshader',
      '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
    ],
  });
  const page = await browser.newPage();
  const errs = [];
  const consoles = [];
  const failed = [];
  let reqCount = 0;
  page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoles.push(m.type() + ': ' + m.text().slice(0, 200));
  });
  page.on('requestfailed', (r) => failed.push(r.url().slice(0, 140) + ' :: ' + (r.failure() || {}).errorText));
  page.on('request', () => { reqCount++; });

  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const t0 = Date.now();
  await page.goto('http://localhost:5273', { waitUntil: 'load', timeout: 120000 });
  console.log('goto ok in ' + ((Date.now() - t0) / 1000).toFixed(1) + 's, requests=' + reqCount);

  // poll the readiness predicate, reporting its two halves separately so
  // "game missing" is distinguishable from "game present but city empty"
  let ready = false;
  for (let i = 0; i < 15; i++) {
    const s = await page.evaluate(() => ({
      game: typeof window.game,
      hasCity: !!(window.game && window.game.city),
      buildings: window.game && window.game.city ? window.game.city.stats().buildings : -1,
      scripts: [...document.scripts].map((x) => (x.src || 'inline').split('/').pop()).slice(0, 6),
      readyState: document.readyState,
      bodyKids: document.body ? document.body.children.length : -1,
    })).catch((e) => ({ evalError: String(e).slice(0, 200) }));
    console.log(`t+${i * 4}s  ` + JSON.stringify(s));
    if (s.game === 'object' && s.buildings > 0) { ready = true; break; }
    await settle(4000);
  }

  console.log('---');
  console.log('READY      : ' + ready);
  console.log('PAGE ERRORS: ' + errs.length);
  errs.slice(0, 6).forEach((e) => console.log('  ! ' + e));
  console.log('CONSOLE    : ' + consoles.length);
  consoles.slice(0, 8).forEach((c) => console.log('  > ' + c));
  console.log('REQ FAILED : ' + failed.length);
  failed.slice(0, 8).forEach((f) => console.log('  x ' + f));
  console.log('TOTAL REQ  : ' + reqCount);
  await browser.close();
})().catch((e) => { console.error('CRASH', String(e).slice(0, 400)); process.exit(1); });
