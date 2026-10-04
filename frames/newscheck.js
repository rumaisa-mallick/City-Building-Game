/* newscheck.js — does the day stamp now print once per run of same-days?
 *
 * Before the fix renderNews() stamped every row, so a day-1 city showed seven
 * identical "DAY 1" labels stacked in the feed. The row count must not change
 * (probes count .news-row); only the number of stamps should drop to the number
 * of distinct day-runs in the list.
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

  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /news/i.test(b.textContent || ''))?.click());
  await waitFrames(4);

  const r = await ev(() => {
    const rows = [...document.querySelectorAll('.news-row')];
    const raw = window.game.city.news.map((n) => n.day);
    // independent expectation: a stamp per run of equal consecutive days
    let runs = 0;
    let prev = null;
    for (const d of raw) { if (d !== prev) { runs++; prev = d; } }
    return {
      rows: rows.length,
      stamps: document.querySelectorAll('.news-day').length,
      expectedRuns: runs,
      days: raw,
      // a stamped row must still show its text; an unstamped one must too
      textRows: rows.filter((x) => x.querySelector('.news-text')).length,
      rowsWithText: rows.filter((x) => (x.textContent || '').trim().length > 0).length,
      empty: rows.filter((x) => !(x.textContent || '').trim()).length,
      firstThree: rows.slice(0, 3).map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
      inView: (() => {
        const p = document.querySelector('.news-panel').getBoundingClientRect();
        return p.bottom <= innerHeight + 1 && p.right <= innerWidth + 1;
      })(),
    };
  });

  const fail = [];
  const check = (l, ok, d) => {
    console.log((ok ? 'OK   ' : 'FAIL ') + l + (d === undefined ? '' : '  ' + d));
    if (!ok) fail.push(l);
  };

  check('rows rendered', r.rows > 0, r.rows);
  check('stamps == day runs', r.stamps === r.expectedRuns, `${r.stamps} vs ${r.expectedRuns}`);
  check('stamps < rows (grouped)', r.stamps < r.rows, `${r.stamps} < ${r.rows}`);
  check('every row has text', r.rowsWithText === r.rows, `${r.rowsWithText}/${r.rows}`);
  check('no empty rows', r.empty === 0, r.empty);
  check('panel in view', r.inView);

  console.log('days ' + JSON.stringify(r.days));
  r.firstThree.forEach((t) => console.log('  row: ' + t));
  console.log('PAGE ERRORS ' + errs.length + ' ' + JSON.stringify(errs.slice(0, 3)));
  console.log('---');
  console.log(fail.length === 0 ? 'NEWSCHECK PASS' : `NEWSCHECK FAIL (${fail.length}): ${fail.join(' | ')}`);
  await browser.close();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', String(e).slice(0, 400)); process.exit(1); });
