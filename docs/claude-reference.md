# Reference material for CLAUDE.md

Long policy text moved verbatim from `CLAUDE.md`. The short rules stay in `CLAUDE.md`; read this when you touch the area.

## Translation check (from CLAUDE.md §3, rule 8)

8. **Check every translation before any PR.** After the Content refresh, run
   `node tools/verify_ui_i18n.js` and fix what it reports. Every string a reader sees in a
   non-English language is translated, with the sense it has on the board: the board, the details
   and region panels, the tour, tooltips and the Excel download. Product, feature and brand names,
   region codes and titles quoted as published stay English, and so do the toolbar and its menus.
   A word that is truly the same in a language goes in `tools/i18n_same.json` for that language
   only. A wrong sense found once (ingestion read as eating, work teams as sports teams, cloud as
   weather) goes in the gate's sense list so it cannot come back. A machine translation of a short
   label is never final until it has been read in context.

## Region panel and region data (from CLAUDE.md §5)

When a product's own doc page publishes its region list (`PRODUCT_PAGES` in the scraper,
today Lakebase and Genie App Builder), that list is the source and wins over the feature
table; a cloud the page does not list counts as not available there.
Every limited column on every cloud belongs to a board product (`ALIAS` or `PRODUCT_PAGES`) or
says in `PART_OF` why it has no box of its own; `regiongate.py` fails on a column that does
neither. The scraper also reads the docs page of every board product on every cloud, and fails
when a page states a region requirement that is neither mapped nor recorded in `REVIEWED` with
the reason it stays unmapped.

**Before every PR, check regional availability against the public docs**: run the Platform
refresh (it re-scrapes the tables and reviews every product page) and `regiongate.py --live`,
and when either reports a gap, settle it from the docs pages before you open the PR.
Availability shows only when the reader picks a region in the Region menu: the menu closes, the
board dims the products that region cannot run, and the region panel opens. It lists the same rows
in every region on every cloud: every feature and Designated Service any cloud's docs publish (the
limited-feature tables, the MCP rows the docs tie to Custom Model Serving, Designated Services
through the region's Geo from `REGION_COUNTRY`, the docs' Geo tables and `AZURE_GEO`), the
partner-powered AI features table (the hosting provider with the setting on and off, the page's
markers such as the Databricks security perimeter, and where Databricks-hosted models need cross
geography processing), and every board product with a docs page. A row another cloud lists reads
Yes here when its docs page exists on this cloud, since the docs leave features that run in every
region out of their tables, and No when it does not. Every row links a docs page on the reader's
cloud; a row with no page there links that cloud's docs search and says so. Each row gives its
stage, its availability (Yes, Conditional, No or Not listed) and only the notes the docs publish,
and cites the docs section that states it. Every column sorts, Stage and Available filter like a
spreadsheet, the filters, sort and search travel in the address bar, and the list downloads as an
Excel file. Each region shows its country's flag and All regions a globe; the Region button shows the
selected flag with no highlight behind it (`COUNTRY_ISO`; `app/resources/flags.json` holds
country-flag-icons under its MIT license). The
Platform refresh rebuilds this data and fails when a docs feature has no docs link (`LINK_TEXT`), a
marker has no recorded meaning (`MARK_EFFECT`), a region has no country, ISO code or Geo (`NO_GEO`
records the exceptions), two clouds name one feature differently (`SAME_FEATURE`), the docs stop
tying a derived row to its column (`DERIVED`), or the partner-powered page loses its table or its
geography sentence. A box's detail panel shows no availability line.


## Release stages (from CLAUDE.md §5)

`app/resources/stages.json` holds every board box's release stage per cloud, read by
`tools/scrape_stages.py` from the notice at the top of the box's own docs page (the `links.json`
`doc` path): "This feature is in Beta / Public Preview / Private Preview", linked or not. A page
without that notice is GA. A box whose page does not exist on a cloud is "Coming soon" there,
and its `links.json` `docClouds` must list exactly the clouds that have the page. LTAP reads its
"Capability | Status" table: the least mature capability wins, and "Not available" is "Coming
soon". A box with no public docs page (`undocumented`) keeps the stage typed on the board.
`stageFor` gives the docs stage for every box that carries a typed `st`/`stByCloud` and falls back
to the typed value; a box without a typed stage never takes one from the docs, even when it shares
a product's name. Keep the typed values in step when you touch a box. No product shows a stage
label, on the board or in its panel: the stage only takes effect when the reader filters with the
Stage menu. The region panel's table is the one exception: it lists each row's stage, from
`stages.json` for a staged box and from the row's own docs page otherwise. The same scraper refreshes the Lakeflow Connect connector catalog in
`platform_docs.json`: it adds connectors the docs list, drops connectors whose page is gone, and
records each connector's stage per cloud; the connector panel lists them A to Z with no stage.
Prose carries no release stage either: no GA, generally available, Public Preview, Private
Preview, Beta or Coming soon in descriptions, capability tags, notes or industry YAML. The
Platform refresh fails on any. Titles of Databricks posts and videos are quoted as published.


## Highlights and use cases (from CLAUDE.md §5b)

Every tile shows every highlight that matches it: customer story, Lakeflow connector, product
tour, demo, Academy course, certification, video and solution accelerator. Panel and section
heads show their own highlights; the board title shows none. `tools/verify_highlights.js` holds
the rules and reads the dots the board actually draws:

- One connector list, `app/resources/connectors.json`, drives both the connector dot and its
  callout.
- A tile whose name differs from the entry it matches reaches it through
  `app/resources/aliases.json` (tile name → entry name). `linkgate` refuses an alias that points
  at itself, chains, names no entry or hides an entry of the same name.
