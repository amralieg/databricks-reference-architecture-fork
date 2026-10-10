const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { serve } = require("./lib_serve");

const OUT = "/tmp/arch_exports";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// industry id, cloud
const CASES = [
  ["public_sector", "aws"],
  ["public_sector", "azure"],
  ["public_sector", "gcp"],
  ["airlines", "aws"],
  ["banking", "azure"],
  ["retail", "gcp"],
  ["generic", "aws"],
];

function u8FromB64(b64) { return Buffer.from(b64, "base64"); }

const LIVE = process.argv.includes("--live");
const DRAW_CASES = CASES.map(([ind, cloud]) => [`industry=${ind}&cloud=${cloud}`, `${ind}_${cloud}`])
  .concat(["z", "s", "t", "rt", "h90"].map(s => [`industry=banking&cloud=azure&shape=${s}`, `banking_${s}`]))
  .concat([
    ["industry=banking&cloud=azure&lang=ar", "banking_ar"],
    ["industry=banking&cloud=azure&lang=ja", "banking_ja"],
    ["cloud=aws&theme=dark", "generic_dark"],
    ["industry=airlines&cloud=aws&platform=1", "airlines_platform"],
    ["industry=banking&cloud=azure", "banking_edit", true],
  ]);
const kb = n => (n / 1024).toFixed(0) + "KB";
function shOk(cmd) { try { execSync(cmd, { stdio: "pipe" }); return true; } catch (e) { return false; } }

