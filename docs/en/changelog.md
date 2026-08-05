# Changelog

## [0.1.1] - 2026-08-05 — Google Sheets read integration

Read side of the Google Sheets integration, ported from `x-raceprce-g2g-zerogap`'s `core/sheets.ts`
and wired into `dev-test.ts` (which previously ran against 3 hard-coded sample rows).

### Added

- **`src/core/sheets.ts`** — `getSheetsClient()` (service-account auth via `credentials.json` +
  `googleapis`) and `readSetupRows(sheetName)`, reading the "Setup" tab and mapping header names to
  `SetupRowRaw` fields via `COLUMN_ALIASES` (adapted from the G2G version to GamsGo's columns: adds
  `SORT` and `LINK IMAGE`, drops `Seller Level`, which GamsGo's `target.ts` doesn't have). Checks
  `credentials.json` exists before calling `GoogleAuth`, throwing a clear message pointing at the
  README instead of letting a raw `ENOENT` surface from inside `googleapis`.
  `appendEditHistory()` was deliberately **not** ported — there is no price-mutation endpoint yet, so
  there is nothing to log to an "Edit History" tab (would be dead code).
- **`src/util/config.ts`** — `loadConfig()` reading `SHEET_SETUP` from `.env` (default `"Setup"`).
  `SPREADSHEET_ID`/`GOOGLE_SPREADSHEET_ID` deliberately lives in `sheets.ts` instead, matching the G2G
  tool's convention of keeping that constant next to the Sheets client rather than in `AppConfig`.
- **`.env.example`** (`SPREADSHEET_ID`, `SHEET_SETUP`) and **`.gitignore`** (`.env`, `credentials.json`,
  `node_modules`, …) — neither existed yet in this project.
