const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { serve, boardReady } = require("./lib_serve");

const LANGS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "app", "translations", "manifest.json"), "utf8")).languages.map(l => l.code);

(async () => {
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port + "/index.html";
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.addInitScript(() => { try { localStorage.setItem("dbx-arch-tour-v1", "1"); } catch (e) {} });
  const errs = [];
  page.on("pageerror", e => errs.push(e.message));
  const fails = [];
  let checked = 0;
  await page.goto(base, { waitUntil: "networkidle" });
  await boardReady(page);
  const SHAPES = await page.evaluate(() => SHAPES.map(s => s.k));
  for (const shape of SHAPES) for (const lang of LANGS) {
    await page.goto(`${base}?lang=${lang}&shape=${shape}`, { waitUntil: "networkidle" });
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
      return { n: pairs.length, out };
    });
    checked += r.n;
    r.out.forEach(m => fails.push(`[${lang} ${shape}] ${m}`));
  }
  await browser.close();
  server.close();
  console.log(`languages: ${LANGS.length}, shapes: ${SHAPES.length}, labels checked: ${checked}`);
  if (errs.length) fails.push(...errs.slice(0, 5).map(e => "page error: " + e));
  if (fails.length) { console.log(`\nFAIL (${fails.length})`); fails.forEach(f => console.log("  - " + f)); process.exit(1); }
  console.log("PASS: every panel, card, heading and band label fits its box in every language and shape");
})().catch(e => { console.error(e); process.exit(2); });