- Every video, demo, course, certification and accelerator lights a dot on some tile, or carries
  a reason in the gate's exemptions.
- Videos come only from the channels in `OFFICIAL_YT` (Databricks, Databricks Events), and the
  title carries the box name or an alias `a` declared on the video. `tools/refresh_videos.py`
  follows title changes, drops videos that are gone, and links each new upload whose title names
  a box. Review what it links; an upload that should not be linked goes in its `SKIP` with the
  reason. It also lists the recent uploads whose title names no box: one that belongs to a box gets
  a video entry with an alias `a` taken from its title. The feeds hold only each channel's latest 15
  uploads, so an older video is added by hand the same way.
- `tools/build_demos.py` owns every demo list through its path → tile `MAP`; never add a demo to
  `links.json` by hand. A tour that should not show maps to an empty list.

`tools/outcome_map.json` marks every use case that comes from a Databricks industry outcome map.
The board never shows the mark. Such a use case needs no customer story, and `linkgate` fails if
it leaves its board or is renamed; it goes only together with its entry in that file. A use case
may give way to a new one only when it has no customer story, no accelerator and no outcome-map
entry, and the new one goes on the board where it belongs.


## Gate catalog (from CLAUDE.md §6)

```bash
python3 tools/refresh_public_data.py --check # Platform: regions, release stages, connectors, certifications, Academy: no drift, no release stage in any description
python3 tools/refresh_content.py --check     # Content: demos and videos current, every tile shows its highlights, labels fit and are translated in every language, highlight links live
python3 tools/regiongate.py --live          # region data consistent, every limited column owned by a board product or explained, every region-table row linked to its cloud's docs with a stage and its markers explained, the same rows on every cloud, every region in a Geo and with a flag, alias parity, source docs live
node   tools/verify_all_sections.js         # 70 industries + the generic board, uc/genie/dash/app = 10/4/4/4, the deck's editable board slide builds, 0 page errors
node   tools/verify_i18n_coverage.js        # translation coverage over the DATA corpus
node   tools/verify_ui_i18n.js                # every string a reader sees is translated with the right sense in all fifteen languages: wrong-sense terms, leftover tokens and the tour offline; the board, the panels, the tour, tooltips and the Excel headers on screen
node   tools/verify_highlights.js           # every tile on every board and cloud draws the dots of the highlights that match it: one connector list for dot and callout, aliases, no orphaned resources
node   tools/verify_label_fit.js            # every panel, card, heading and band label fits its box, and no heading runs under its zoom button, in all sixteen languages and every board shape
python3 tools/linkgate.py                    # structural completeness, retired names, seller phrasing, outcome-map use cases still on their boards, every chip alias names a chip on some board and a LINKS entry (add --urls for live link check, --scope highlights to skip third-party citations)
python3 tools/heightgate.py                  # every board in every shape against the reference height, no clipping, a board that does not load measured once more; a board already over it holds its height in tools/heightgate_baseline.json and may not grow (--tighten after one shrinks)
node   tools/perfgate.js                     # motion rests at idle, reduced motion honoured, boot fetches once and in parallel; the opening intro plays once the board is built, ends on input and leaves nothing behind
node   tools/verify_exports.js               # deck with its editable board slide + PDF, the four drawing-app exports (shape parity, structure, links; --live also opens them in draw.io, excalidraw.com, LibreOffice), line breaks that keep every word whole, and the HTML export (every boot resource frozen, opens offline)
node   tools/smoke_yaml.js                   # YAML descriptor round trip; edited, AI and imported tabs export what is on screen
node   tools/smoke_share.js                  # share links and the address bar: every option in the URL, a copied link reopens the same board
python3 tools/test_certifications.py         # certification builder + gate, offline: catalog drift, exam-guide evidence, mapping integrity
python3 tools/test_linkgate.py               # linkgate file checks, offline: retired name, archived repo, owner-pending exemptions, tile aliases, chip aliases, outcome map, story rule
python3 tools/test_content.py                # content refresh, offline: feed parsing, box matching, cap and skip, title follow-up, highlight link scope
python3 tools/test_heightgate.py             # heightgate, offline: reference budget, held heights, tighten, coverage
python3 tools/test_regions.py                # region scraper + gate, offline: product-page lists, source pages, mapping integrity, region-table parsing (sections, links, markers, Designated Services, Geos, partner-powered AI features, rows another cloud lists, flags)
node   tools/smoke_regions.js                # no box panel shows an availability line; picking a region closes the menu, dims what it cannot run and opens the region panel: the same rows everywhere, every row linked to that cloud's docs, partner-powered notes, cells as the docs read them, spreadsheet filters and sorting kept in the address bar, an .xlsx equal to the table, flags and the globe
node   tools/smoke_ui.js                     # one menu open at a time, an active icon button ringed rather than filled, no AI link in the header, a tour of at most 10 steps that glides without doubling back and shows a box's highlights, opening its panel on a click, Skip quieter than Next
python3 tools/test_stages.py                 # stage scraper, offline: notices, missing clouds, LTAP table, connector discovery, API stage badges, no stage in prose, data integrity
node   tools/smoke_stages.js                 # every box carries its docs stage for the Stage filter on each cloud and shows no stage label; connectors list A to Z with no stage heading; docs win over typed stages; undated credit
```

Every browser gate waits for the opening intro to finish before it measures the board: call
`boardReady(page)` from `tools/lib_serve.js` after each board load.

Local preview: `cd app && python3 -m http.server 8777` then open