async function drawingProbe(edit) {
  if (edit) setEditMode(true);
  await new Promise(r => setTimeout(r, 300));
  const m = collectBoard();
  const by = {}, kinds = {};
  m.shapes.forEach(s => by[s.t] = (by[s.t] || 0) + 1);
  m.groups.forEach(g => kinds[g.kind] = (kinds[g.kind] || 0) + 1);
  const texts = m.shapes.filter(s => s.t === "text");
  const lineTexts = texts.flatMap(s => s.lines ? s.lines.map(l => l.txt) : [s.txt]);
  const links = [...new Set(m.groups.map(g => g.link).filter(Boolean))];
  const parse = (s, type) => { const x = new DOMParser().parseFromString(s, type); return x.querySelector("parsererror") ? null : x; };
  const plain = s => String(s).replace(/[\u2066-\u2069]/g, "");
  const total = m.shapes.length;
  const out = {
    by, kinds, total, groups: m.groups.length, links: links.length, badLinks: links.filter(u => !isDatabricksUrl(u)).length,
    leaves: [...document.querySelectorAll("#board .atom")].filter(el => {
      const rec = byId[el.dataset.id]; return rec && rec.arr != null && el.getClientRects().length > 0; }).length,
    addBtns: document.querySelectorAll("#board .addbtn").length,
    maxImgFrac: Math.max(0, ...m.shapes.filter(s => s.t === "img").map(s => s.box.w * s.box.h)) / (m.W * m.H),
    uniqLogos: exportLogos(m).uniq.length, f: {},
  };
  const dxText = drawioXml(m), dx = parse(dxText, "text/xml");
  if (dx) {
    const cells = [...dx.querySelectorAll("mxCell")];
    const ids = [...dx.querySelectorAll("mxCell[id], UserObject[id]")].map(e => e.getAttribute("id"));
    const idSet = new Set(ids);
    const style = c => c.getAttribute("style") || "";
    const values = cells.filter(c => /^text;/.test(style(c))).map(c => {
      const t = document.createElement("textarea"); t.innerHTML = c.getAttribute("value") || ""; return plain(t.value); });
    const dxLinks = [...dx.querySelectorAll("UserObject[link]")].map(e => e.getAttribute("link"));
    out.f.drawio = { ok: true, bytes: dxText.length, text: dxText,
      vertices: cells.filter(c => c.getAttribute("vertex") === "1" && style(c) !== "group").length,
      edges: cells.filter(c => c.getAttribute("edge") === "1").length,
      groups: dx.querySelectorAll("UserObject").length,
      svgImgs: cells.filter(c => /^shape=image;.*image=data:image\/svg\+xml,/.test(style(c))).length,
      uniqueIds: idSet.size === ids.length, parentsOk: cells.every(c => !c.getAttribute("parent") || idSet.has(c.getAttribute("parent"))),
      textOk: texts.every(s => values.includes(s.txt)), badLinks: dxLinks.filter(u => !isDatabricksUrl(u)).length };
  } else out.f.drawio = { ok: false, bytes: dxText.length, text: dxText };
  const svText = vectorSvg(m), sv = parse(svText, "image/svg+xml");
  if (sv) {
    const root = sv.documentElement, top = sel => [...sv.querySelectorAll(sel)].filter(e => e !== root && e.parentElement.closest("svg") === root);
    const svTexts = top("text").map(e => e.textContent);
    out.f.svg = { ok: true, bytes: svText.length, text: svText, rects: top("rect").length, texts: svTexts.length, logos: top("svg").length,
      heads: top("polygon").length, paths: top("path").length, foreign: sv.querySelectorAll("foreignObject").length,
      markers: sv.querySelectorAll("marker").length, tiles: sv.querySelectorAll('g[id^="tile-"]').length,
      textOk: lineTexts.every(t => svTexts.includes(t)), badLinks: [...sv.querySelectorAll("a")].filter(a => !isDatabricksUrl(a.getAttribute("href"))).length };
  } else out.f.svg = { ok: false, bytes: svText.length, text: svText };
  const exText = excalidrawJson(m);
  let ex = null; try { ex = JSON.parse(exText); } catch (e) {}
  if (ex && ex.type === "excalidraw" && Array.isArray(ex.elements)) {
    const els = ex.elements, imgs = els.filter(e => e.type === "image"), exTexts = els.filter(e => e.type === "text").map(e => plain(e.text));
    out.f.excalidraw = { ok: true, bytes: exText.length, text: exText, elements: els.length, imgs: imgs.length,
      filesOk: imgs.every(e => ex.files[e.fileId] && /^data:image\/svg\+xml;base64,/.test(ex.files[e.fileId].dataURL)),
      groups: new Set(els.flatMap(e => e.groupIds)).size,
      textOk: texts.every(s => exTexts.includes(s.lines ? s.lines.map(l => l.txt).join("\n") : s.txt)),
      badLinks: els.filter(e => e.link && !isDatabricksUrl(e.link)).length };
  } else out.f.excalidraw = { ok: false, bytes: exText.length, text: exText };
  const zipB64 = async parts => u8ToB64(new Uint8Array(await zipStore(parts).arrayBuffer()));
  const xmlBad = parts => parts.filter(p => typeof p.data === "string" && !parse(p.data, "text/xml")).map(p => p.name);
  const vp = await vsdxParts(m), page1 = parse((vp.find(p => p.name === "visio/pages/page1.xml") || {}).data || "", "text/xml");
  const vShapes = page1 ? [...page1.getElementsByTagName("Shape")] : [];
  const vLinks = page1 ? [...page1.getElementsByTagName("Cell")].filter(c => c.getAttribute("N") === "Address").map(c => c.getAttribute("V")) : [];
  out.f.vsdx = { b64: await zipB64(vp), bytes: 0, xmlBad: xmlBad(vp), names: vp.map(p => p.name), shapes: vShapes.length,
    groups: vShapes.filter(s => s.getAttribute("Type") === "Group").length, foreign: vShapes.filter(s => s.getAttribute("Type") === "Foreign").length,
    media: vp.filter(p => /^visio\/media\//.test(p.name)).length, links: vLinks.length, badLinks: vLinks.filter(u => !isDatabricksUrl(u)).length };
  out.f.vsdx.bytes = Math.round(out.f.vsdx.b64.length * 3 / 4);
  const pp = pptxParts([await pptxEditableSlide(m)], docTitle()), slides = pp.filter(p => /^ppt\/slides\/slide\d+\.xml$/.test(p.name));
  const s1 = parse((slides[0] || {}).data || "", "text/xml");
  const pn = tag => s1 ? s1.getElementsByTagNameNS(PPTX_NS.p, tag).length : 0;
  const rels = parse((pp.find(p => p.name === "ppt/slides/_rels/slide1.xml.rels") || {}).data || "", "text/xml");
  const pLinks = rels ? [...rels.getElementsByTagName("Relationship")].filter(r => /hyperlink$/.test(r.getAttribute("Type"))).map(r => r.getAttribute("Target")) : [];
  out.f.pptx = { b64: await zipB64(pp), bytes: 0, xmlBad: xmlBad(pp), slides: slides.length, grpSp: pn("grpSp"), pic: pn("pic"), sp: pn("sp"),
    svgMedia: pp.filter(p => /^ppt\/media\/.*\.svg$/.test(p.name)).length, links: pLinks.length, badLinks: pLinks.filter(u => !isDatabricksUrl(u)).length };
  out.f.pptx.bytes = Math.round(out.f.pptx.b64.length * 3 / 4);
  return out;
}

function drawingChecks(r) {
  const n = k => r.by[k] || 0, f = r.f;
  const boxes = n("rect") + n("text") + n("img"), lines = n("arrow") + n("line") + n("poly");
  const VSDX_PARTS = ["[Content_Types].xml", "_rels/.rels", "visio/document.xml", "visio/_rels/document.xml.rels",
    "visio/pages/pages.xml", "visio/pages/_rels/pages.xml.rels", "visio/pages/page1.xml", "visio/pages/_rels/page1.xml.rels"];
  return [
    ["tile groups == visible tiles", r.kinds.tile === r.leaves && r.leaves > 0],
    ["zones present", (r.kinds.zone || 0) >= (r.tag.endsWith("_platform") ? 1 : 5)],
    ["no edit buttons exported", r.tag.endsWith("_edit") ? r.addBtns > 0 : true],
    ["links all Databricks", r.badLinks === 0 && r.links > 0],
    ["no board picture (max logo < 1% of board)", r.maxImgFrac < 0.01],
    ["drawio parses", f.drawio.ok && f.drawio.xmllint],
    ["drawio vertices == boxes", f.drawio.vertices === boxes],
    ["drawio edges == arrows+lines+ring", f.drawio.edges === lines],
    ["drawio groups == model groups", f.drawio.groups === r.groups],
    ["drawio logos are SVG", f.drawio.svgImgs === n("img")],
    ["drawio ids unique, parents valid", f.drawio.uniqueIds && f.drawio.parentsOk],
    ["drawio every label present", f.drawio.textOk],
    ["drawio links Databricks", f.drawio.badLinks === 0],
    ["svg parses", f.svg.ok && f.svg.xmllint],
    ["svg rects == model rects + background", f.svg.rects === n("rect") + 1],
    ["svg logos == model logos", f.svg.logos === n("img")],
    ["svg arrowheads == arrows", f.svg.heads === n("arrow")],
    ["svg no foreignObject, no marker", f.svg.foreign === 0 && f.svg.markers === 0],
    ["svg tile groups == tiles", f.svg.tiles === r.kinds.tile],
    ["svg every label line present", f.svg.textOk],
    ["svg links Databricks", f.svg.badLinks === 0],
    ["excalidraw parses", f.excalidraw.ok],
    ["excalidraw elements == shapes", f.excalidraw.elements === r.total],
    ["excalidraw logos resolve to SVG files", f.excalidraw.imgs === n("img") && f.excalidraw.filesOk],
    ["excalidraw groups == model groups", f.excalidraw.groups === r.groups],
    ["excalidraw every label present", f.excalidraw.textOk],
    ["excalidraw links Databricks", f.excalidraw.badLinks === 0],
    ["vsdx zip + xml valid", f.vsdx.zipOk && !f.vsdx.xmlBad.length && !f.vsdx.xmllint.length],
    ["vsdx required parts", VSDX_PARTS.every(p => f.vsdx.names.includes(p))],
    ["vsdx shapes == shapes + groups + background", f.vsdx.shapes === r.total + r.groups + 1],
    ["vsdx groups == model groups", f.vsdx.groups === r.groups],
    ["vsdx foreign logos == logos, media == unique", f.vsdx.foreign === n("img") && f.vsdx.media === r.uniqLogos],
    ["vsdx hyperlinks == tile links, Databricks", f.vsdx.links >= r.links && f.vsdx.badLinks === 0],
    ["pptx zip + xml valid", f.pptx.zipOk && !f.pptx.xmlBad.length && !f.pptx.xmllint.length],
    ["pptx one slide", f.pptx.slides === 1],
    ["pptx groups == model groups", f.pptx.grpSp === r.groups],
    ["pptx pictures == logos, SVG media == unique", f.pptx.pic === n("img") && f.pptx.svgMedia === r.uniqLogos],
    ["pptx shapes == rects + texts + lines + title", f.pptx.sp === n("rect") + n("text") + lines + 1],
    ["pptx links == tile links, Databricks", f.pptx.links === r.links && f.pptx.badLinks === 0],
  ];
}

async function liveChecks(browser, stem, slides) {
  const out = [];
  const xml = fs.readFileSync(stem + ".drawio", "utf8");
  const p = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await p.setContent('<iframe id="f" src="https://embed.diagrams.net/?embed=1&proto=json&spin=0&ui=min" style="width:1590px;height:990px;border:0"></iframe>');
    const r = await p.evaluate(xml => new Promise(resolve => {
      const f = document.getElementById("f"), t = setTimeout(() => resolve({ timeout: true }), 90000);
      window.addEventListener("message", e => {
        let m; try { m = JSON.parse(e.data); } catch (x) { return; }
        if (m.event === "init") f.contentWindow.postMessage(JSON.stringify({ action: "load", xml, autosave: 0 }), "*");
        else if (m.event === "load") f.contentWindow.postMessage(JSON.stringify({ action: "export", format: "png", scale: 1 }), "*");
        else if (m.event === "export") { clearTimeout(t); resolve({ png: m.data }); }
      });
    }), xml);
    if (r.png) fs.writeFileSync(stem + ".drawio.live.png", Buffer.from(r.png.split(",")[1], "base64"));
    out.push(["draw.io loads and renders the .drawio", !!r.png, r.png ? "rendered " + stem + ".drawio.live.png" : "no render (timeout)"]);
  } catch (e) { out.push(["draw.io loads and renders the .drawio", false, String(e).slice(0, 200)]); }
  await p.close();
  const json = fs.readFileSync(stem + ".excalidraw", "utf8"), want = JSON.parse(json).elements.length;
  const q = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  try {
    await q.goto("https://excalidraw.com/", { waitUntil: "networkidle" });
    await q.waitForSelector(".excalidraw canvas", { timeout: 60000 });
    const dt = await q.evaluateHandle(json => { const d = new DataTransfer();
      d.items.add(new File([json], "board.excalidraw", { type: "application/json" })); return d; }, json);
    await q.dispatchEvent(".excalidraw canvas", "drop", { dataTransfer: dt });
    await q.waitForTimeout(6000);
    const got = await q.evaluate(() => { const s = localStorage.getItem("excalidraw"); return s ? JSON.parse(s).length : 0; });
    await q.screenshot({ path: stem + ".excalidraw.live.png" });
    out.push(["excalidraw.com loads every element", got === want, got + "/" + want + " elements"]);
  } catch (e) { out.push(["excalidraw.com loads every element", false, String(e).slice(0, 200)]); }
  await q.close();
  const soffice = ["/opt/homebrew/bin/soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice"].find(f => fs.existsSync(f));
  if (!soffice) { out.push(["LibreOffice renders .vsdx and the deck", false, "soffice not installed"]); return out; }
  const lo = `"${soffice}" -env:UserInstallation=file:///tmp/verify_exports_lo --headless`;
  const png = stem + ".png";
  fs.rmSync(png, { force: true });
  const vOk = shOk(`${lo} --convert-to png --outdir "${path.dirname(stem)}" "${stem}.vsdx"`) && fs.existsSync(png);
  out.push(["LibreOffice renders .vsdx", vOk, vOk ? png : "conversion failed"]);
  const loDir = path.join(path.dirname(stem), "lo"), pdf = path.join(loDir, path.basename(stem) + ".pdf");
  fs.rmSync(loDir, { recursive: true, force: true });
  const dOk = shOk(`${lo} --convert-to pdf --outdir "${loDir}" "${stem}.pptx"`) && fs.existsSync(pdf);
  let pages = 0;
  if (dOk) { try { pages = Number((execSync(`pdfinfo "${pdf}"`).toString().match(/Pages:\s+(\d+)/) || [])[1]); }
    catch (e) { pages = pdfPageCount(fs.readFileSync(pdf)); } }
  out.push(["LibreOffice renders every deck slide, appendix included", dOk && pages === slides, pages + "/" + slides + " pages  " + pdf]);
  return out;
}

// count "/Type /Page" (not /Pages) occurrences in a PDF buffer
function pdfPageCount(buf) {
  const s = buf.toString("latin1");
  const m = s.match(/\/Type\s*\/Page(?![s])/g);
  return m ? m.length : 0;
}

(async () => {
  // Serve over HTTP: the deep-linked industry lazy-loads from architectures/*.json
  // (and resources/*.json), which fetch() cannot read over file://. Under file://
  // every case would silently fall back to generic and the export checks would
  // pass vacuously; HTTP makes the deck reflect the real industry content.
  const server = await serve();
  const BASE = "http://127.0.0.1:" + server.address().port + "/index.html";
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  page.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });

  const results = [];
  for (const [ind, cloud] of CASES) {
    const url = `${BASE}?industry=${ind}&cloud=${cloud}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);

    const summary = await page.evaluate(() => {
      const secs = deckSections().map(s => ({ key: s.key, kind: s.kind, title: s.title, n: (s.tiles || []).length }));
      return {
        industry: (typeof ARCH !== "undefined" && ARCH.industry) || null,
        cloud: (typeof ARCH !== "undefined" && ARCH.cloud && ARCH.cloud.provider) || null,
        label: (typeof deckIndustry === "function") ? deckIndustry() : null,
        secs,
        uc: (typeof useCaseTiles === "function") ? useCaseTiles().length : -1,
        genie: (typeof genieTiles === "function") ? genieTiles().length : -1,
        dash: (typeof dashboardTiles === "function") ? dashboardTiles().length : -1,
        apps: (typeof appTiles === "function") ? appTiles().length : -1,
      };
    });

    const pptxB64 = await page.evaluate(async () => {
      const blob = await exportPptx();
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return btoa(bin);
    });
    const board = await page.evaluate(() => {
      const m = collectBoard();
      return { groups: m.groups.length, imgs: m.shapes.filter(s => s.t === "img").length,
        texts: [String(T("APPENDIX")).toUpperCase(), T("Editable Architecture"), dt("editBlurb")] };
    });
    const pdfB64 = await page.evaluate(async () => {
      const blob = await boardPdfBlob();
      if (!blob) return null;
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      return btoa(bin);
    });

    const tag = `${ind}_${cloud}`;
    const pptxPath = path.join(OUT, tag + ".pptx");
    const pdfPath = path.join(OUT, tag + ".pdf");
    fs.writeFileSync(pptxPath, u8FromB64(pptxB64));
    if (pdfB64) fs.writeFileSync(pdfPath, u8FromB64(pdfB64));

    // PPTX slide count + content grep (zipStore is stored, so text is greppable in unzip -p)
    const slideList = execSync(`unzip -l "${pptxPath}" | grep -c 'ppt/slides/slide'`).toString().trim();
    const slideXml = execSync(`unzip -p "${pptxPath}" "ppt/slides/slide*.xml" 2>/dev/null || true`).toString();
    const hasGenie = /Genie/i.test(slideXml);
    const hasDash = /Dashboard/i.test(slideXml);
    const hasApp = /\bApp/i.test(slideXml);
    // pull the first use case tile name to confirm it lands in the deck
    const firstUc = await page.evaluate(() => { const t = useCaseTiles()[0]; return t ? t.n : null; });
    const ucInDeck = firstUc ? slideXml.includes(firstUc.replace(/&/g, "&amp;").slice(0, 12)) : false;

    const pdfPages = pdfB64 ? pdfPageCount(u8FromB64(pdfB64)) : 0;

    const n = Number(slideList), slideOf = i => `ppt/slides/slide${i}.xml`;
    const unz = name => execSync(`unzip -p "${pptxPath}" "${name}"`).toString();
    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const lastXml = unz(slideOf(n)), breakXml = unz(slideOf(n - 1));
    const appendix = { ...board,
      breakOk: board.texts.every(s => breakXml.includes(esc(s))),
      grpSp: (lastXml.match(/<p:grpSp>/g) || []).length, pics: (lastXml.match(/<p:pic>/g) || []).length,
      svgType: /Extension="svg"/.test(unz("[[]Content_Types].xml")),
      wellFormed: [slideOf(n - 1), slideOf(n), `ppt/slides/_rels/slide${n - 1}.xml.rels`, `ppt/slides/_rels/slide${n}.xml.rels`]
        .every(f => shOk(`unzip -p "${pptxPath}" "${f}" | xmllint --noout -`)),
      zipOk: shOk(`unzip -tq "${pptxPath}"`) };

    results.push({ tag, ...summary, slides: n, appendix, pptxHasGenie: hasGenie, pptxHasDash: hasDash, pptxHasApp: hasApp, firstUc, ucInDeck, pdfPages, pptxBytes: u8FromB64(pptxB64).length, pdfBytes: pdfB64 ? u8FromB64(pdfB64).length : 0 });
  }

  const drawing = [];
  for (const [q, tag, edit] of DRAW_CASES) {
    await page.goto(`${BASE}?${q}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const d = await page.evaluate(drawingProbe, !!edit);
    for (const kind of ["vsdx", "pptx"]) {
      const file = path.join(OUT, `${tag}.${kind === "pptx" ? "appendix.pptx" : kind}`);
      fs.writeFileSync(file, u8FromB64(d.f[kind].b64));
      delete d.f[kind].b64;
      d.f[kind].zipOk = shOk(`unzip -tq "${file}"`);
      const dir = file + ".x";
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir);
      execSync(`cd "${dir}" && unzip -q "${file}"`);
      const xml = execSync(`cd "${dir}" && find . -name "*.xml" -o -name "*.rels"`).toString().trim().split("\n");
      d.f[kind].xmllint = xml.filter(x => !shOk(`xmllint --noout "${dir}/${x}"`));
    }
    for (const [kind, ext] of [["drawio", "drawio"], ["svg", "svg"], ["excalidraw", "excalidraw"]]) {
      fs.writeFileSync(path.join(OUT, `${tag}.${ext}`), d.f[kind].text);
      delete d.f[kind].text;
    }
    d.f.drawio.xmllint = shOk(`xmllint --noout "${path.join(OUT, tag + ".drawio")}"`);
    d.f.svg.xmllint = shOk(`xmllint --noout "${path.join(OUT, tag + ".svg")}"`);
    drawing.push({ tag, ...d });
  }

  const live = LIVE ? await liveChecks(browser, path.join(OUT, "banking_azure"), (results.find(r => r.tag === "banking_azure") || {}).slides) : null;

  await browser.close();
  server.close();

  console.log("\n================ EXPORT VERIFICATION ================\n");
  let fail = 0;
  for (const r of results) {
    const secLine = r.secs.map(s => `${s.key}:${s.n}`).join("  ");
    // expected content-page count in deck: uc tiles + genie tiles + 1(dash grid if dash) + 1(app grid if app) + breaks + cover + index + board
    const hasUc = r.uc > 0, hasGenieS = r.genie > 0, hasDashS = r.dash > 0, hasAppS = r.apps > 0;
    // narrative slides = per-section break(1) + pages; board is its own; cover+index
    let narr = 0, breaks = 0;
    r.secs.forEach(s => {
      if (s.kind === "board") return;
      breaks += 1;
      if (s.kind === "uc" || s.kind === "genie" || s.kind === "dash") narr += s.n; else narr += 1; // apps grid = 1
    });
    const expSlides = 1 /*cover*/ + 1 /*index*/ + 1 /*board*/ + breaks + narr + 1 /*closing*/;

    const checks = [];
    // Guard against a silent fall-back to generic: the loaded industry must be
    // the one requested (proves the lazy per-industry fetch actually resolved).
    checks.push(["industry==" + r.tag.split("_")[0], r.industry === r.tag.slice(0, r.tag.lastIndexOf("_"))]);
    checks.push(["uc>0", hasUc]);
    checks.push(["ucInDeck", r.ucInDeck]);
    checks.push(["genie>0", hasGenieS]);
    checks.push(["dash>0", hasDashS]);
    checks.push(["apps>0", hasAppS]);
    checks.push(["pptx has Genie", r.pptxHasGenie]);
    checks.push(["pptx has Dashboard", r.pptxHasDash]);
    checks.push(["slides==exp+appendix(" + (expSlides + 2) + ")", r.slides === expSlides + 2]);
    checks.push(["pdf pages==exp(" + expSlides + ")", r.pdfPages === expSlides]);
    const a = r.appendix;
    checks.push(["appendix break has tab, title, subtitle", a.breakOk]);
    checks.push(["appendix groups == board groups", a.grpSp > 0 && a.grpSp === a.groups]);
    checks.push(["appendix pictures == board logos", a.pics === a.imgs]);
    checks.push(["appendix svg content type", a.svgType]);
    checks.push(["deck zip + appendix xml valid", a.zipOk && a.wellFormed]);

    const bad = checks.filter(c => !c[1]);
    if (bad.length) fail++;
    console.log(`● ${r.tag}  [${r.label}]  ${bad.length ? "❌" : "✅"}`);
    console.log(`   secs: ${secLine}`);
    console.log(`   uc=${r.uc} genie=${r.genie} dash=${r.dash} apps=${r.apps}  slides=${r.slides}(exp ${expSlides + 2})  pdfPages=${r.pdfPages}  pptx=${(r.pptxBytes/1024).toFixed(0)}KB pdf=${(r.pdfBytes/1024).toFixed(0)}KB  appendix groups=${a.grpSp}/${a.groups} pics=${a.pics}/${a.imgs}`);
    console.log(`   firstUc=${JSON.stringify(r.firstUc)} inDeck=${r.ucInDeck}`);
    if (bad.length) console.log("   FAILS: " + bad.map(b => b[0]).join(", "));
  }
  console.log("\n================ DRAWING-APP EXPORTS ================\n");
  let drawFail = 0;
  for (const r of drawing) {
    const bad = drawingChecks(r).filter(c => !c[1]);
    if (bad.length) drawFail++;
    const sh = r.by;
    console.log(`● ${r.tag}  ${bad.length ? "❌" : "✅"}  shapes rect=${sh.rect || 0} text=${sh.text || 0} img=${sh.img || 0} arrow=${sh.arrow || 0} line=${sh.line || 0} ring=${sh.poly || 0}  groups zone=${r.kinds.zone || 0} box=${r.kinds.box || 0} tile=${r.kinds.tile || 0}  links=${r.links}`);
    console.log(`   sizes drawio=${kb(r.f.drawio.bytes)} svg=${kb(r.f.svg.bytes)} excalidraw=${kb(r.f.excalidraw.bytes)} vsdx=${kb(r.f.vsdx.bytes)} pptx=${kb(r.f.pptx.bytes)}`);
    if (bad.length) console.log("   FAILS: " + bad.map(b => b[0]).join(", "));
  }
  let liveFail = 0;
  if (live) {
    console.log("\n================ LIVE (--live) ================\n");
    for (const [name, ok, detail] of live) { if (!ok) liveFail++; console.log(`${ok ? "✅" : "❌"} ${name}  ${detail}`); }
  }
  console.log("\nPage errors captured: " + errors.length);
  errors.slice(0, 10).forEach(e => console.log("   ! " + e));
  console.log(`\nRESULT: ${results.length - fail}/${results.length} deck cases passed, ${drawing.length - drawFail}/${drawing.length} drawing cases passed` +
    (live ? `, ${live.length - liveFail}/${live.length} live checks passed` : ""));
  console.log("Artifacts in " + OUT);
  process.exit(fail || drawFail || liveFail || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
