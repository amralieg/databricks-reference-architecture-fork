# CLAUDE.md: Databricks Reference Architecture (repo guide)

Canonical repo: `databricks-industry-solutions/databricks-reference-architecture` (PUBLIC).
Live site: https://databricks-industry-solutions.github.io/databricks-reference-architecture/

Authoritative engineering guide for this repo. `README.md` describes the board and the repository layout.
Long policy text lives in `docs/claude-reference.md`; read the matching section when you touch that area.

## 1. What this is

- The static board is a single file: `app/index.html`.
- The AI variant is NOT a second board. `app/ai/app.py` serves the SAME `app/index.html` and injects
  `app/ai/ai.css` + `app/ai/ai.js` at request time. Edit only `app/index.html`.
- `app/version.json` (`{ "build": "<semver>" }`) moves with `const BUILD` in `app/index.html`.
- Root `index.html` is a cache-busting redirect to `app/index.html`; with `.nojekyll` it is what GitHub Pages serves.

## 2. HARD rules

1. **Databricks Serverless-safe only.** No `cache`/`persist`/`uncache`, no `SparkContext`, nothing that
   assumes a classic cluster.
2. **No code comments and no stray docs.** Do not add code comments or create `.md`/`.txt` files for
   changes unless explicitly asked.
3. **DRY.** Search before writing. Two implementations of one concept is a bug. Do not re-fork the board.
4. **Single-digit semver.** Every segment is 0-9; at 9 it rolls to 0 and carries left (v0.4.9 to v0.5.0,
   v0.9.9 to v1.0.0). `app/version.json` and `const BUILD` move together.
5. **SCHEMA bump on persisted-board content changes.** The board persists to `localStorage` keyed by
   `const SCHEMA = N;`; a returning browser ignores new baked-in content until it changes. If you change
   anything baked into a persisted board (platform bands/rails, top band, cloud band, consumers, or industry
   YAML that renders into them), bump `SCHEMA` by 1 in `app/index.html`. It is a plain counter, NOT the
   semver. CSS, render-logic and i18n-corpus changes do not need a bump.
   Verify: `grep -n "const SCHEMA" app/index.html`.
6. **Two refreshes, Platform then Content, before any change and again before any PR.** Commit what they
   change with your work.
   - Platform: `python3 tools/refresh_public_data.py` (regional availability, release stages, Lakeflow
     Connect connectors, certifications, Academy courses; §4).
   - Content: `python3 tools/refresh_content.py` (demo-center tours, official YouTube videos, every tile
     checked against them, label fit, translation coverage, highlight links; §4).

   Run Platform first: Content reads the connector catalog it refreshes. Each exits non-zero on a failed
   step or drift; fix that first. `--check` reports without writing.
7. **Write for the reader, who may be a customer.** The board, tour, exports, README and anything written
   about them speak to the reader ("you", "your team", "a meeting"), never about them as someone being
   sold to: no selling verbs, no field jargon, no meeting or design named after the customer. "Databricks
   customer stories" and an industry's own customers are fine. `linkgate` fails on `SELLER_PHRASES` in any
   tracked file.
8. **Check every translation before any PR.** After the Content refresh run `node tools/verify_ui_i18n.js`
   and fix what it reports. Every string a reader sees in a non-English language is translated with its
   board sense; product, feature and brand names, region codes, titles quoted as published, and the toolbar
   and its menus stay English. A truly identical word goes in `tools/i18n_same.json` for that language only;
   a wrong sense found once goes in the gate's sense list. Details: `docs/claude-reference.md`.

## 3. Links policy

- Every clickable surface links to Databricks only, enforced by `isDatabricksUrl()` (allowlist:
  `databricks.com` and subdomains, the Azure Databricks docs on `learn.microsoft.com`, YouTube,
  `github.com/databricks*`). `linkRow()`/`linksHref()` refuse anything else.
- Exception: a data-format tile's `spec_url` links to the standard body's own page (iso20022.org,
  fixtrading.org, finos.org, hl7.org, ...).
- Never link a competitor product page. Competitors live in `links.json` only as unlinked `.url`/`.site`
  fields; only the Databricks federation doc (`.dbx`) renders.
- Docs search fallback uses `.../search?q=` (not `search.html?q=`).

## 4. Public data: regions, stages, highlights

**Regional availability.** `app/resources/regions.json` is generated from two public Databricks doc pages per
cloud (`supported-regions` + `feature-region-support`) by `tools/scrape_regions.py` (`ALIAS` map: product name
to limited-feature column). Policy is PERMISSIVE: a product is available in ALL supported regions UNLESS the
PRODUCT ITSELF is published as region-limited. A limit on a sub-capability is relaxed (drop the alias). A
box's own capability is never a sub-capability (Serverless Compute follows the serverless compute column,
Model Serving follows CPU serving). Never show a restriction public docs do not publish. A product's own page
region list (`PRODUCT_PAGES`, today Lakebase and Genie App Builder) wins over the feature table. Every limited
column belongs to a board product (`ALIAS`/`PRODUCT_PAGES`) or says in `PART_OF` why not; `regiongate.py`
fails otherwise, and the scraper fails on a page's unmapped region requirement not recorded in `REVIEWED`.
Availability shows only when the reader picks a region; a box's detail panel shows no availability line.
Before every PR, run the Platform refresh and `regiongate.py --live` and settle any gap from the docs pages.
Region panel rows, columns, filters, flags and the scraper's failure conditions: `docs/claude-reference.md`.

