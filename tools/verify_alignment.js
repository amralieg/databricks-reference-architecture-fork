#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { serve, boardReady, withView, VIEWS } = require('./lib_serve');

const LANGS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app', 'translations', 'manifest.json'), 'utf8')).languages.map(l => l.code);
const CLOUDS = ['azure', 'aws', 'gcp'];
const LIMITS = { centre: 1.5, gap: 2, dot: 3 };

function audit(L) {
  const out = [];
  const board = document.getElementById('board');
  const k = board.getBoundingClientRect().width / board.offsetWidth;
  const px = v => v / k;
  const rtl = document.documentElement.dataset.dir === 'rtl';
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const edges = (e, withPad) => {
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e), f = p => parseFloat(cs[p]) * k;
    const b = { top: r.top + f('borderTopWidth'), bottom: r.bottom - f('borderBottomWidth'), left: r.left + f('borderLeftWidth'), right: r.right - f('borderRightWidth') };
    return withPad ? { top: b.top + f('paddingTop'), bottom: b.bottom - f('paddingBottom'), left: b.left + f('paddingLeft'), right: b.right - f('paddingRight') } : b;
  };
  const union = rs => rs.length ? { top: Math.min(...rs.map(r => r.top)), bottom: Math.max(...rs.map(r => r.bottom)), left: Math.min(...rs.map(r => r.left)), right: Math.max(...rs.map(r => r.right)) } : null;
  const ink = els => union(els.filter(vis).map(e => e.getBoundingClientRect()));
  const textInk = lbl => union([...lbl.children].filter(c => !c.classList.contains('badge-dot') && vis(c)).flatMap(c => {
    const rg = document.createRange(); rg.selectNodeContents(c);
    return [...rg.getClientRects()].filter(r => r.width > 0 && r.height > 0);
  }));
  const pen = document.createElement('canvas').getContext('2d');
  const glyphInk = lbl => {
    const out = [], walk = document.createTreeWalker(lbl, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) {
      const el = n.parentElement;
      if (!n.textContent.trim() || el.closest('.badge-dot') || !vis(el)) continue;
      const cs = getComputedStyle(el);
      pen.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const m = pen.measureText(n.textContent);
      const up = (m.fontBoundingBoxAscent - m.actualBoundingBoxAscent) * k, down = (m.fontBoundingBoxDescent - m.actualBoundingBoxDescent) * k;
      const rg = document.createRange(); rg.selectNodeContents(n);
      [...rg.getClientRects()].filter(r => r.width > 0 && r.height > 0).forEach(r => out.push({ top: r.top + up, bottom: r.bottom - down, left: r.left, right: r.right }));
    }
    return out;
  };
  const label = e => (e.dataset.en || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const zone = e => (e.className.match(/\b(b-[a-z]+|top|bot)\b/) || [, 'band'])[1];
  const title = (lbl, box) => {
    const t = textInk(lbl);
    if (!t) return;
    const c = edges(box), off = px((t.top + t.bottom) / 2 - (c.top + c.bottom) / 2);
    if (Math.abs(off) > L.centre) out.push(`${zone(box)}: title '${label(lbl)}' sits ${off.toFixed(1)}px off the middle of its box`);
    const lc = edges(lbl, true), lead = rtl ? px(lc.right - t.right) : px(t.left - lc.left);
    if (Math.abs(lead) > L.centre) out.push(`${zone(box)}: title '${label(lbl)}' starts ${lead.toFixed(1)}px in from its leading edge`);
  };
  const TILE = '.pcard, .fmt, .panel, .foot-chip, .mstage, .band-row.medallion .oi-lbl, .medal-arrow';
  document.querySelectorAll('.band').forEach(bd => {
    if (!vis(bd)) return;
    const c = edges(bd), lbl = bd.querySelector(':scope > .band-lbl:not(.band-rlbl)');
    if (!bd.closest('.arm')) {
      if (lbl) title(lbl, bd);
      const rl = bd.querySelector(':scope > .band-rlbl');
      if (rl) title(rl, bd);
      const t = ink([...bd.querySelectorAll(TILE)].filter(e => !e.parentElement.closest('.pcard, .panel, .fmt')));
      if (t) {
        const top = px(t.top - c.top), bot = px(c.bottom - t.bottom);
        if (Math.abs(top - bot) > L.gap) out.push(`${zone(bd)}: tiles sit ${top.toFixed(1)}px from the top and ${bot.toFixed(1)}px from the bottom`);
      }
      return;
    }
    const cards = [...bd.querySelectorAll('.band-row.cards > .pcard')].filter(vis).map(e => e.getBoundingClientRect());
    if (!lbl || !cards.length) return;
    const gaps = [px(cards[0].top - lbl.getBoundingClientRect().bottom)];
    for (let i = 1; i < cards.length; i++) gaps.push(px(cards[i].top - cards[i - 1].bottom));
    gaps.push(px(c.bottom - cards[cards.length - 1].bottom));
    if (Math.max(...gaps) - Math.min(...gaps) > L.gap) out.push(`${zone(bd)}: cards are spaced ${gaps.map(g => g.toFixed(1)).join(' / ')}px, not evenly`);
    const lc = edges(bd, true), t = textInk(lbl);
    if (!t) return;
    const lead = rtl ? px(lc.right - t.right) : px(t.left - lc.left);
    if (Math.abs(lead) > L.centre) out.push(`${zone(bd)}: title '${label(lbl)}' starts ${lead.toFixed(1)}px in from its leading edge`);
  });
  document.querySelectorAll('.cloud').forEach(cl => {
    const lbl = cl.querySelector(':scope > .cloud-lbl');
    if (vis(cl) && lbl && getComputedStyle(cl).flexDirection === 'row') title(lbl, cl);
  });
  document.querySelectorAll('.band, .cloud').forEach(bx => {
    if (!vis(bx)) return;
    const c = edges(bx);
    bx.querySelectorAll('.badge-dot').forEach(d => {
      if (!vis(d)) return;
      const r = d.getBoundingClientRect();
      const room = px(Math.min(r.top - c.top, c.bottom - r.bottom, r.left - c.left, c.right - r.right));
      if (room < L.dot) out.push(`${zone(bx)}: a highlight dot on '${label(d.parentElement)}' is ${room.toFixed(1)}px from the box border`);
      const lbl = d.parentElement.closest('.band-lbl, .cloud-lbl');
      if (!lbl) return;
      const marks = [...lbl.querySelectorAll('svg')].filter(vis).map(s => s.getBoundingClientRect()).concat(glyphInk(lbl));
      if (marks.some(m => Math.min(r.right, m.right) - Math.max(r.left, m.left) > 0.5 && Math.min(r.bottom, m.bottom) - Math.max(r.top, m.top) > 0.5))
        out.push(`${zone(bx)}: a highlight dot on '${label(lbl)}' covers its title or icon`);
    });
  });
  if (document.body.classList.contains('view-simple')) document.querySelectorAll('.b-apps .pcard').forEach(pc => {
    const ic = pc.querySelector('.pico'), nm = pc.querySelector('.p-name');
    if (!vis(pc) || !ic || !nm) return;
    const rg = document.createRange(); rg.selectNodeContents(nm);
    const a = ic.getBoundingClientRect(), n = rg.getBoundingClientRect(), d = px((n.left + n.right) / 2 - (a.left + a.right) / 2);
    if (Math.abs(d) > L.centre) out.push(`b-apps: '${label(nm)}' sits ${d.toFixed(1)}px off the centre of its icon`);
  });
  return out;
}

