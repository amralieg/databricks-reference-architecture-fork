# CLAUDE.md: Databricks Reference Architecture (repo guide)

Canonical repo: `databricks-industry-solutions/databricks-reference-architecture` (PUBLIC).
Live site: https://databricks-industry-solutions.github.io/databricks-reference-architecture/

This file is the authoritative engineering guide for THIS repo. Read it first.
`README.md` describes what the board is and lists the repository layout; this file holds
the rules for changing it.

---

## 1. What this is

See `README.md`. What every change here depends on:

- The static board is a single file: `app/index.html`.
- The AI variant is NOT a second board. `app/ai/app.py` serves the SAME `app/index.html`
  and injects the AI layer (`app/ai/ai.css` + `app/ai/ai.js`) at request time. There is
  only ONE board file to edit; a fix in `app/index.html` reaches the AI app automatically.

## 2. Layout

The full tree is in `README.md` under "Repository layout". Two files it does not list:

- `app/version.json`: `{ "build": "<semver>" }` for cache-busting. It moves with `const BUILD`
  in `app/index.html` (§3, rule 4).
- `index.html` (repo root): a cache-busting redirect to `app/index.html`; with `.nojekyll`
  this is what GitHub Pages serves at the site root.

## 3. HARD rules

1. **Databricks Serverless-safe only.** No `cache`/`persist`/`uncache`, no `SparkContext`,
   nothing that assumes a classic cluster. Any notebook/py here must run on Serverless.
2. **No code comments and no stray docs.** Do not add comments to code and do not create
   `.md`/`.txt` files for changes unless explicitly asked. (This `CLAUDE.md` was explicitly
   requested.)
3. **DRY.** Search before writing. Two implementations of one concept is a bug. The AI app
   reuses the shared board for exactly this reason, so do not re-fork it.
4. **Single-digit semver.** Every segment is one digit 0-9; at 9 it rolls to 0 and carries
   left (… v0.4.9 → v0.5.0 … v0.9.9 → v1.0.0). `app/version.json` and the `const BUILD` in
   `app/index.html` move together.
5. **SCHEMA bump on persisted-board content changes.** The board persists to `localStorage`
   keyed by `const SCHEMA = N;`. A returning browser ignores new baked-in content until
   `SCHEMA` changes. If you change anything baked into a persisted board (platform
   bands/rails, top band, cloud band, consumers, or any industry YAML that renders into
   them), bump `SCHEMA` by 1 in `app/index.html`. `SCHEMA` is a plain counter, NOT the
   semver. Pure CSS / render-logic / i18n-corpus changes do not need a bump.
   Verify: `grep -n "const SCHEMA" app/index.html`.

## 4. Links policy

- Every clickable surface on the board links to Databricks only, enforced at render time by
  `isDatabricksUrl()` (allowlist: `databricks.com` and subdomains, the Azure Databricks docs
  on `learn.microsoft.com`, YouTube, and `github.com/databricks*`). A non-allowlisted URL is
  refused by `linkRow()`/`linksHref()`.
- The one exception is a data-format tile's `spec_url`, which links to the STANDARD body's
  own page (iso20022.org, fixtrading.org, finos.org, hl7.org, …). A standard is not a
  competitor.
- Never link to a competitor product page. Competitors live in `links.json` only as unlinked
  `.url`/`.site` fields; only the Databricks federation doc (`.dbx`) renders.
- Docs search fallback must use `…/search?q=` (not `search.html?q=`).

## 5. Regional availability

`app/resources/regions.json` is generated from two PUBLIC Databricks doc pages per cloud
(`supported-regions` + `feature-region-support`) by `tools/scrape_regions.py`, which holds
the `ALIAS` map (product name → limited-feature column). Policy is PERMISSIVE: a product is
available in ALL supported regions UNLESS the PRODUCT ITSELF is published as region-limited
in public docs. If a limit applies only to a sub-capability, relax it (drop the alias →
all regions). Never show a restriction that public docs do not publish for the product.
The "Available in N of M regions" line links to its exact source doc.

## 6. Gates: run before every PR

```bash
python3 tools/regiongate.py --live          # region data consistent + alias parity + source docs live
node   tools/verify_all_sections.js         # 70 industries + the generic board, uc/genie/dash/app = 10/4/4/4, the deck's editable appendix builds, 0 page errors
node   tools/verify_i18n_coverage.js        # translation coverage over the DATA corpus
python3 tools/linkgate.py                    # structural completeness (add --urls for live link check)
python3 tools/heightgate.py                  # layout / no clipping
node   tools/perfgate.js                     # motion rests at idle, reduced motion honoured, boot fetches once and in parallel
node   tools/verify_exports.js               # deck with its editable appendix + PDF, and the four drawing-app exports: shape parity, structure, links (--live also opens them in draw.io, excalidraw.com, LibreOffice)
```

Local preview: `cd app && python3 -m http.server 8777` then open
`http://localhost:8777/index.html`.

## 7. Fork + PR workflow (HARD)

- `origin`: your fork of the canonical repo. Push all day-to-day work there.
- `upstream`: fetch from `https://github.com/databricks-industry-solutions/databricks-reference-architecture.git`.
  Disable its push URL so `git push upstream` fails by design:
  `git remote set-url --push upstream DISABLED-use-a-PR`.
- The old `amralieg/interactive-databricks-enterprise-architecture` repo is ARCHIVED; do not use it.

Anything landing on the canonical repo goes through a PULL REQUEST, never a direct push:

```bash
git fetch upstream && git checkout -b <feature> upstream/main   # branch off the canonical main
# ...edit, bump BUILD + version.json (+ SCHEMA if persisted content changed), run §6 gates...
git push origin <feature>                                        # to your fork
gh pr create --repo databricks-industry-solutions/databricks-reference-architecture \
  --base main --head <your-github-user>:<feature>
```

Keep the branch current with the canonical repo before opening a PR:

```bash
git fetch upstream && git rebase upstream/main && git push --force-with-lease origin <feature>
```

## 8. Release process

A release is a merged PR into the canonical `main`. Bump `const BUILD` + `app/version.json`
to the next single-digit semver (and `SCHEMA` if persisted content changed), pass all §6
gates, open the PR, and tag `vX.Y.Z` after merge. Release notes cover a summary, highlights,
per-change detail, regressions, validation, and upgrade notes. GitHub Pages redeploys
automatically from `main`.
