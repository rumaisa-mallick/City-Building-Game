/* finalcheck.js — proves the two July edits landed and changed nothing else.
 *
 * 1. Goals: a completed row used to print the check twice — 'Completed ✓' in the
 *    progress text AND '✓' in the reward column. The text must now be bare
 *    'Completed' while the reward column keeps its '✓'.
 * 2. Shop: .sh-lbl was the only section divider in the app that was accent-green
 *    with a leading icon, and .shop-list stacked its own border-top directly
 *    above the label. It must now match .pn-lbl exactly (colour, trailing rule,
 *    no icon) with no border-top left to double up on.
 *
 * Also re-proves the standing invariants so neither edit quietly broke them.
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

  // ---- standing invariants -------------------------------------------------
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

  // ---- goals: one check, not two ------------------------------------------
  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /goals/i.test(b.textContent || ''))?.click());
  await waitFrames(4);

  const g = await ev(() => {
    const rows = [...document.querySelectorAll('.goal-row')];
    const done = rows.filter((r) => r.classList.contains('done'));
    return {
      rows: rows.length,
      done: done.length,
      // the bug: progress text carried its own glyph alongside the reward column
      doubleChecks: done.filter((r) => {
        const p = r.querySelector('.goal-prog')?.textContent || '';
        const w = r.querySelector('.goal-reward')?.textContent || '';
        return p.includes('✓') && w.includes('✓');
      }).length,
      progTexts: done.map((r) => (r.querySelector('.goal-prog')?.textContent || '').trim()),
      // reward column must still carry the glyph for every completed row
      rewardChecks: done.filter((r) => (r.querySelector('.goal-reward')?.textContent || '').includes('✓')).length,
      // unfinished rows keep the real fraction + reward
      sampleOpen: rows.filter((r) => !r.classList.contains('done')).slice(0, 2).map((r) =>
        `${(r.querySelector('.goal-label')?.textContent || '').trim()} | ` +
        `${(r.querySelector('.goal-prog')?.textContent || '').trim()} | ` +
        `${(r.querySelector('.goal-reward')?.textContent || '').trim()}`),
      allText: rows.every((r) => (r.textContent || '').trim().length > 0),
      inView: (() => {
        const r = document.querySelector('.goals-panel').getBoundingClientRect();
        return r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;
      })(),
    };
  });
  check('8 goal rows', g.rows === 8, g.rows);
  check('some rows completed', g.done > 0, g.done);
  check('NO double checkmarks', g.doubleChecks === 0, g.doubleChecks);
  check('progress text is bare "Completed"', g.progTexts.every((t) => t === 'Completed'), JSON.stringify(g.progTexts));
  check('reward column keeps its check', g.rewardChecks === g.done, `${g.rewardChecks}/${g.done}`);
  check('open rows keep fraction+reward', g.sampleOpen.length === 2, JSON.stringify(g.sampleOpen));
  check('all goal rows have text', g.allText);
  check('goals panel in view', g.inView);
  console.log('  done rows: ' + g.done);

  // ---- shop: label matches the ledger's divider ---------------------------
  await ev(() => [...document.querySelectorAll('.top-actions button')]
    .find((b) => /budget/i.test(b.textContent || ''))?.click());
  await waitFrames(2);
  await ev(() => document.querySelector('.bud-shop')?.click());
  await waitFrames(5);

  const s = await ev(() => {
    const lbl = document.querySelector('.sh-lbl');
    const ref = document.querySelector('.pn-lbl');
    const list = document.querySelector('.shop-list');
    const panel = document.querySelector('.shop-panel');
    const cs = lbl ? getComputedStyle(lbl) : null;
    const rs = ref ? getComputedStyle(ref) : null;
    const after = lbl ? getComputedStyle(lbl, '::after') : null;
    const ls = list ? getComputedStyle(list) : null;
    const r = panel.getBoundingClientRect();
    return {
      label: (lbl?.textContent || '').trim(),
      // no icon of either kind left in the label
      iconsInLabel: lbl ? lbl.querySelectorAll('svg, .ic, img').length : -1,
      labelColor: cs?.color || null,
      refColor: rs?.color || null,
      labelDisplay: cs?.display || null,
      refDisplay: rs?.display || null,
      ruleContent: after?.content || null,
      ruleFlex: after?.flexGrow || null,
      listBorderTop: ls?.borderTopWidth || null,
      rows: document.querySelectorAll('.sh-row').length,
      panelH: Math.round(r.height),
      inView: r.top >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1,
      scrolls: list ? list.scrollHeight > list.clientHeight + 1 : null,
      scroll: list ? `${list.scrollHeight}/${list.clientHeight}` : null,
    };
  });

  check('label text', s.label === 'WHAT YOU CAN BUY', JSON.stringify(s.label));
  check('no icon in label', s.iconsInLabel === 0, s.iconsInLabel);
  check('label colour == pn-lbl colour', s.labelColor === s.refColor, `${s.labelColor} vs ${s.refColor}`);
  check('label display == pn-lbl display', s.labelDisplay === s.refDisplay, `${s.labelDisplay} vs ${s.refDisplay}`);
  check('trailing rule present', s.ruleContent !== 'none', s.ruleContent);
  check('rule grows to fill', s.ruleFlex === '1', s.ruleFlex);
  check('shop-list border-top removed', s.listBorderTop === '0px', s.listBorderTop);
  check('23 shop rows', s.rows === 23, s.rows);
  check('shop panel in view', s.inView, `${s.panelH}px`);
  check('list still scrolls as designed', s.scrolls === true, s.scroll);

  check('no page errors', errs.length === 0, JSON.stringify(errs.slice(0, 3)));
  check('no external requests', ext.length === 0, JSON.stringify(ext.slice(0, 3)));

  console.log('---');
  console.log(fail.length === 0
    ? 'FINALCHECK PASS'
    : `FINALCHECK FAIL (${fail.length}): ${fail.join(' | ')}`);
  await browser.close();
  process.exit(fail.length === 0 ? 0 : 1);
})().catch((e) => { console.error('CRASH', String(e).slice(0, 400)); process.exit(1); });
