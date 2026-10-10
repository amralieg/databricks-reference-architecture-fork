const { chromium } = require("playwright");
const { serve } = require("./lib_serve");
(async () => {
  // Serve over HTTP so industries can lazy-load from architectures/*.json
  // (fetch() cannot read them over file://).
  const server = await serve();
  const base = "http://127.0.0.1:" + server.address().port + "/index.html";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e)));
  await page.goto(base, { waitUntil: "networkidle" });
  const ids = await page.evaluate(() => ["generic"].concat(INDUSTRY_CATALOG.map(x => x[0])));
  const rows = [];
  for (const id of ids) {
    await page.evaluate(async (i) => { i === "generic" ? build() : await applyIndustry(i, false); }, id);
    const r = await page.evaluate(async () => {
      const s = deckSections();
      const by = k => { const x = s.find(z => z.kind === k); return x ? x.tiles.length : 0; };
      let appendix = "";
      try {
        const m = collectBoard(), sl = await pptxEditableSlide(m), grp = (sl.body.match(/<p:grpSp>/g) || []).length;
        const want = 2 * exportLogos(m).uniq.length, empty = sl.media.filter(x => !(x.u8 || x).length).length;
        if (!grp || grp !== m.groups.length || sl.media.length !== want || empty)
          appendix = `groups ${grp}/${m.groups.length} media ${sl.media.length}/${want} empty ${empty}`;
      } catch (e) { appendix = "throws: " + (e && e.message || e); }
      return { ind: ARCH.industry, sec: s.map(z => z.kind).join(","), uc: by("uc"), genie: by("genie"), dash: by("dash"), app: by("app"), appendix };
    });
    rows.push({ id, ...r });
  }
  await browser.close();
  server.close();
  let bad = 0;
  const short = rows.filter(r => !(r.uc >= 1 && r.genie >= 1 && r.dash >= 1 && r.app >= 1));
  // S1: assert the exact ten/four contract (not merely non-empty). dash/app keep
  // their non-empty contract because the reviewed spec fixes only uc=10, genie=4.
  const wrong = rows.filter(r => r.uc !== 10 || r.genie !== 4);
  rows.forEach(r => { if (!(r.uc && r.genie && r.dash && r.app)) bad++; });
  console.log(`industries scanned: ${rows.length}`);
  console.log(`missing a section (uc/genie/dash/app==0): ${short.length}`);
  short.slice(0, 30).forEach(r => console.log(`  ❌ ${r.id}  uc=${r.uc} genie=${r.genie} dash=${r.dash} app=${r.app}  [${r.sec}]`));
  console.log(`wrong count (uc!=10 or genie!=4): ${wrong.length}`);
  wrong.slice(0, 30).forEach(r => console.log(`  ❌ ${r.id}  uc=${r.uc} genie=${r.genie}  [${r.sec}]`));
  // distribution of counts
  const dist = {};
  rows.forEach(r => { const k = `${r.uc}/${r.genie}/${r.dash}/${r.app}`; dist[k] = (dist[k] || 0) + 1; });
  console.log("count distribution uc/genie/dash/app -> #industries:");
  Object.entries(dist).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  const appx = rows.filter(r => r.appendix);
  console.log(`editable deck appendix fails to build: ${appx.length}`);
  appx.slice(0, 30).forEach(r => console.log(`  ❌ ${r.id}  ${r.appendix}`));
  console.log("page errors:", errs.length);
  errs.slice(0, 5).forEach(e => console.log("  ! " + e));
  process.exit(short.length || wrong.length || appx.length || errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
