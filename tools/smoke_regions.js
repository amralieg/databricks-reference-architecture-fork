#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const { serve, boardReady } = require('./lib_serve');

const results = [];
function check(name, cond, detail) { results.push({ name, ok: !!cond, detail }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : '')); }

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch();
  const errors = [];
  const open = async (q, width) => {
    const ctx = await browser.newContext({ viewport: { width: width || 1600, height: 1000 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('dbx-arch-tour-v1', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + q, { waitUntil: 'networkidle' });
    await boardReady(page);
    await page.waitForTimeout(500);
    return { ctx, page };
  };

  for (const cloud of ['aws', 'azure', 'gcp']) {
    const { ctx, page } = await open('?cloud=' + cloud);
    for (const name of ['Lakebase', 'Genie App Builder', 'AI Search', 'Model Serving', 'Unity Catalog']) {
      const r = await page.evaluate((name) => {
        const id = Object.keys(byId).find(k => byId[k].tile && byId[k].tile.n === name);
        openDetail(id);
        const body = document.getElementById('d-body');
        const out = { line: !!body.querySelector('.d-region, .d-regsum'),
          text: /Available in|Regional availability|Not yet available on/.test(body.textContent) };
        closeDrawer();
        return out;
      }, name);
      check(cloud + ': ' + name + "'s panel shows no regional availability", !r.line && !r.text, JSON.stringify(r));
    }
    const dim = await page.evaluate(() => {
      const cr = REGIONS.clouds[curCloud()], col = cr.features['Lakebase (product page)'];
      const out = cr.regions.find(x => !col[x.code]), inn = cr.regions.find(x => col[x.code]);
      const lakebase = () => [...document.querySelectorAll('.atom')].find(a => byId[a.dataset.id] && byId[a.dataset.id].tile.n === 'Lakebase');
      const res = {};
      if (out) { setRegion(out.code); res.outside = lakebase().classList.contains('rg-off'); }
      if (inn) { setRegion(inn.code); res.inside = lakebase().classList.contains('rg-off'); }
      setRegion('');
      return res;
    });
    if ('outside' in dim) check(cloud + ': a region Lakebase does not list dims it', dim.outside === true);
    if ('inside' in dim) check(cloud + ': a region Lakebase lists keeps it lit', dim.inside === false);
    const every = await page.evaluate(() => {
      const cr = REGIONS.clouds[curCloud()], out = { cases: 0, bad: [] };
      const atom = n => [...document.querySelectorAll('.atom')].find(a => byId[a.dataset.id] && byId[a.dataset.id].tile.n === n);
      for (const name of Object.keys(REGIONS.alias)) {
        const el = atom(name);
        if (!el) continue;
        const t = byId[el.dataset.id].tile, lab = regionFeatureLabel(t);
        if (!lab || stageKey(stageFor(t)) === 'soon') continue;
        const col = cr.features[lab];
        for (const [r, want] of [[cr.regions.find(x => !col[x.code]), true], [cr.regions.find(x => col[x.code]), false]]) {
          if (!r) continue;
          setRegion(r.code);
          out.cases++;
          if (atom(name).classList.contains('rg-off') !== want) out.bad.push(name + (want ? ' stays lit in ' : ' dims in ') + r.code);
        }
      }
      setRegion('');
      return out;
    });
    check(cloud + ': every mapped product dims where its docs column says no and stays lit where it says yes (' + every.cases + ' cases)',
      every.cases > 0 && !every.bad.length, every.bad.slice(0, 4).join(', '));
    if (cloud === 'azure') {
      const qatar = await page.evaluate(() => {
        const dimmed = n => { const a = [...document.querySelectorAll('.atom')].find(x => byId[x.dataset.id] && byId[x.dataset.id].tile.n === n); return a && a.classList.contains('rg-off'); };
        setRegion('qatarcentral');
        const out = { serverless: dimmed('Serverless Compute'), serving: dimmed('Model Serving'), uc: dimmed('Unity Catalog') };
        setRegion('westeurope');
        out.westServerless = dimmed('Serverless Compute');
        setRegion('');
        return out;
      });
      check('azure: Qatar Central dims Serverless Compute and Model Serving and keeps Unity Catalog; West Europe keeps serverless',
        qatar.serverless === true && qatar.serving === true && qatar.uc === false && qatar.westServerless === false, JSON.stringify(qatar));
    }
    await ctx.close();
  }

  const DOCS_OF = { aws: ['https://docs.databricks.com/aws/en/'], gcp: ['https://docs.databricks.com/gcp/en/'],
    azure: ['https://learn.microsoft.com/en-us/azure/databricks/', 'https://learn.microsoft.com/azure/databricks/'] };
  const LADDER = ['GA', 'Public Preview', 'Beta', 'Private Preview', 'Coming soon'];
  for (const cloud of ['aws', 'azure', 'gcp']) {
    const { ctx, page } = await open('?cloud=' + cloud);
    const code = await page.evaluate(() => REGIONS.clouds[curCloud()].regions[0].code);
    await page.click('#region-btn');
    await page.click('#region-menu button[data-region="' + code + '"]');
    await page.waitForTimeout(300);
    const r = await page.evaluate(({ code, docs, ladder }) => {
      const cr = REGIONS.clouds[curCloud()], rows = regionRowsNow, names = new Set(rows.map(x => x.n));
      const onCloud = (u, api) => docs.some(d => (u || '').startsWith(d)) || (api && (u || '').startsWith('https://docs.databricks.com/api/'));
      const want = Object.keys(cr.meta).map(rgName).concat(Object.keys(cr.derived), cr.designated.rows.map(d => d.n));
      const shown = [...document.querySelectorAll('#d-body .rg-row')];
      return { open: document.body.classList.contains('detail-open') && !!document.querySelector('#d-body .rg-table'),
        title: document.getElementById('d-title').textContent, missing: want.filter(n => !names.has(n)),
        offCloud: rows.filter(x => !onCloud(x.doc, true) || !onCloud(x.src)).map(x => x.n),
        noStage: rows.filter(x => ladder.indexOf(rgStage(x.st)) < 0).map(x => x.n + ':' + x.st),
        rendered: shown.length, total: rows.length,
        linksOk: shown.every(tr => tr.querySelector('a.rg-n') && tr.querySelector('a.rg-src')),
        tally: document.getElementById('d-tagline').textContent.match(/\d+/g).map(Number).reduce((a, b) => a + b, 0),
        url: location.search };
    }, { code, docs: DOCS_OF[cloud], ladder: LADDER });
    check(cloud + ': picking a region in the menu opens its panel', r.open && r.title.indexOf('(' + code + ')') >= 0, r.title);
    check(cloud + ': the panel lists every docs feature, MCP row and Designated Service (' + r.total + ' rows)', !r.missing.length, r.missing.slice(0, 4).join(', '));
    check(cloud + ': every row links a docs page on ' + cloud + ' and cites the docs section that states it', !r.offCloud.length && r.linksOk, r.offCloud.slice(0, 4).join(', '));
    check(cloud + ': every row carries a release stage from the docs', !r.noStage.length, r.noStage.slice(0, 4).join(', '));
    check(cloud + ': every row is drawn, and the counts above the table add up to them', r.rendered === r.total && r.tally === r.total, r.rendered + '/' + r.tally + '/' + r.total);
    check(cloud + ': the address bar records the open panel', /[?&]panel=region/.test(r.url) && r.url.indexOf('region=' + code) >= 0, r.url);
    const truth = await page.evaluate(() => {
      const cr = REGIONS.clouds[curCloud()], bad = [];
      let cases = 0, marked = 0;
      for (const reg of cr.regions) {
        setRegion(reg.code);
        for (const lab of Object.keys(cr.meta)) {
          const row = regionRowsNow.find(x => x.n === rgName(lab)), on = !!cr.features[lab][reg.code];
          const m = (cr.marks[lab] || {})[reg.code] || '', cond = on && rgMarks(m).some(k => (cr.legend[cr.meta[lab].sec] || {})[k] && cr.legend[cr.meta[lab].sec][k].c);
          const want = !on ? 'no' : cond ? 'cond' : 'yes';
          cases++;
          if (!row || row.avail !== want) bad.push(reg.code + ' ' + lab + ' ' + (row && row.avail) + '!=' + want);
          if (cond) { marked++; if (!row.notes.some(t => /cross geography routing|not enabled for/.test(t))) bad.push(reg.code + ' ' + lab + ' lacks its note'); }
        }
      }
      return { cases, marked, bad };
    });
    check(cloud + ': every docs cell reads the same in the panel, and a conditional cell carries its note (' + truth.cases + ' cells, ' + truth.marked + ' conditional)',
      truth.cases > 0 && !truth.bad.length, truth.bad.slice(0, 3).join(', '));
    await page.evaluate((c) => setRegion(c), code);
    const csvFile = await Promise.all([page.waitForEvent('download'), page.click('#d-body .rg-csv')]).then(([d]) => d);
    const csvText = require('fs').readFileSync(await csvFile.path(), 'utf8');
    const csv = await page.evaluate((txt) => {
      const want = '\ufeff' + regionCsv(), lines = txt.replace(/^\ufeff/, '').trim().split('\r\n');
      return { same: txt === want, head: lines[0], lines: lines.length - 1, visible: regionVisible().length,
        firstDoc: regionVisible()[0].doc, hasDoc: lines[1].indexOf(regionVisible()[0].doc) >= 0 };
    }, csvText);
    check(cloud + ': the CSV download holds the table, one line per row, with its docs links',
      csv.same && csv.lines === csv.visible && csv.hasDoc && csvFile.suggestedFilename() === 'databricks-' + cloud + '-' + code + '-availability.csv'
      && csv.head === 'Cloud,Region,Location,Product or feature,Category,Stage,Available,Notes,Docs page,Source,On the board,Data updated',
      csvFile.suggestedFilename() + ' ' + csv.lines + '/' + csv.visible);
    const filt = await page.evaluate(() => {
      const f = document.querySelector('#d-body .rg-f'), q = document.querySelector('#d-body .rg-q');
      const opt = [...f.options].find(o => o.value && o.value !== 'yes') || [...f.options].find(o => o.value);
      f.value = opt.value; f.dispatchEvent(new Event('change'));
      const onlyOne = [...document.querySelectorAll('#d-body .rg-row')].every(tr => tr.classList.contains('rg-' + opt.value));
      f.value = ''; f.dispatchEvent(new Event('change'));
      q.value = 'serverless'; q.dispatchEvent(new Event('input'));
      const hits = [...document.querySelectorAll('#d-body .rg-row')].map(tr => tr.textContent.toLowerCase());
      q.value = ''; q.dispatchEvent(new Event('input'));
      return { onlyOne, kind: opt.value, searched: hits.length > 0 && hits.every(t => t.indexOf('serverless') >= 0) };
    });
    check(cloud + ': the filter shows only the rows it names, and search narrows to matches', filt.onlyOne && filt.searched, JSON.stringify(filt));
    await page.click('#region-btn').catch(() => {});
    const menuOpen = await page.evaluate(() => document.getElementById('region-menu').offsetParent !== null);
    if (!menuOpen) await page.click('#region-btn');
    await page.click('#region-menu button[data-region-all]');
    const closed = await page.evaluate(() => ({ open: document.body.classList.contains('detail-open'), panel: regionPanel, url: location.search }));
    check(cloud + ': All regions closes the panel and drops it from the address bar', !closed.open && !closed.panel && !/panel=region/.test(closed.url), JSON.stringify(closed));
    await ctx.close();
  }

  {
    const { ctx, page } = await open('?cloud=azure&region=qatarcentral&panel=region');
    const back = await page.evaluate(() => ({ open: regionPanel && document.body.classList.contains('detail-open'),
      title: document.getElementById('d-title').textContent, rows: regionRowsNow.length,
      serverless: (regionRowsNow.find(x => /^Serverless compute/.test(x.n)) || {}).avail,
      fm: regionRowsNow.find(x => x.n === 'Pay-per-token Foundation Model APIs') }));
    check('a copied link with panel=region reopens the region panel', back.open && back.title.indexOf('(qatarcentral)') >= 0 && back.rows > 0, back.title);
    check('azure Qatar Central: serverless compute reads No, and pay-per-token Foundation Model APIs needs cross-Geo processing in the Qatar Geo',
      back.serverless === 'no' && back.fm && back.fm.avail === 'cond' && back.fm.notes.indexOf('Geo: Qatar') >= 0
      && back.fm.notes.some(t => /cross-Geo processing/.test(t)), JSON.stringify(back.fm && back.fm.notes));
    const kept = await page.evaluate(async () => {
      const ind = INDUSTRY_CATALOG.find(r => r[0] !== 'generic')[0];
      await applyIndustry(ind, true);
      return { open: regionPanel && !!document.querySelector('#d-body .rg-table'), ind };
    });
    check('switching industry keeps the region panel open', kept.open, kept.ind);
    const boxed = await page.evaluate(() => {
      const id = Object.keys(byId).find(k => byId[k].tile && byId[k].tile.n === 'Unity Catalog');
      openDetail(id);
      return { panel: regionPanel, table: !!document.querySelector('#d-body .rg-table'), url: location.search };
    });
    check('opening a box replaces the region panel', !boxed.panel && !boxed.table && !/panel=region/.test(boxed.url), JSON.stringify(boxed));
    const swapped = await page.evaluate(() => { closeDrawer(); setRegion('qatarcentral'); openRegionPanel(); return regionPanel; });
    await page.click('#cloud-seg button:not(.on)').catch(async () => { await page.evaluate(() => { ARCH.cloud.provider = 'aws'; build(); refreshDrawer(); }); });
    const afterCloud = await page.evaluate(() => ({ panel: regionPanel, open: document.body.classList.contains('detail-open'), region: regionSel }));
    check('switching cloud closes the region panel and clears the region', swapped && !afterCloud.panel && !afterCloud.open && !afterCloud.region, JSON.stringify(afterCloud));
    await ctx.close();
  }
  {
    const { ctx, page } = await open('?cloud=gcp&lang=ar&region=asia-northeast1&panel=region');
    const ar = await page.evaluate(() => ({ dir: document.getElementById('d-body').getAttribute('dir'),
      heads: [...document.querySelectorAll('#d-body .rg-table th')].map(th => th.textContent),
      want: ['Product or feature', 'Stage', 'Available', 'Notes'].map(s => T(s)) }));
    check('the panel reads right to left in Arabic with translated column headings',
      ar.dir === 'rtl' && ar.heads.join('|') === ar.want.join('|') && ar.heads.every(h => !/^[A-Za-z ]+$/.test(h)), JSON.stringify(ar));
    await ctx.close();
  }

  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
  server.close();
  const failed = results.filter(r => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})();