**Release stages.** `app/resources/stages.json` holds each box's stage per cloud, read by
`tools/scrape_stages.py` from the notice atop the box's docs page (`links.json` `doc` path). No notice is GA;
a missing page is "Coming soon" and `docClouds` must list exactly the clouds with the page; a box with no docs
page (`undocumented`) keeps its typed stage. `stageFor` uses docs stages only for boxes with a typed
`st`/`stByCloud`; keep typed values in step. No product shows a stage label; the stage only takes effect in
the Stage menu (the region table lists stages). Prose carries no release stage (GA, Public Preview, Private
Preview, Beta, Coming soon) in descriptions, tags, notes or industry YAML; the Platform refresh fails on any.
Titles of Databricks posts and videos are quoted as published. Full detail: `docs/claude-reference.md`.

**Highlights and use cases.** Every tile shows every matching highlight (customer story, connector, tour,
demo, Academy course, certification, video, accelerator); `tools/verify_highlights.js` holds the rules.
One connector list (`app/resources/connectors.json`) drives dot and callout; tile-name aliases go in
`app/resources/aliases.json` (`linkgate` rejects self, chained, unknown or shadowing aliases); videos come
only from `OFFICIAL_YT` channels via `tools/refresh_videos.py`; `tools/build_demos.py` owns every demo list
(never add a demo to `links.json` by hand). `tools/outcome_map.json` marks outcome-map use cases: the board
never shows the mark, `linkgate` fails if one leaves its board or is renamed, and a use case may give way to
a new one only with no customer story, no accelerator and no outcome-map entry. Detail:
`docs/claude-reference.md`.

## 5. Gates: run before every PR

```bash
python3 tools/refresh_public_data.py --check  # Platform: no drift, no release stage in prose
python3 tools/refresh_content.py --check      # Content: demos, videos, highlights, labels, translations, links
python3 tools/regiongate.py --live            # region data, ownership of limited columns, docs links, Geos, flags
node   tools/verify_all_sections.js           # 70 industries + generic board, uc/genie/dash/app = 10/4/4/4, 0 page errors
node   tools/verify_i18n_coverage.js          # translation coverage over the data corpus
node   tools/verify_ui_i18n.js                # every reader-visible string translated with the right sense
node   tools/verify_highlights.js             # every tile draws the dots of its highlights
node   tools/verify_label_fit.js              # labels fit their boxes in all languages and board shapes
python3 tools/linkgate.py                     # structure, retired names, seller phrasing, outcome map, aliases (--urls live links, --scope highlights)
python3 tools/heightgate.py                   # board heights vs reference, baseline in tools/heightgate_baseline.json (--tighten after a shrink)
node   tools/perfgate.js                      # idle motion, reduced motion, parallel boot fetch, intro
node   tools/verify_exports.js                # deck, PDF, drawing-app exports, HTML export (--live opens them)
node   tools/smoke_yaml.js                    # YAML descriptor round trip
node   tools/smoke_share.js                   # share links and address bar
python3 tools/test_certifications.py          # offline
python3 tools/test_linkgate.py                # offline
python3 tools/test_content.py                 # offline
python3 tools/test_heightgate.py              # offline
python3 tools/test_regions.py                 # offline
node   tools/smoke_regions.js                 # region menu, region panel, xlsx
node   tools/smoke_ui.js                      # menus, tour (at most 10 steps), toolbar
python3 tools/test_stages.py                  # offline
node   tools/smoke_stages.js                  # Stage filter, no stage labels, connectors A to Z
```

Full description of each gate: `docs/claude-reference.md`. Every browser gate waits for the opening intro:
call `boardReady(page)` from `tools/lib_serve.js` after each board load.
Local preview: `cd app && python3 -m http.server 8777`, then open `http://localhost:8777/index.html`.

## 6. Fork + PR workflow (HARD)

- `origin`: your fork. Push all day-to-day work there.
- `upstream`: fetch from `https://github.com/databricks-industry-solutions/databricks-reference-architecture.git`;
  disable its push URL so `git push upstream` fails: `git remote set-url --push upstream DISABLED-use-a-PR`.
- The old `amralieg/interactive-databricks-enterprise-architecture` repo is ARCHIVED; do not use it.

Anything landing on the canonical repo goes through a PULL REQUEST, never a direct push:

```bash
git fetch upstream && git checkout -b <feature> upstream/main
python3 tools/refresh_public_data.py && python3 tools/refresh_content.py   # rule 6
# ...edit, bump BUILD + version.json (+ SCHEMA if persisted content changed), run §5 gates...
python3 tools/refresh_public_data.py && python3 tools/regiongate.py --live   # §4 regional availability
node tools/verify_ui_i18n.js                                                     # rule 8
git push origin <feature>
gh pr create --repo databricks-industry-solutions/databricks-reference-architecture \
  --base main --head <your-github-user>:<feature>
```

Keep the PR description short: two or three sentences on what and why, one line per change, one line on
which gates pass, only the risks a reviewer needs. Detailed notes go on the release (§7).

Keep the branch current before opening a PR:

```bash
git fetch upstream && git rebase upstream/main && git push --force-with-lease origin <feature>
```

## 7. Release process

A release is a merged PR into the canonical `main`. Both refreshes ran before the change (rule 6); run them
again right before the PR, Platform then Content, and ship any change with it. Bump `const BUILD` +
`app/version.json` to the next single-digit semver (and `SCHEMA` if persisted content changed), pass all §5
gates, open the PR, and tag `vX.Y.Z` after merge. The release notes go on that tag's GitHub release and cover
a summary, highlights, per-change detail, regressions, validation, and upgrade notes. GitHub Pages redeploys
from `main`.