- New dependencies: `googleapis@110.0.0`, `dotenv@^17.2.0` (same pinned versions as the G2G project).
- README: new "Cài đặt Google Sheets" section — one-time service-account setup steps (enable the API,
  create a service account, download its JSON key as `credentials.json`, share the sheet with the
  service account's `client_email`, set `SPREADSHEET_ID` in `.env`).

### Changed

- **`src/dev-test.ts`** now calls `readSetupRows()` instead of iterating a hard-coded `SAMPLE_ROWS`
  array; it exits early with a clear message if `SPREADSHEET_ID` is missing from `.env`.
- **Import direction of `SetupRowRaw` is reversed from the G2G project.** In G2G, `sheets.ts` defines
  the type and `target.ts` imports it. Here, `target.ts` already defined `SetupRowRaw` (written before
  `sheets.ts` existed), so `sheets.ts` imports the type from `./target` instead — noted explicitly in
  both files' header comments to avoid confusion when cross-referencing the G2G codebase.

### Verified

- `bunx tsc --noEmit` shows no new type errors from the added/changed files (a pre-existing, unrelated
  `HeadersInit` error in `core/http.ts` predates this change).
- `bun run dev-test` exits with a clear, actionable error in both failure paths tested: missing
  `SPREADSHEET_ID` in `.env`, and missing `credentials.json` on disk.

## [0.1.0] - 2026-08-05 — Phase 1: crawl competitor prices + compute new price

Initial build of the project, branched conceptually from
[`x-raceprce-g2g-zerogap`](../../../x-raceprce-g2g-zerogap) (same MODE top/race + reset-rule shape),
retargeted at GamsGo's REST API. Scope: **crawl + price computation only** — no price mutation, no
Google Sheets integration, no Dashboard/Telegram/`state.json` yet (deliberately deferred to Phase 2).

### Added

- **`src/core/http.ts`** — `requestJson()`: retry + timeout + shared Chrome-like headers for
  `mapi.gamsgo2.com` calls, adapted from the G2G tool's `core/http.ts` with `onUnauthorized`/401-refresh
  removed (Phase 1 only calls anonymous endpoints). Proxy rotation stubbed (`getProxyList()` returns
  `[]`) — no `proxys/proxy.txt` wiring yet.
- **`src/core/category.ts`** — `resolveTypeCategoryId(linkCrawl)`: resolves `LINK CRAWL`'s two trailing
  URL segments (`user_route`/`list_route`) to a `type_category_id` UUID via `POST
  /index/typeCategory`, matching on both fields (never blindly takes `data[0]` — the endpoint can
  return multiple related entries for one query). Result cached in-memory, keyed by the raw `LINK
  CRAWL` string, no TTL.
- **`src/core/gamsgo.ts`** — `fetchOffers(typeCategoryId, typePlanImage)`: calls `POST
  /index/planList`, finds the variant matching `LINK IMAGE` (`type_plan_image`), returns a normalized,
  order-preserved `Offer[]` from that variant's nested `list[]` (the actual competitor pool).
- **`src/core/target.ts`** — `SetupRowRaw`, `RaceTarget`, `parseTarget()`: parses a Setup row into
  typed fields (`ownTypePlanId` from `LINK EDIT` via strict `/shop/<id>` extraction, comma-decimal
  number parsing, `isRowEnabled`), mirroring the G2G tool's `target.ts` conventions.
- **`src/pick.ts`** — `pickCompetitor()`: MODE `top`/`race` competitor selection + the G2G-style reset
  rule for MODE=top (see "Changed" below) + final price computation with a `PRICE MIN` floor.
- **`src/dev-test.ts`** — manual runner with 3 real Setup rows hard-coded (Honkai Star Rail ×2, Zenless
  Zone Zero), printing the crawled pool and computed price per row.
- Bilingual docs (`README.md`, `docs/en/`, `docs/vi/`) covering the architecture, the two-step
  `typeCategory` → `planList` crawl pipeline, and the pricing rules.

### Changed (relative to the initially-assumed design)

- **Added a G2G-style "reset rule" to MODE=`top`** (both `SORT=price` and `SORT=recommend`), after the
  first design pass had shipped MODE=top with `PRICE MIN` as a plain floor only. Verified live against
  real data: on a real row with `PRICE MIN=357.85`, the cheapest candidate (298) was correctly skipped
  and the tool followed the next candidate at 359 instead.
- **Diverged from G2G's reset-rule fallback intentionally**: when the reset rule exhausts every
  candidate without finding one at or above `PRICE MIN`, this tool skips the row (no price change)
  rather than falling back to `PRICE MIN` like the G2G tool does. Confirmed explicitly with the
  operator — this is the same decision as the "no competitor found at all" case, kept consistent on
  purpose.
- **Category-ID resolution switched from HTML/Nuxt-payload parsing to a dedicated API.** An initial
  investigation found `type_category_id` embedded in the category page's Nuxt 3 SSR payload
  (`<script id="__NUXT_DATA__">`, a flat JSON array using integer-index references) and a working
  resolver was drafted around it. This was fully replaced once `POST /index/typeCategory` was found —
  same result, far lighter (no ~1MB HTML fetch) and simpler to reason about.

### Fixed

- **`planList` silently returned prices in VND instead of USD.** Found while running `dev-test.ts`
  against live data: without `show_currency: "USD"` in the request body, `total_price` came back as a
  large VND-scale number (e.g. `9422572`) with no error or signal that anything was wrong — every other
  field looked normal. Root cause: currency is not inferred by the server from anonymous requests; the
  real browser stores the selected currency in a cookie and the front-end fills it into every request's
  `show_currency` field. Fixed by always sending `show_currency: 'USD'` in `fetchOffers()`. This also
  corrected an earlier (wrong) assumption written into project notes that currency handling was "purely
  client-side, no need to re-fetch" — that's true only for switching between currencies already
  fetched in a browser session, not for a fresh anonymous API call with no currency specified at all.

### Verified against real production data

- `LINK IMAGE` (`type_plan_image`) confirmed identical across every merchant selling the same variant
  (4 different merchants, same image URL, for "800 Robux").
- `LINK EDIT`'s UUID confirmed to match a `type_plan_id` **inside** a variant's `list[]` — and, on a
  real row, specifically the *second* entry, not `list[0]` — ruling out any shortcut that assumed "my
  own offer is always first."
- `typeCategory`'s `data[]` confirmed to return multiple related entries for a single `list_route`
  query (different `user_route` values), validating the decision to match on both fields.

### Known gaps (tracked for Phase 2 — see `docs/en/ARCHITECTURE.md`'s "Known gaps" section)

- No price-editing endpoint identified yet (the GamsGo equivalent of G2G's `PUT /offer/{id}?v=v2`).
- No Google Sheets read/write, no Dashboard, no `state.json`, no Telegram notification.
- No tie-break rule for `MODE=race` with more than one listed `Seller` (deferred — no real row needs it
  yet).
- `typeCategory`'s no-token behavior is unverified (only `planList` was explicitly re-tested anonymous).
