/* budcheck.js — where do the budget subtotal and the Net/min plate actually go?
 *
 * The 1000x640 shot showed the upkeep list running straight into the Stock
 * Exchange button with only a hairline between them: neither the "Total upkeep"
 * subtotal nor the .bud-net plate was readable. This reports every budget
 * element's geometry and text, plus the panel's scroll state, so the difference
 * between "not rendered", "rendered but empty" and "rendered but pushed out of
 * the panel" is settled by numbers rather than by squinting at a PNG.
 */
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:/Users/HP/AppData/Local/Temp/opencode/shot/';

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
  await page.setViewport({ width: 1000, height: 640, deviceScaleFactor: 1 });
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

  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /budget/i.test(b.textContent || ''))?.click());
  await waitFrames(3);

  const info = await ev(() => {
    const p = document.querySelector('.budget-panel');
    const pr = p.getBoundingClientRect();
    const box = (sel) => {
      const e = p.querySelector(sel);
      if (!e) return { missing: true };
      const r = e.getBoundingClientRect();
      return {
        top: Math.round(r.top - pr.top),
        h: Math.round(r.height),
        visible: r.height > 0,
        text: (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 90),
      };
    };
    return {
      panel: {
        top: Math.round(pr.top), bottom: Math.round(pr.bottom),
        h: Math.round(pr.height),
        scrollH: p.scrollHeight, clientH: p.clientHeight,
        scrollTop: p.scrollTop,
        scrolls: p.scrollHeight > p.clientHeight + 1,
        overflowY: getComputedStyle(p).overflowY,
        maxH: getComputedStyle(p).maxHeight,
      },
      vh: innerHeight,
      budget: window.game.city.budget(),
      tax: box('.bud-tax'),
      src: box('.bud-sources'),
      up: box('.bud-upkeep'),
      net: box('.bud-net'),
      stocks: box('.bud-stocks'),
      subs: [...p.querySelectorAll('.bud-sub')].map((e) => {
        const r = e.getBoundingClientRect();
        return {
          top: Math.round(r.top - pr.top),
          h: Math.round(r.height),
          text: (e.textContent || '').replace(/\s+/g, ' ').trim(),
          inPanel: r.bottom <= pr.bottom + 1,
        };
      }),
      // every direct child in order, so the sequence itself is on record
      kids: [...p.children].map((e) => {
        const r = e.getBoundingClientRect();
        return `${e.className.split(' ')[0]}@${Math.round(r.top - pr.top)}+${Math.round(r.height)}`;
      }),
      // A plate is only readable if nothing opaque is painted over it. The two
      // candidates are the pinned header and the pinned floor; crucially, a
      // pinned ANCESTOR does not occlude its own child, so an element that has
      // moved inside .bud-stocks reports clear while a former sibling of it
      // reports covered.
      occl: (() => {
        const head = p.querySelector('.pn-head');
        const floor = p.querySelector('.bud-stocks');
        const R = (e) => (e ? e.getBoundingClientRect() : null);
        const ov = (a, b) => a && b && a.top < b.bottom && a.bottom > b.top;
        const test = (el) => {
          if (!el) return { missing: true };
          const r = R(el);
          return {
            text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
            top: Math.round(r.top - pr.top), h: Math.round(r.height),
            underHead: ov(r, R(head)) && !head.contains(el),
            underFloor: ov(r, R(floor)) && !floor.contains(el),
          };
        };
        const u = p.querySelector('.bud-rows.bud-upkeep .bud-sub');
        return {
          net: test(p.querySelector('.bud-net')),
          totalUp: test(u),
          netInsideFloor: floor.contains(p.querySelector('.bud-net')),
        };
      })(),
    };
  });

  console.log('PANEL', JSON.stringify(info.panel), 'vh=' + info.vh);
  console.log('BUDGET', JSON.stringify(info.budget));
  console.log('KIDS   ', info.kids.join(' | '));
  console.log('TAX    ', JSON.stringify(info.tax));
  console.log('SRC    ', JSON.stringify(info.src));
  console.log('UP     ', JSON.stringify(info.up));
  console.log('SUBS   ', JSON.stringify(info.subs));
  console.log('NET    ', JSON.stringify(info.net));
  console.log('STOCKS ', JSON.stringify(info.stocks));

  console.log('OCCL   ', JSON.stringify(info.occl));
  const clear = (b) => b && !b.missing && !b.underHead && !b.underFloor;
  const netOk = clear(info.occl.net) && /Net/i.test(info.occl.net.text || '');
  console.log('---');
  console.log('net readable (not occluded): ' + netOk);
  console.log('net inside pinned floor    : ' + info.occl.netInsideFloor);
  console.log('total upkeep readable @0   : ' + clear(info.occl.totalUp)
    + '   (ledger may scroll: detail, not the result)');
  console.log('panel scrolls              : ' + info.panel.scrolls
    + ' scrollH=' + info.panel.scrollH + ' clientH=' + info.panel.clientH);
  console.log(netOk && info.occl.netInsideFloor ? 'BUDCHECK PASS' : 'BUDCHECK FAIL');

  await page.screenshot({ path: OUT + 'bud_1000.png', timeout: 180000 });
  console.log('SHOT bud_1000');
  console.log('PAGE ERRORS', errs.length, JSON.stringify(errs.slice(0, 4)));
  await browser.close();
})().catch((e) => { console.error('CRASH', e); process.exit(1); });
