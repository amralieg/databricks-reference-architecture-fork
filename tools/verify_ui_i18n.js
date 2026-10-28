#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { serve, boardReady, withView } = require('./lib_serve');

const ROOT = path.join(__dirname, '..');
const TR = path.join(ROOT, 'app', 'translations');
const LANGS = JSON.parse(fs.readFileSync(path.join(TR, 'manifest.json'), 'utf8')).languages.map(l => l.code).filter(c => c !== 'en');
const SAME = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n_same.json'), 'utf8'));
const html = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
const TOUR = [...((html.match(/const STEPS = \[([\s\S]*?)\n  \];/) || [])[1] || '').matchAll(/\b(?:title|body):"((?:[^"\\]|\\.)*)"/g)].map(m => JSON.parse('"' + m[1] + '"'));

const SENSE = [
  { what: 'ingestion read as eating or swallowing', src: /\bingest/i,
    bad: { de: /einnahme/i, nl: /\binname|innemen|inslik/i, ja: /摂取/, ko: /섭취/, sv: /förtär/i, fi: /niel/i, he: /בליע|נבלע|להיבלע|הכנסת מזון/, ar: /ابتلاع/, zh: /摄入|吞/, hi: /निगल/ } },
  { what: 'work teams read as sports teams', src: /\bteams?\b/i, except: /Microsoft Teams|Teams & M365|in Teams\b|League|venues|fan engagement|Team President/i,
    bad: { de: /mannschaft/i, fi: /joukkue/i, sv: /\blag (om|för)\b|^lag$/i } },
  { what: 'cloud read as weather', src: /^cloud$/i,
    bad: { de: /^wolke$/i, nl: /^wolk$/i, ja: /^雲$/, ko: /^구름$/, ar: /^سحاب$/, hi: /^बादल$/, it: /^nuvola$/i, fr: /^nuage$/i, da: /^sky$/i } },
  { what: 'a board box read as a physical container', src: /\bbox(es)?\b/i, only: TOUR,
    bad: { nl: /\bdoos/i, sv: /låda/i, it: /scatol/i, zh: /盒子/, he: /קופס/, ko: /상자/, es: /\bcaja/i } },
  { what: 'the guided tour read as a concert tour or a stroll', src: /\btour\b/i, only: TOUR,
    bad: { fr: /tournée/i, sv: /turné/i, fi: /kiertue/i, pt: /passeio/i } },
  { what: 'a release stage read as a theatre stage', src: /\bstage\b/i, only: TOUR.concat(['Stage']),
    bad: { de: /bühne/i, fr: /\bscène/i, pt: /palco/i, nl: /podium/i, it: /palcoscenico/i, sv: /\bscen\b/i, ko: /무대/, fi: /näyttämö/i, he: /במה/, hi: /मंच/, da: /\bscene\b/i } },
  { what: 'the light or dark theme read as light and darkness', src: /\blight or dark\b/i,
    bad: { zh: /光明|黑暗/, ko: /빛 또는 어둠/, hi: /अंधकार/ } },
  { what: 'highlights read as reflections or stripes', src: /^highlights$/i, bad: { es: /reflejo/i, he: /פסים/ } },
  { what: 'agent memory read as computer RAM', src: /\bmemor(y|ies)\b/i, except: /\b\d+\s*(GB|GiB|TB)\b|in-memory|\bRAM\b/i,
    bad: { zh: /内存/ } },
  { what: 'compute instances read as examples or cases', src: /\binstances?\b/i,
    bad: { hi: /उदाहरण/, he: /מקרים/, ar: /حالات/ } },
  { what: 'a GovCloud region read as a governor or a government', src: /^US Gov\b/,
    bad: { de: /gouverneur|regierung/i, es: /gobern/i, pt: /governa|governo/i, it: /governat|governo/i, fr: /gouvern/i, nl: /regering/i,
           sv: /regering/i, fi: /hallitus/i, da: /regering|guvern/i, ja: /知事|政府/, ko: /주지사|정부/, zh: /政府/, ar: /حكوم|حاكم/, he: /ממשל|מושל/ } },
  { what: 'model serving read as a tennis serve, a cash withdrawal or serving food', src: /\bserv(ing|ed)\b/i,
    bad: { de: /aufschlag/i, pt: /\bsaques?\b/i, fi: /tarjoil/i } },
  { what: 'model training read as sports practice or an internship', src: /\btraining\b/i, except: /athlete|training load/i,
    bad: { it: /allenament/i, fi: /harjoittel/i } },
  { what: 'a job run read as a race', src: /\bruns?\b/i, except: /home run|\brace\b/i,
    bad: { pt: /\bcorridas?\b/i, it: /\bcors[ae]\b/i, es: /\bcarreras?\b/i } },
  { what: 'an endpoint read as a full stop or a final point', src: /\bendpoints?\b/i,
    bad: { es: /puntos? finales?/i, fr: /points? fina(l|ux)\b/i, hi: /समापन बिंदु/ } },
  { what: 'a compute plane read as an aircraft or as an order to calculate', src: /\bcompute plane\b/i,
    bad: { ar: /طائر/, he: /מטוס/, hi: /विमान/, it: /aereo/i, pt: /avião/i, es: /avión/i, de: /flugzeug/i, ja: /飛行機/, ko: /비행기|평면/, zh: /飞机/,
           da: /\bfly\b|^beregn\b/i, fi: /^laske\b/i, fr: /^calculer\b/i, sv: /^beräkna\b/i, nl: /^bereken\b|\bplane\b/i } },
  { what: 'compute read as an account or a sum', src: /\bcompute\b/i, except: /\baccount\b/i,
    bad: { ar: /(^|[\s،])(ال)?حساب($|[\s،.])/ } },
  { what: 'a lakehouse read as a house by a lake', src: /\blakehouses?\b/i,
    bad: { it: /casa sul lago|casa del lago/i, fi: /järvitalo/i, he: /בית האגם/, ja: /湖畔|湖の家/, es: /casa (del|junto al) lago/i, pt: /casa (do|no) lago|casa à beira/i,
           fr: /maison (du|au bord du|sur le) lac/i, de: /seehaus/i, nl: /meerhuis|huis aan het meer/i, sv: /sjöhus|sjöstuga/i, da: /søhus/i, ko: /호숫가|호수 집|호수의 집/,
           zh: /湖边|湖畔|湖屋/, ar: /(بيت|منزل|كوخ) البحيرة|(من|في|إلى|على) البحيرة/ } },
  { what: 'rail linear assets read as wealth or the maglev line', src: /\blinear (and infrastructure )?assets?\b|\bLinear Asset\b/i,
    bad: { nl: /vermogen/i, it: /patrimon/i, de: /vermögen/i, ja: /リニア/, fi: /varallisuu|sijoitus/i, sv: /förmögenhet/i, da: /formue/i, hi: /संपत्ति/, fr: /patrimoin/i, es: /patrimonio/i, pt: /patrimônio|patrimonio/i } },
  { what: 'an AI copilot read as an aircraft co-pilot', src: /\bcopilots?\b/i,
    bad: { ja: /副操縦/, ko: /부조종사/, he: /טייס/, ar: /طيّ?ار/, fi: /perämie/i, hi: /सह-?पायलट/ } },
  ...['Databricks Vector Search', 'Anthropic', 'OpenAI', 'Amazon Bedrock', 'AWS Glue', 'Oracle', 'Sparkplug', 'Power BI', 'Pub/Sub', 'Event Hubs', 'Kinesis']
    .map(name => ({ what: `the name ${name} translated`, src: new RegExp(name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')),
      bad: Object.fromEntries(LANGS.map(l => [l, { test: t => !t.includes(name) }])) })),
];
const prose = s => { const w = s.trim().split(/\s+/); return w.length >= 3 && w.some(x => /^[a-z]{2,}/.test(x)); };

function offline(){
  const fails = [];
  let n = 0;
  for(const l of LANGS){
    const d = {};
    for(const f of fs.readdirSync(path.join(TR, l))) if(f.endsWith('.json')) Object.assign(d, JSON.parse(fs.readFileSync(path.join(TR, l, f), 'utf8')));
    for(const [s, t] of Object.entries(d)){
      n++;
      if(/Zq\s*\d|\d\s*qZ/.test(t)) fails.push(`[${l}] a masking token is left in '${s.slice(0, 60)}'`);
      if(/[\u200B\uFEFF]/.test(t)) fails.push(`[${l}] a zero-width space hides in '${s.slice(0, 60)}'`);
      if(l === 'he' && /[\u0591-\u05C7]/.test(t)) fails.push(`[he] vowel points in '${s.slice(0, 60)}'`);
      for(const r of SENSE){
        if(!r.bad[l] || !r.src.test(s) || (r.except && r.except.test(s)) || (r.only && r.only.indexOf(s) < 0)) continue;
        if(r.bad[l].test(t)) fails.push(`[${l}] ${r.what}: '${s.slice(0, 60)}' => '${t.slice(0, 60)}'`);
      }
    }
    for(const s of TOUR){
      if(prose(s) && !d[s]) fails.push(`[${l}] the tour text '${s.slice(0, 60)}' has no translation`);
      if(d[s] && /\{k[12]\}/.test(s) && !(d[s].includes('{k1}') && d[s].includes('{k2}'))) fails.push(`[${l}] the tour lost its key placeholders`);
    }
  }
  return { n, fails };
}

async function rendered(){
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch();
  const errors = [];
  const grab = async (q, view) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addInitScript(() => { try { localStorage.setItem('dbx-arch-tour-v1', '1'); } catch (e) {} });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(withView(base + q, 'detailed'), { waitUntil: 'networkidle' });
    await boardReady(page);
    await page.waitForTimeout(300);
    const r = await page.evaluate(async (view) => {
      const out = new Set();
      const take = (root, skipLinks) => {
        if(!root) return;
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while((n = w.nextNode())){
          const p = n.parentElement;
          if(!p || p.closest('header.top, svg, style, script, .tagpill') || (skipLinks && p.closest('a'))) continue;
          const t = (p.querySelector(':scope > wbr') ? p.textContent : n.textContent).replace(/\s+/g, ' ').trim();
          if(/[A-Za-z]{3}/.test(t)) out.add(t);
        }
        root.querySelectorAll('[title], [aria-label], [placeholder]').forEach(e => {
          if(e.closest('header.top, svg')) return;
          ['title', 'aria-label', 'placeholder'].forEach(a => { const v = (e.getAttribute(a) || '').trim(); if(/[A-Za-z]{3}/.test(v)) out.add(v); });
        });
      };
      const names = new Set(Object.keys(LINKS || {}));
      Object.values(byId).forEach(r => { if(r && r.tile){ names.add(r.tile.n); if(r.tile.tag) names.add(r.tile.tag); } });
      const cr = REGIONS.clouds[curCloud()];
      Object.values(REGIONS.clouds).forEach(c => {
        Object.keys(c.meta).forEach(k => names.add(rgName(k)));
        Object.keys(c.derived).forEach(k => names.add(k));
        c.designated.rows.forEach(d => names.add(d.n));
        c.partner.rows.forEach(d => names.add(d.n));
        c.elsewhere.forEach(e => names.add(rgName(e.n)));
        c.regions.forEach(r => names.add(r.code));
      });
      names.add(creditText());
      Object.values((ARCH.cloud && ARCH.cloud.providers) || {}).forEach(p => p && p.label && names.add(p.label));
      if(view === 'panel') take(document.getElementById('drawer'), true);
      if(view === 'board'){ take(document.getElementById('board'), false); take(document.getElementById('drawer'), true); }
      if(view === 'detail'){
        const id = Object.keys(byId).find(k => byId[k].tile && byId[k].tile.n === 'SQL Warehouses' && byId[k].el && byId[k].el.closest('#platform'));
        openDetail(id); await new Promise(r => setTimeout(r, 300));
        take(document.getElementById('drawer'), true);
      }
      if(view === 'tour'){
        window.__startArchTour();
        for(let i = 0; i < 12; i++){
          await new Promise(r => setTimeout(r, 250));
          const pop = document.querySelector('.tour-pop');
          if(!pop) break;
          pop.querySelectorAll('h4, p, button').forEach(e => { const t = e.textContent.replace(/\s+/g, ' ').trim(); if(/[A-Za-z]{3}/.test(t)) out.add(t); });
          const [cur, tot] = document.querySelector('.tour-step').textContent.split('/').map(x => parseInt(x, 10));
          if(cur >= tot) break;
          pop.querySelector('.tour-btn.accent').click();
        }
      }
      if(view === 'excel') regionSheet().slice(0, 1)[0].forEach(h => out.add(h));
      return { texts: [...out], names: [...names] };
    }, view);
    await ctx.close();
    return r;
  };
  const views = [
    ['board', '?industry=banking'], ['tour', '?industry=banking'], ['detail', '?cloud=azure'],
    ['panel', '?cloud=azure&region=qatarcentral&panel=region'], ['panel', '?cloud=aws&region=us-east-1&panel=region'],
    ['panel', '?cloud=gcp&region=us-central1&panel=region'], ['excel', '?cloud=azure&region=qatarcentral&panel=region'],
  ];
  const fails = [];
  let checked = 0;
  for(const [view, q] of views){
    const en = await grab(q, view);
    const enSet = new Set(en.texts);
    for(const l of LANGS){
      const tr = await grab(q + '&lang=' + l, view);
      const names = new Set(tr.names), same = new Set((SAME._all || []).concat(SAME[l] || []));
      for(const t of tr.texts){
        checked++;
        if(!enSet.has(t) || names.has(t) || same.has(t)) continue;
        if(!/[a-z]{3}/.test(t)) continue;
        fails.push(`[${l}] ${view} ${q}: '${t.slice(0, 90)}' is still English`);
      }
    }
  }
  await browser.close();
  server.close();
  return { checked, fails, errors };
}

(async () => {
  const a = offline();
  console.log(`offline: ${LANGS.length} languages, ${a.n} translations, ${TOUR.length} tour strings, ${a.fails.length} problems`);
  const b = await rendered();
  console.log(`rendered: ${b.checked} strings on screen in ${LANGS.length} languages, ${b.fails.length} still English`);
  const fails = a.fails.concat(b.fails, b.errors.slice(0, 5).map(e => 'page error: ' + e));
  if(fails.length){
    console.log(`\nFAIL (${fails.length})`);
    fails.slice(0, 200).forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
  console.log('PASS: every string a reader sees is translated with the right sense, in every language');
})().catch(e => { console.error(e); process.exit(2); });
