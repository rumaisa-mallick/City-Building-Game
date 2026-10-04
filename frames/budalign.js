/* budalign.js — are every budget label on one vertical axis?
 *
 * The four INCOME rows used to render `${ico()} Label` inside a flush-left span
 * while UPKEEP and both subtotals rendered bare text, so the income labels sat
 * ~16px right of everything else and the label axis visibly broke where
 * Gross income met UPKEEP. Measures the x of each row's FIRST TEXT NODE (not
 * the span) so an icon would be accounted for rather than hidden by it.
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
  }));
  check('13 top-actions', base.top === 13, base.top);
  check('26 tool buttons', base.tools === 26, base.tools);
  check('market cash 1000', base.cash === 1000, base.cash);
  check('25 tool costs', base.costs === 25, base.costs);

  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /budget/i.test(b.textContent || ''))?.click());
  await waitFrames(4);

  const r = await ev(() => {
    // x of the first TEXT node — a leading icon would push this right
    const textX = (el) => {
      for (const n of el.childNodes) {
        if (n.nodeType === 3 && n.textContent.trim()) {
          const rg = document.createRange();
          rg.selectNodeContents(n);
          const rc = rg.getBoundingClientRect();
          if (rc.width) return Math.round(rc.left * 10) / 10;
        }
      }
      return null;
    };
    const rows = (sel) => [...document.querySelectorAll(sel)].map((row) => {
      const span = row.querySelector('span');
      return {
        t: (span?.textContent || '').trim().slice(0, 22),
        x: span ? textX(span) : null,
        svg: span ? span.querySelectorAll('svg, .ic').length : -1,
      };
    });
    const src = rows('.bud-sources .bud-row');
    const upk = rows('.bud-upkeep .bud-row');
    const subs = rows('.bud-sub');
    const all = [...src, ...upk, ...subs].filter((x) => x.x !== null);
    const xs = [...new Set(all.map((x) => x.x))];
    const parts = ['.bud-sources', '.bud-sub', '.bud-upkeep', '.bud-net', '.bud-tax-val'];
    return {
      src, upk, subs, all,
      xs,
      svgInRows: all.filter((x) => x.svg > 0).length,
      rowCount: all.length,
      parts: parts.map((p) => [p, !!document.querySelector(p)]),
      panel: (() => {
        const p = document.querySelector('.budget-panel').getBoundingClientRect();
        return { inView: p.bottom <= innerHeight + 1 && p.right <= innerWidth + 1, h: Math.round(p.height) };
      })(),
      netText: (document.querySelector('.bud-net')?.textContent || '').replace(/\s+/g, ' ').trim(),
      subTexts: subs.map((s) => s.t),
    };
  });

  check('budget parts present', r.parts.every(([, v]) => v),
    r.parts.filter(([, v]) => !v).map(([k]) => k).join(',') || 'all 6');
  check('all rows measured', r.rowCount >= 14, r.rowCount);
  check('ALL labels share one x', r.xs.length === 1, JSON.stringify(r.xs));
  check('no svg left in budget rows', r.svgInRows === 0, r.svgInRows);
  check('income labels', r.src.map((s) => s.t).join(','), r.src.map((s) => s.t).join(','));
  check('subtotals intact', r.subTexts.some((t) => /Gross/.test(t)) && r.subTexts.some((t) => /Total upkeep/.test(t)),
    JSON.stringify(r.subTexts));
  console.log('  label x = ' + JSON.stringify(r.xs));
  console.log('  net     = ' + r.netText);
  console.log('  upkeep rows: ' + r.upk.length);
  check('panel in view', r.panel.inView, `${r.panel.h}px`);

  check('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  check('no external requests', ext.length === 0, JSON.stringify(ext.slice(0, 3)));

  console.log('---');
  console.log(fail.length === 0
    ? 'BUDALIGN PASS'
    : `BUDALIGN FAIL (${fail.length}): ${fail.join(' | ')}`);
  await browser.close();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', String(e).slice(0, 400)); process.exit(1); });
