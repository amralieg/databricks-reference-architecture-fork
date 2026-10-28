const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { serve, boardReady, withView, VIEWS } = require("./lib_serve");

const LANGS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app", "translations", "manifest.json"), "utf8")).languages.map(l => l.code);

function splitAudit(){
  const out = [];
  document.querySelectorAll(".rtile .t-name, .ctile .ct-name").forEach(el => {
    if (!el.getClientRects().length) return;
    const chars = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n; (n = walk.nextNode());) for (let i = 0; i < n.textContent.length; i++) {
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1);
      const rs = [...r.getClientRects()], b = rs[rs.length - 1];
      chars.push({ c: n.textContent[i], top: b ? b.top : null, h: b ? b.height : 0, rs });
    }
    for (let i = 1; i < chars.length; i++) {
      const a = chars[i - 1], b = chars[i];
      if (a.top == null || b.top == null || b.top - a.top < a.h / 2) continue;
      if (!/[\p{L}\p{N}]/u.test(a.c) || !/[\p{L}\p{N}]/u.test(b.c) || /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u.test(a.c + b.c)) continue;
      if (b.rs.some(r => Math.abs(r.top - a.top) < a.h / 2 && r.width > 1)) continue;
      out.push(`'${el.textContent.trim().slice(0, 48)}' splits a word with no hyphen at '${chars.slice(0, i).map(x => x.c).join("").split(/\s/).pop()}|'`);
      break;
    }
  });
  return out;
}

(async () => {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port + "/index.html";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => { try { localStorage.setItem("dbx-arch-tour-v1", "1"); } catch (e) {} });
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  const fails = [];
  let checked = 0, boards = 0;
  await page.goto(base, { waitUntil: "networkidle" });
  await boardReady(page);
  const SHAPES = await page.evaluate(() => SHAPES.map(s => s.k));
  const BOARDS = await page.evaluate(() => INDUSTRY_CATALOG.map(r => r[0]).filter(id => !INDUSTRY_BUILT || INDUSTRY_BUILT.has(id)));
  if (BOARDS.length < 70) fails.push(`only ${BOARDS.length} industry boards found to check for split words`);
  for (const view of VIEWS) for (const shape of SHAPES) for (const lang of LANGS) {
    await page.goto(withView(`${base}?lang=${lang}&shape=${shape}`, view), { waitUntil: "networkidle" });
    await boardReady(page);
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const out = [], pairs = [];
      document.querySelectorAll(".panel").forEach(pn => pn.querySelectorAll(".panel-head, .ph-name, .ph-sub, .tagpill, .pc-desc").forEach(el => {
        const card = el.closest(".pcol");
        pairs.push([el, card || pn, card ? "card" : "panel"]);
      }));
      document.querySelectorAll(".band").forEach(bd => bd.querySelectorAll(":scope > .band-lbl, :scope > .band-rlbl").forEach(el => pairs.push([el, bd, "band"])));
      document.querySelectorAll(".colhead, .pockhead").forEach(h => {
        const node = [...h.childNodes].find(n => n.nodeType === 3 && n.textContent.trim());
        if (!node) return;
        const r = document.createRange(); r.selectNodeContents(node);
        const t = r.getBoundingClientRect(), b = h.getBoundingClientRect(), zx = h.querySelector(".zx");
        pairs.push([node, h, "heading"]);
        if (Math.max(b.left - t.left, t.right - b.right) > 0.5) out.push(`'${node.textContent.trim().slice(0, 48)}' runs outside its heading`);
        if (zx) { const z = zx.getBoundingClientRect(); if (t.right > z.left + 0.5 && t.left < z.right - 0.5) out.push(`'${node.textContent.trim().slice(0, 48)}' runs under its zoom button`); }
      });
      for (const [el, box, kind] of pairs) {
        if (kind === "heading") continue;
        const e = el.getBoundingClientRect(), b = box.getBoundingClientRect();
        if (!e.width || !b.width) continue;
        const over = Math.max(b.left - e.left, e.right - b.right);
        if (over > 0.5) out.push(`'${(el.textContent || "").trim().slice(0, 48)}' runs ${over.toFixed(1)}px outside its ${kind}`);
      }
      return { n: pairs.length, out, view: viewMode };
    });
    checked += r.n;
    if (r.view !== view) fails.push(`[${lang} ${shape}] opened in ${r.view}, not ${view}`);
    r.out.forEach(m => fails.push(`[${view} ${lang} ${shape}] ${m}`));
    (await page.evaluate(splitAudit)).forEach(m => fails.push(`[${view} ${lang} ${shape}] ${m}`));
  }
  for (const view of VIEWS) for (const ind of BOARDS) for (const cloud of ["azure", "aws", "gcp"]) {
    await page.goto(withView(`${base}?industry=${ind}&cloud=${cloud}`, view), { waitUntil: "networkidle" });
    await boardReady(page);
    boards++;
    (await page.evaluate(splitAudit)).forEach(m => fails.push(`[${view} ${ind} ${cloud}] ${m}`));
  }
  await browser.close();
  server.close();
  console.log(`views: ${VIEWS.length}, languages: ${LANGS.length}, shapes: ${SHAPES.length}, labels checked: ${checked}, boards checked for split words: ${boards}`);
  if (errs.length) fails.push(...errs.slice(0, 5).map(e => "page error: " + e));
  if (fails.length) { console.log(`\nFAIL (${fails.length})`); fails.slice(0, 120).forEach(f => console.log("  - " + f)); process.exit(1); }
  console.log("PASS: every panel, card, heading and band label fits its box, and no tile name breaks a word without a hyphen, in both views, every language, shape, board and cloud");
})().catch(e => { console.error(e); process.exit(2); });