function panelAudit(L) {
  const out = [];
  const rtl = document.documentElement.dataset.dir === 'rtl';
  const arrows = [...document.querySelectorAll('.drawer .dl-go')].filter(g => g.getBoundingClientRect().width > 0);
  if (!arrows.length) return ['panel: the box panel opened with no link arrows to measure'];
  arrows.forEach(g => {
    const row = g.parentElement, r = g.getBoundingClientRect(), b = row.getBoundingClientRect(), cs = getComputedStyle(row), f = p => parseFloat(cs[p]);
    const room = rtl ? r.left - (b.left + f('borderLeftWidth') + f('paddingLeft')) : (b.right - f('borderRightWidth') - f('paddingRight')) - r.right;
    if (Math.abs(room) > L.centre) out.push(`panel: the link arrow on '${(row.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)}' sits ${room.toFixed(1)}px short of the row's end`);
  });
  return out;
}

(async () => {
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => { try { localStorage.setItem('dbx-arch-tour-v1', '1'); } catch (e) {} });
  const errs = [], fails = [];
  page.on('pageerror', e => errs.push(e.message));
  let checked = 0;
  const run = async tag => {
    await page.waitForTimeout(250);
    await page.evaluate(() => fitBoard());
    const r = await page.evaluate(audit, LIMITS);
    checked++;
    r.forEach(m => fails.push(`[${tag}] ${m}`));
  };
  for (const view of VIEWS) {
    await page.goto(withView(base, view), { waitUntil: 'networkidle' });
    await boardReady(page);
    const ids = await page.evaluate(() => ['generic'].concat(INDUSTRY_CATALOG.map(r => r[0]).filter(id => !INDUSTRY_BUILT || INDUSTRY_BUILT.has(id))));
    for (const id of ids) {
      const ok = await page.evaluate(async ({ id, view }) => {
        let ok = false;
        for (let a = 0; a < 3 && !ok; a++) { ok = await loadIndustry(id); if (!ok) await new Promise(r => setTimeout(r, 400)); }
        if (!ok) return false;
        viewMode = view;
        await applyIndustry(id, false);
        return document.body.classList.contains('view-simple') === (view === 'simple');
      }, { id, view });
      if (!ok) { fails.push(`[${view} ${id}] did not open in the ${view} view`); continue; }
      await run(`${view} ${id}`);
    }
    for (const cloud of CLOUDS) {
      await page.goto(withView(`${base}?cloud=${cloud}`, view), { waitUntil: 'networkidle' });
      await boardReady(page);
      await run(`${view} ${cloud}`);
    }
    const SHAPES = await page.evaluate(() => SHAPES.map(s => s.k));
    for (const shape of SHAPES) {
      await page.goto(withView(`${base}?shape=${shape}`, view), { waitUntil: 'networkidle' });
      await boardReady(page);
      await run(`${view} shape ${shape}`);
    }
    for (const lang of LANGS) {
      await page.goto(withView(`${base}?lang=${lang}`, view), { waitUntil: 'networkidle' });
      await boardReady(page);
      await run(`${view} ${lang}`);
      if (view !== VIEWS[0]) continue;
      await page.click('.b-gov .pcard');
      await page.waitForFunction(() => document.body.classList.contains('detail-open'), null, { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(300);
      (await page.evaluate(panelAudit, LIMITS)).forEach(m => fails.push(`[${lang}] ${m}`));
    }
  }
  await browser.close();
  server.close();
  console.log(`views: ${VIEWS.length}, boards, clouds, shapes and languages measured: ${checked}`);
  if (errs.length) fails.push(...errs.slice(0, 5).map(e => 'page error: ' + e));
  if (fails.length) { console.log(`\nFAIL (${fails.length})`); fails.forEach(f => console.log('  - ' + f)); process.exit(1); }
  console.log('PASS: in every platform box the tiles sit midway between top and bottom, titles are centred and start at the leading edge, arm cards are evenly spaced, highlight dots clear the borders and never cover a title or its icon, Simplified app names centre under their icons, and panel link arrows end their rows in every language');
})().catch(e => { console.error(e); process.exit(2); });
