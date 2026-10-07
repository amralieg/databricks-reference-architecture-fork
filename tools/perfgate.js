'use strict';
const { chromium } = require('playwright');
const { serve } = require('./lib_serve');

const PAINT_ALLOWED = new Set(['flowdash', 'flowdashv', 'flowdashl', 'flowdashu', 'zdash']);
const COMPOSITED = new Set(['transform', 'opacity']);
const SHAPES = ['z', 's', 't', 'rt', 'h90'];
const R = [];
const ok = (n, c, d) => { R.push({ n, c: !!c }); console.log((c ? 'PASS ' : 'FAIL ') + n + (d ? ' :: ' + d : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const inventory = page => page.evaluate(() => document.getAnimations()
  .filter(a => a.playState === 'running')
  .map(a => ({
    name: a.animationName || '',
    iterations: a.effect.getTiming().iterations,
    duration: a.effect.getTiming().duration,
    props: [...new Set(a.effect.getKeyframes().flatMap(k => Object.keys(k)
      .filter(p => !['offset', 'easing', 'composite', 'computedOffset'].includes(p))))],
  })));

async function open(browser, url, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1728, height: 993 } }, opts.ctx || {}));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  await page.addInitScript(o => {
    try { localStorage.setItem('dbx-arch-tour-v1', '1'); } catch (e) {}
    if (o.lang) try { localStorage.setItem('dbxarch.lang', o.lang); } catch (e) {}
    window.__firstBuild = null;
    window.__nav = [];
    new MutationObserver(ms => {
      ms.forEach(m => { if (m.type === 'attributes' && m.target.id === 'nav-progress')
        window.__nav.push({ on: m.target.classList.contains('on'), t: performance.now() }); });
      if (!window.__firstBuild && document.querySelector('#platform .atom'))
        window.__firstBuild = { lang: document.documentElement.getAttribute('lang') };
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }, { lang: opts.lang || null });
  if (opts.clock) await page.clock.install();
  if (opts.rtt) {
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: opts.rtt, downloadThroughput: 20 * 125000, uploadThroughput: 5 * 125000 });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  return { ctx, page, errs };
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch({ headless: true });
  const errs = [];

  {
    const { ctx, page, errs: e } = await open(browser, base + '?industry=banking');
    await sleep(800);
    const inv = await inventory(page);
    const bad = inv.filter(a => a.iterations === Infinity && !PAINT_ALLOWED.has(a.name) && !a.props.every(p => COMPOSITED.has(p)));
    ok('no endless animation repaints outside the allowlist', bad.length === 0, bad.map(a => a.name + '[' + a.props.join('+') + ']').join(', '));
    const nav = await page.evaluate(() => ({ on: document.getElementById('nav-progress').classList.contains('on'),
      running: document.getAnimations().some(a => a.animationName === 'navslide' && a.playState === 'running') }));
    ok('loading bar idle when nothing is loading', !nav.on && !nav.running, JSON.stringify(nav));
    const pulses = inv.filter(a => a.name === 'badgePulse');
    const finite = pulses.every(a => Number.isFinite(a.iterations) && a.iterations <= 5);
    ok('dot pulses are finite', pulses.length > 0 && finite, 'pulses=' + pulses.length);
    if (finite) await sleep(pulses.reduce((m, a) => Math.max(m, a.duration * a.iterations), 0) + 800);
    const after = await inventory(page);
    ok('dot pulses end and leave a static glow', !after.some(a => a.name === 'badgePulse'), 'still=' + after.filter(a => a.name === 'badgePulse').length);
    ok('steady state runs only the connector dots and the ring', after.every(a => PAINT_ALLOWED.has(a.name)), after.map(a => a.name).join(','));
    errs.push(...e);
    await ctx.close();
  }

  {
    const { ctx, page, errs: e } = await open(browser, base + '?industry=retail', { clock: true });
    const restMs = await page.evaluate(() => typeof MOTION_REST_MS === 'number' ? MOTION_REST_MS : 60000);
    await page.clock.fastForward(restMs - 2000);
    ok('still moving just before the rest timeout', !(await page.evaluate(() => document.body.classList.contains('motion-rest'))));
    await page.clock.fastForward(3000);
    const rest = await page.evaluate(() => ({ cls: document.body.classList.contains('motion-rest'),
      running: document.getAnimations().filter(a => a.playState === 'running').length }));
    ok('rests after ' + restMs / 1000 + ' s without input', rest.cls && rest.running === 0, JSON.stringify(rest));
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
    const m = async () => (await cdp.send('Performance.getMetrics')).metrics.reduce((o, x) => (o[x.name] = x.value, o), {});
    const a = await m(); await sleep(3000); const b = await m();
    const busy = (b.TaskDuration - a.TaskDuration) / 3 * 100;
    ok('main thread idle at rest (< 2%)', busy < 2, busy.toFixed(2) + '%');
    const html = await page.evaluate(() => exportHtmlDoc());
    const bodyTag = (html.match(/<body[^>]*>/) || [''])[0];
    ok('HTML export does not carry the rest state', !/motion-rest/.test(bodyTag), bodyTag.slice(0, 120));
    await page.mouse.move(200, 300);
    await page.mouse.move(260, 340);
    await sleep(300);
    const woke = await page.evaluate(() => ({ cls: document.body.classList.contains('motion-rest'),
      running: document.getAnimations().filter(a => a.playState === 'running').length }));
    ok('pointer input wakes the motion', !woke.cls && woke.running > 0, JSON.stringify(woke));
    const vis = await page.evaluate(() => {
      const set = h => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); };
      set(true); const hidden = document.body.classList.contains('motion-rest');
      set(false); const shown = document.body.classList.contains('motion-rest');
      return { hidden, shown };
    });
    ok('hidden tab rests, visible tab wakes', vis.hidden && !vis.shown, JSON.stringify(vis));
    errs.push(...e);
    await ctx.close();
  }

  for (const shape of SHAPES) {
    const { ctx, page, errs: e } = await open(browser, base + '?industry=banking&shape=' + shape, { ctx: { reducedMotion: 'reduce' } });
    await sleep(500);
    const deco = (await inventory(page)).filter(a => a.name !== 'navslide' && a.iterations === Infinity);
    ok('reduced motion stops every endless animation (' + shape + ')', deco.length === 0, deco.map(a => a.name).join(','));
    const pulses = (await inventory(page)).filter(a => a.name === 'badgePulse');
    ok('reduced motion shows no dot pulse (' + shape + ')', pulses.length === 0, 'pulses=' + pulses.length);
    errs.push(...e);
    await ctx.close();
  }

  {
    const { ctx, page, errs: e } = await open(browser, base + '?industry=banking&lang=de', { rtt: 150 });
    const t = await page.evaluate(() => performance.getEntriesByType('resource').map(r => ({
      p: new URL(r.name).pathname, s: r.startTime, e: r.responseEnd })));
    const want = ['/version.json', '/resources/links.json', '/architectures/manifest.json', '/architectures/banking.yaml', '/translations/de/_common.json', '/translations/de/banking.json'];
    const hits = want.map(w => t.filter(x => x.p.endsWith(w)));
    ok('every boot fetch issued exactly once', hits.every(h => h.length === 1), want.map((w, i) => w + '=' + hits[i].length).join(' '));
    const got = hits.filter(h => h.length).map(h => h[0]);
    const lastStart = Math.max(...got.map(x => x.s)), firstEnd = Math.min(...got.map(x => x.e));
    ok('boot fetches run in parallel, not one after another', got.length === want.length && lastStart < firstEnd,
      'last start ' + lastStart.toFixed(0) + 'ms, first end ' + firstEnd.toFixed(0) + 'ms');
    const lastEnd = Math.max(...got.map(x => x.e));
    const nav = await page.evaluate(() => window.__nav);
    const early = nav.filter(x => !x.on && x.t < lastEnd - 5);
    ok('loading bar stays on until the last boot fetch lands', nav.some(x => x.on) && early.length === 0,
      'last fetch ' + lastEnd.toFixed(0) + 'ms, bar off at ' + nav.filter(x => !x.on).map(x => x.t.toFixed(0)).join(',') + 'ms');
    const fb = await page.evaluate(() => window.__firstBuild);
    ok('first build is already in the linked language', fb && fb.lang === 'de', JSON.stringify(fb));
    errs.push(...e);
    await ctx.close();
  }

  {
    const { ctx, page, errs: e } = await open(browser, base, { lang: 'fr' });
    const fb = await page.evaluate(() => ({ first: window.__firstBuild, now: document.documentElement.getAttribute('lang') }));
    ok('first build is already in the saved language', fb.first && fb.first.lang === 'fr' && fb.now === 'fr', JSON.stringify(fb));
    errs.push(...e);
    await ctx.close();
  }

  ok('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
  await browser.close();
  server.close();
  const failed = R.filter(r => !r.c).length;
  console.log('\n' + (R.length - failed) + '/' + R.length + ' perf checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
