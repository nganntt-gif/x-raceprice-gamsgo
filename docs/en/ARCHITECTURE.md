# Architecture — x-raceprice-gamsgo

> Status: **Phase 2, daemon stage.** Crawl + price computation + the real price-mutation endpoint
> (`editPlanInfo`) all work against live data; the Setup sheet is read for real via the Google Sheets
> API. `src/main.ts` is a real polling daemon (mirroring the G2G tool's `main.ts`/`Dashboard`/
> `state.ts`) that automatically re-prices every enabled row on a timer; `dev-test.ts` (read-only) and
> `dev-apply.ts` (one row, behind `--yes`) remain for manual diagnosis/one-off overrides. Every real
> edit — from the daemon or `dev-apply.ts` — is logged to "Edit History" and sends a Telegram message
> (channel not yet configured for GamsGo — see "Telegram noti"). Still not built: token auto-refresh
> (the auth token is a manually re-exported cookies file) and a process-manager setup (the daemon itself
> doesn't daemonize — see "Daemon polling").

## What this is

A race-price (auto-repricer) tool for a seller on **GamsGo.com** — same core idea as the sibling
project [`x-raceprce-g2g-zerogap`](../../../x-raceprce-g2g-zerogap) (poll a `Setup` sheet, follow a
competitor, undercut by one `Price step`), but for a different platform with a materially different
API shape. This document describes what's actually implemented and verified against GamsGo's real
API (all endpoints below were hit with real `curl` requests during development, not guessed from
docs).

## Why GamsGo needs a different crawl pipeline than G2G

G2G has a single `GET /offer/search?seo_term=...` that both identifies the product (via a slug taken
directly from the crawl URL) and returns the competitor pool in one call. GamsGo has neither:

1. The crawl URL (`LINK CRAWL`, e.g. `https://www.gamsgo.com/top-up/honkai-star-rail`) contains a
   human-readable slug, not the UUID (`type_category_id`) the price-list API actually needs.
2. One category page groups **multiple distinct product variants** (e.g. "800 Robux", "1000 Robux",
   or — as seen in real Setup rows — two different `NAME`s under the exact same `LINK CRAWL`), and
   there's no per-product crawl URL to disambiguate them.

So the pipeline is two API calls plus one client-side match step, not one:

```
LINK CRAWL  ──resolveTypeCategoryId()──▶  type_category_id  ──fetchOffers()──▶  Offer[] (competitor pool)
                (POST /index/typeCategory)      │
                                                 └── matched against LINK IMAGE inside planList's data.list[]
```

## Endpoints (host `mapi.gamsgo2.com`, all called ANONYMOUSLY — no cookie/token)

| Method | URL | Purpose |
|---|---|---|
| POST | `/index/typeCategory` | resolve a crawl-URL slug → `type_category_id` (UUID) |
| POST | `/index/planList` | competitor pool for a `type_category_id` (grouped by product variant) |

Both were verified reachable with `token: undefined` in the request — same "probe anonymously" design
principle as the G2G tool's `fetchOffers` (polling shouldn't be tied to the logged-in account).

### 1) `LINK CRAWL` → `type_category_id`: `POST /index/typeCategory`

`LINK CRAWL` always has the shape `https://www.gamsgo.com/<user_route>/<list_route>` (the two trailing
path segments — confirmed against real data). Request body:

```json
{ "language": "en", "show_currency": "USD", "list_route": "<list_route>" }
```

Response `data[]` can contain **more than one related entry** — e.g. querying `list_route:
"honkai-star-rail"` also returned a `"honkai-star-rail-accounts"` entry (a different category: "Game
Accounts" vs "Top Ups"). The code (`core/category.ts`) therefore matches on **both**
`entry.list_route === list_route` **and** `entry.user_route === '/' + user_route` — never blindly takes
`data[0]`. No match ⇒ throw with the list of `user_route`/`list_route` actually returned, so a bad
`LINK CRAWL` is easy to diagnose from the error alone.

Because a category's UUID essentially never changes, the result is **cached in-memory keyed by the
raw `LINK CRAWL` string**, with no TTL in Phase 1 — this call is not repeated every poll cycle for the
same crawl URL.

*(Note: an earlier draft of this pipeline resolved `type_category_id` by fetching the ~1MB category
page HTML and parsing its Nuxt 3 SSR payload — the raw array-of-values format Nuxt uses for
`__NUXT_DATA__`. That approach worked but was heavy and fragile; `typeCategory` replaced it entirely
once found. Mentioned here only so nobody reinvents the HTML-parsing route.)*

### 2) `type_category_id` → competitor pool: `POST /index/planList`

**Deduplicated across Setup rows sharing the same `LINK CRAWL`.** Multiple Setup rows commonly point at
the same category page (different product variants, same `type_category_id`) — `core/gamsgo.ts` caches
the raw `planList` response in-memory, keyed by `type_category_id`, so `fetchOffers()` only issues the
real HTTP request **once** per unique `type_category_id` within one run; every other row sharing that
category reuses the cached variant list and just filters by its own `LINK IMAGE`. Verified against real
Setup rows sharing a category: only the first row triggered a real request, the second was served from
cache. This is safe for the current one-shot scripts (`dev-test.ts`/`dev-apply.ts` each run once and
exit, so the cache starts empty every run) — **it will NOT be safe once a polling daemon exists**: that
cache must be invalidated at the start of every poll cycle, or competitor prices would freeze at
whatever was fetched on the very first cycle. Unlike `type_category_id`'s cache (correctly permanent —
that UUID essentially never changes), this cache holds prices, which change constantly.

Request body:

```json
{ "language": "en", "show_currency": "USD", "type_category_id": "<uuid>" }
```

**`show_currency` is not optional.** This was found the hard way: omitting it does not error — it
silently returns `total_price` in **VND** (e.g. `9422572`) instead of USD (`359.00`), with no signal
in the response that anything is different. `core/gamsgo.ts::fetchOffers()` always sends
`show_currency: 'USD'` for exactly this reason. This matches something the operator observed on the
live site — the browser's selected currency is stored in a cookie, and the front-end reads that cookie
and fills this field into every request; it is **not** a value the server infers from cookies
automatically, and it is **not** purely a client-side display conversion as first assumed while
reverse-engineering the API (an earlier note in this project's history said "currency switching is
client-side, no need to re-fetch" — that's true for *switching between already-fetched currencies in
the browser UI*, but a **fresh anonymous request with no `show_currency` at all** does not default to
USD).

Response shape:

```
data.list[]                         # one entry per PRODUCT VARIANT within the category
  type_plan_id, type_plan_image, total_price, merchant_id, merchant_name, sort_lcb_score, ...
  list[]                            # the FULL competitor pool for this exact variant — one entry per
                                     #   merchant's own listing, each with its OWN type_plan_id (not
                                     #   the same type_plan_id as the outer variant entry)
```

The outer variant entry duplicates `list[0]`'s fields (the API's own "representative" pick) — the
tool never reads price/merchant data from the outer level, only from inside `list[]`.

### 3) `LINK IMAGE` → picking the right variant

Confirmed against real data: `type_plan_image` is identical across every merchant selling the same
variant (verified with 4 different merchants all sharing one image URL for "800 Robux"), so it's a
reliable identity key for "which variant is this Setup row about" — this is why the Setup sheet has a
`LINK IMAGE` column at all (GamsGo, unlike G2G, has no per-product crawl URL). `core/gamsgo.ts`
searches `data.list[]` for `variant.type_plan_image === typePlanImage` and throws (listing the
`type_plan_image` values actually present) if nothing matches — never falls back to `list[0]`.

### 4) `LINK EDIT` → identifying (and excluding) our own offer

`LINK EDIT` has the shape `https://www.gamsgo.com/shop/<uuid>`, and that `<uuid>` is one specific
merchant listing's `type_plan_id` **inside** the matched variant's `list[]` — confirmed against a real
production row (Honkai Star Rail "Character Guarantee Bundle"): the LINK EDIT UUID matched exactly the
second entry of `list[]`, not the first. This means the tool cannot assume its own offer is `list[0]`
(the API's own "representative" pick) — `pick.ts` filters the pool by comparing every offer's
`typePlanId` against the target's `ownTypePlanId` (parsed strictly from `LINK EDIT` via
`/shop/([^/?#]+)/?$/`, no guessing on a malformed URL).

## Pricing logic

After excluding our own offer (`typePlanId === ownTypePlanId`) and any `merchant_id` in
`SELLER_BLACK LIST`:

| MODE | SORT | Candidate order |
|---|---|---|
| `top` | `price` | ascending by `total_price` (cheapest first) |
| `top` | `recommend` | descending by `sort_lcb_score` (GamsGo's own "recommended" ranking) |
| `race` | *(ignored)* | single candidate: the merchant matching the `Seller` column |

**Reset rule** (MODE=`top` only, both `SORT` variants): walk the candidate order above, skipping any
candidate whose **`price - Price step` is below `PRICE MIN`** — i.e. even undercutting them would
leave no room above the floor — and follow the **first candidate that clears this test**. Because the
test already subtracts `Price step` before comparing, the chosen candidate's computed price is
*guaranteed* to be at or above `PRICE MIN` — there is no second clamp step needed anymore (see below).
If every candidate fails the test, this tool **leaves the price unchanged** (`desired: null`) — `PRICE
MIN` is never used as a price, only as a filter threshold; this is a deliberate divergence from the
G2G tool, which falls back to setting the price to `PRICE MIN` in the equivalent case.

```
desired = round(competitor.price - Price step, decimals of Price step)
```

Two boundary cases fall out of this same formula without any extra branching, because the competitor
pool always excludes our own offer — so "the best remaining candidate" is simultaneously "the seller we
still need to beat" (when we're not yet the best) and "the runner-up" (when we already are the best):

- **We're the only seller for this variant** (pool empty after excluding self + blacklist): `desired:
  null`, no change — nothing to compare against.
- **We're already the best seller** (our own price/score already beats every other candidate): the
  same reset-rule scan picks the best *other* seller as `competitor`, so `competitor.price - Price
  step` both keeps us in first place *and* raises our price toward theirs — capturing margin instead of
  leaving it on the table. No explicit "am I already #1?" check is needed for this to happen.

`MODE=race` **never applies `PRICE MIN` in any form** — no reset rule, and (as of the change below) no
floor clamp either. It always follows the listed `Seller` at exactly `competitor.price - Price step`,
even when that price is below `PRICE MIN` or represents a loss — confirmed explicitly with the
operator ("không quan tâm price min, cứ dí thằng đối thủ" — don't care about `PRICE MIN`, just chase the
competitor). An earlier version of this tool still clamped `race` up to `PRICE MIN` via the same
helper `top` used, which contradicted this intent; the two modes now use a shared, floor-agnostic
`priced()` helper with no `PRICE MIN` parameter at all — `top`'s own reset-rule scan is what keeps *its*
result at or above the floor, not anything inside the pricing helper.

Rounding: currency is USD, 2 decimals by convention (confirmed with the operator) — no sub-cent case
like G2G's Carrot Seed example. The decimal-count-of-`Price step` approach (`countStepDecimals`,
reading the raw string the operator typed rather than the parsed float, to avoid float-representation
artifacts) is kept anyway for consistency with the G2G codebase and as a safety net, even though it
will always resolve to 2 in practice today.

Tie-breaking note: when two candidates tie exactly on the sort key (price or score), the sort is
stable, so the tie is broken by the original order `planList` returned them in — not further
specified/guaranteed by GamsGo's API, just an implementation detail worth knowing if results ever look
surprising.

## Price mutation: `POST /product/editPlanInfo`

Unlike the two crawl endpoints above (fully anonymous), actually changing a listing's price requires
**authentication**. Confirmed via a real browser capture:

```
POST https://mapi.gamsgo2.com/product/editPlanInfo
header: token: <32-char session token>
body:   { "language": "en", "show_currency": "USD", "type_plan_id": "<uuid>", "price": <number> }
```

`type_plan_id` here is `ownTypePlanId` — the same value already extracted from `LINK EDIT` to exclude
our own offer from the competitor pool; editing reuses it as the target of the mutation.

Success response (confirmed real, not guessed):

```json
{ "code": 1, "message": "Successfully", "toast": 1, "redirect_url": "",
  "type": "success", "data": { "type_plan_id": "244a4053-26a7-512d-9960-bd91180d44d5" } }
```

No error response has been captured yet. `core/gamsgo.ts::editPlanInfo()` treats **any** response with
`code !== 1` as a failure and throws with the full raw response echoed — the same "never guess, always
surface the real shape" convention used by `category.ts`'s and `gamsgo.ts`'s other error paths.

**Token source: a browser-exported cookies file, not a manually-copied string.** `core/auth.ts::getAuthToken()`
reads a Playwright-storageState-shaped JSON file (`cookies[]` + `origins[].localStorage[]`) and pulls
the value straight out of a cookie named `token` (domain `.gamsgo.com`) — confirmed against a real
exported cookies file; no `localStorage` digging needed here, unlike G2G's `accessToken`. It also checks
the file's `has_login` cookie and fails clearly if it reads `'0'` (a logged-out session). The file path
comes from `.env`'s `COOKIES_FILE` (default `cookies/gamsgo_go1.json`), mirroring the G2G tool's
`COOKIES_FILE` convention. **The token is static** — there is no login/refresh flow (unlike G2G's
`POST /user/refresh_access`); when it expires, the operator re-exports a fresh cookies file from a
logged-in browser session, same bootstrap stage G2G was in before it grew auto-refresh.

**Mutation is deliberately NOT wired into `dev-test.ts`**, which stays 100% read-only. A separate script,
`src/dev-apply.ts`, computes the same diff (current live price vs. `pickCompetitor()`'s `desired`) for
one `rowIndex` and only calls `editPlanInfo()` when invoked with an explicit `--yes` flag — without it,
the script prints the diff and exits without mutating anything (safe-by-default; no daemon or
auto-apply loop exists yet).

## Logging real edits: the "Edit History" sheet

After a successful `editPlanInfo()` call, `dev-apply.ts` appends exactly one row to the "Edit History"
tab (`SHEET_EDIT_HISTORY` env, default `"Edit History"`) via `core/sheets.ts::appendEditHistory()`.
Columns mostly reuse the G2G tool's header labels (`Game`, `Service`, `Name`, `Top Seller Follow`,
`Note`, `Time`) for consistency across the operator's tools, but the two price columns are
**deliberately different from G2G**: `Price Before`/`Price After` (the live price immediately before
the edit, and the price actually sent to `editPlanInfo`) instead of G2G's `Enemy Price`/`My Price`
(competitor's price / own price) — confirmed with the operator after the first real run. The
competitor's price is not lost; it's still visible inside `Note` (`pickCompetitor()`'s own note string
already includes `đối thủ giá=...`). Other adaptations: `Top Seller Follow` is GamsGo's
`merchant_name`/`merchant_id` (no G2G-style username), there is no `min_qty` column (that's a G2G-only
concept, from its `min_qty*price >= 1 USD` constraint — GamsGo has no equivalent), and `Note` reuses
`pickCompetitor()`'s own `result.note` string verbatim (already detailed: MODE/SORT/reset-rule/skip
count) rather than rebuilding a separate note like G2G's `main.ts` does. `Time` is UTC+7
(`HH:mm:ss DD-MM-YYYY`), computed with plain `Date` math (no `dayjs` dependency added just for a fixed
+7h offset).

**Stricter than G2G's version on purpose.** G2G's `appendEditHistory()` only checks whether the tab
*exists*; if so, it assumes the header is already correct and appends blindly. This tool instead reads
row 1 and requires it to *exactly match* `EDIT_HISTORY_HEADERS` — an empty row 1 gets the header
written; a **non-matching, non-empty** row 1 throws a clear error (both the expected and actual headers)
instead of appending. This was not a hypothetical: the operator's real "Edit History" tab was found to
already contain unrelated data from a different tool (a Roblox RBX top-up log, no header row at all —
row 1 itself was a data row) — appending blindly would have interleaved GamsGo rows into that log with
no boundary between them. The operator must clean up or rename that tab before the first real
`dev-apply --yes` run logs anything.

A failed `appendEditHistory()` call is caught **separately** from `editPlanInfo()`'s own try/catch and
only prints a warning — it does not exit(1) or otherwise suggest the price edit itself failed (it
already succeeded by that point; only the audit-log write failed).

## Telegram noti

After a successful real edit, `dev-apply.ts` sends one Telegram message via
`util/noti.ts::sendNoti()` — ported nearly verbatim from the G2G tool's `util/noti.ts` (same
`noti.hqwg.pro` gateway, same `NOTI_API_KEY`/`NOTI_CHANNEL` env vars, same "blank either one ⇒ silently
disabled" behavior). Only real difference: `Dashboard.error(...)` calls became `console.log(...)`
(GamsGo has no Dashboard module).

**Confirmed with the operator: GamsGo uses its own separate Telegram channel/API key, not G2G's** — to
avoid interleaving two different tools' price-edit messages into one chat, the same reasoning that
drove the stricter "Edit History" header check above. `.env` ships with both vars blank; the operator
must supply GamsGo-specific values before any message actually sends.

**`await`, not `void`, unlike G2G.** G2G calls `void sendNoti(...)` (fire-and-forget) because its
daemon process stays alive indefinitely — no need to wait. `dev-apply.ts` is a one-shot script that
exits right after `main()` resolves; a fire-and-forget call there risks the process exiting before the
HTTP request completes, silently dropping the notification. So the call in `dev-apply.ts` is `await`ed.
`sendNoti()` itself never throws (failures are swallowed and logged, returning `false`), so no extra
try/catch is needed around the call.

The message includes an explicit `Mode`/`Sort` line (requested by the operator) in addition to
`pickCompetitor()`'s own `result.note` (which already mentions MODE/SORT in prose) — `Sort` is only
shown when `mode === 'top'` (meaningless for `race`, matching `target.ts`'s existing convention). A
local `escapeHtml()` helper (mirroring where G2G defines it — in the caller, not in `noti.ts`) escapes
dynamic values before embedding them in the HTML-formatted message.

## Daemon polling (`src/main.ts`)

Mirrors the G2G tool's `main.ts`/`Dashboard`/`state.ts` architecture closely — same overall loop shape,
same `Dashboard` (terminal render via `log-update`+`chalk`, ported near-verbatim), same idea of caching
the Setup tab and never letting one row's error stop the whole cycle. Three deliberate differences,
each tied to a real platform difference from G2G:

1. **No `lastApplied` gate — the daemon compares `desired` against the freshly-crawled live price
   every cycle, not a persisted "last applied" value.** G2G needs `lastApplied` (loaded from
   `state.json`) because its `fetchOffers()` (`GET /offer/search`, paginated with `page_size`) might
   not return G2G's own offer at all if it isn't competitive enough to rank in the first page.
   GamsGo's `planList` returns the **entire** merchant list for a variant (no pagination) — the
   operator's own offer is always present in the crawled pool (confirmed across every real
   `dev-test`/`dev-apply` run, tagged `← CHÍNH MÌNH`). Comparing against the live price instead is more
   robust — it self-heals if the price drifted through some other means (manual web UI edit, a
   concurrent `dev-apply` run) that `state.json` wouldn't know about. `state.json` here holds only
   `editCount` (for the Dashboard), not a decision-gating value — see `util/state.ts`.
2. **The auth token is static — a dead token is always FATAL, unlike G2G's `RefreshTokenError.fatal`
   distinction.** `main.ts` reads the token once at boot via `getAuthToken()`; there is no refresh API
   to fall back to (see "Price mutation" above — this remains a known gap). A `401`/`403` from
   `editPlanInfo` mid-run (`core/http.ts`'s `NonRetryableError`, checked via a local `isAuthDeadError()`)
   is treated as unrecoverable: log FATAL, send a Telegram alert, `process.exit(1)`. The operator must
   export a fresh cookies file and restart — the same end result as G2G's fatal `RefreshTokenError`
   path, reached via a different detection mechanism (no refresh attempt to fail — a live 401/403 IS
   the signal).
3. **`Dashboard` is used only by `main.ts`.** `dev-test.ts`/`dev-apply.ts` keep plain `console.log` —
   they're linear one-shot scripts with no persistent frame to protect, unlike G2G's `CLAUDE.md`
   blanket rule (justified there because G2G has *no* one-shot script at all — everything runs through
   `main.ts`).

Control flow (all in `src/main.ts`):

- `bootstrap()` — sets the Dashboard title, verifies `SPREADSHEET_ID` and the cookies file exist,
  reads the token once (`getAuthToken`, `process.exit(1)` on failure), logs the poll/cache config,
  fires a `void sendNoti(...)` "daemon is running" message (fire-and-forget — safe here since the
  process lives forever, unlike `dev-apply.ts` which must `await` it), then calls `loop()`.
- `loop()` — `while (true) { runCycle() (caught, logged) → Dashboard.setPhase('SLEEPING', nextAt) →
  sleep(pollIntervalSeconds) }`. Never exits on its own; only `process.exit(1)` (fatal auth) stops it.
- `loadTargets()` — cached by `setupCacheSeconds` (default 300s), same pattern as G2G: a Sheets read
  error keeps serving the previous cache if one exists, or throws if this is the very first load.
  `parseTarget()`'s `warnings` (from the `PRICE MIN`/`Seller`/`SELLER_BLACK LIST` validation) are routed
  through `Dashboard.error('SETUP', ...)` here instead of `console.log`.
- `runCycle()` — calls `clearPlanListCache()` **first, every time** (the mandatory invalidation warned
  about in `gamsgo.ts`), loads targets, then calls `processTarget()` for each inside its own try/catch
  — one row's error never stops the others, mirroring `dev-test.ts`'s existing per-row isolation. An
  `isAuthDeadError()` result short-circuits the whole cycle (FATAL exit), skipping any remaining rows.
- `processTarget(target)` — crawls (`resolveTypeCategoryId` + `fetchOffers`, same as `dev-apply.ts`),
  finds the own offer in the pool for the live `currentPrice`, runs `pickCompetitor()`, and only calls
  `editPlanInfo()` if `desired` differs from `currentPrice`. On success: bump `editCount` + `saveState()`,
  `await appendEditHistory(...)` (awaited and separately try/caught, mirroring G2G — a Sheets-write
  failure never suggests the price edit itself failed), then `void sendNoti(...)` (fire-and-forget,
  matching G2G). Every branch updates `Dashboard.updateTarget()` (`SKIP`/`WATCHING`/`EDITED`/`ERROR`).

**No dry-run mode, by design (confirmed with the operator) — same as G2G.** `dev-test.ts` (read-only)
and `dev-apply.ts` (`--yes`-gated, one row) are the safety net for validating logic before trusting the
daemon to run unattended; `main.ts` itself always mutates real prices the moment a row's price differs,
with no flag to preview instead.

## Module map

| File | Responsibility |
|---|---|
| `src/core/http.ts` | `requestJson()` — retry + timeout, shared Chrome-like headers for `mapi.gamsgo2.com`. Supports per-call header overrides (used by `editPlanInfo` to add `token`); no 401-refresh logic (the token is static, see "Price mutation" above). Proxy rotation is stubbed (`getProxyList()` returns `[]`) pending Phase 2. |
| `src/core/category.ts` | `resolveTypeCategoryId(linkCrawl)` — `LINK CRAWL` → `type_category_id`, with an in-memory, non-expiring cache keyed by the raw `LINK CRAWL` string. |
| `src/core/gamsgo.ts` | `fetchOffers(typeCategoryId, typePlanImage)` — calls `planList` (in-memory cached by `type_category_id`, see "planList" above — rows sharing a `LINK CRAWL` only trigger one real request), matches the right variant by `LINK IMAGE`, returns a normalized `Offer[]` (order preserved, no re-sort — that's `pick.ts`'s job). Also `editPlanInfo(typePlanId, price, token)` (price mutation) and `clearPlanListCache()` — must be called at the start of every `main.ts` poll cycle, see "Daemon polling" above. |
| `src/core/auth.ts` | `getAuthToken(cookiesPath)` — reads the browser-exported cookies file, returns the `token` cookie's value for `editPlanInfo`. See "Price mutation" above. |
| `src/core/target.ts` | `SetupRowRaw`, `RaceTarget`, `parseTarget()` — mirrors the G2G tool's `target.ts` shape/conventions (comma-decimal numbers, strict URL extraction with clear errors, `isRowEnabled`). Returns `warnings` for malformed `Seller`/`SELLER_BLACK LIST` entries — see "Setup row validation" below. |
| `src/core/sheets.ts` | `readSetupRows(sheetName)` — reads the "Setup" tab via the Google Sheets API (service-account auth, `credentials.json`), maps header names to `SetupRowRaw` fields. Ported from the G2G tool's `core/sheets.ts`, adapted `COLUMN_ALIASES` for GamsGo's columns (`SORT`, `LINK IMAGE`); import direction is reversed from the G2G version — `SetupRowRaw` lives in `target.ts` here, and `sheets.ts` imports it, not the other way around. Also `appendEditHistory(sheetName, rowData)` — logs one row per real price edit; stricter header validation than G2G's version, see "Logging real edits" above. |
| `src/util/config.ts` | `loadConfig()` — reads `.env` (`dotenv`) for `SHEET_SETUP`, `COOKIES_FILE`/`cookiesPath`, `SHEET_EDIT_HISTORY`, and (for the daemon) `POLL_INTERVAL_SECONDS`/`SETUP_CACHE_SECONDS` (defaults `20`/`300`, matching G2G). `SPREADSHEET_ID`/`GOOGLE_SPREADSHEET_ID` is read directly in `sheets.ts`, matching the G2G tool's convention of keeping that constant next to the Sheets client. |
| `src/util/dashboard.ts` | `Dashboard` — terminal render via `log-update`+`chalk`, ported near-verbatim from the G2G tool. Used only by `main.ts`; see "Daemon polling" above for why `dev-test.ts`/`dev-apply.ts` don't use it. |
| `src/util/state.ts` | `loadState()`/`saveState()` — persists `editCount` (per `ownTypePlanId`) to `state.json`. No `lastApplied` (unlike G2G) — see "Daemon polling" above for why. |
| `src/util/time.ts` | `nowUtc7()` — shared UTC+7 time formatter (`dayjs`), used by both `dev-apply.ts` and `main.ts` for the Edit History "Time" column and Telegram messages. |
| `src/util/noti.ts` | `sendNoti(content)` / `isNotiConfigured()` — posts a Telegram message via the `noti.hqwg.pro` gateway. Ported from the G2G tool almost verbatim; see "Telegram noti" above. |
| `src/pick.ts` | `pickCompetitor()` — MODE top/race selection, the reset rule, and the final price computation. Pure, no I/O. |
| `src/dev-test.ts` | Manual runner: reads real Setup rows from Google Sheets via `readSetupRows()`, prints the crawled pool and computed price per enabled row for eyeball verification against real production data. Fully read-only — never calls `editPlanInfo`. Requires `credentials.json` + `.env` (`SPREADSHEET_ID`) — see README's "Cài đặt Google Sheets" section for one-time setup. |
| `src/dev-apply.ts` | Manual runner for **real** price mutation: same crawl/pick pipeline as `dev-test.ts` for one `rowIndex`, prints the price diff, and only calls `editPlanInfo()` when run with `--yes`. On success, also appends one row to "Edit History" via `appendEditHistory()` (see "Logging real edits" above) and sends one Telegram message via `sendNoti()` (see "Telegram noti" above). Requires `COOKIES_FILE` set up (see "Price mutation" above). |
| `src/main.ts` | The polling daemon — see "Daemon polling" above. Entry point (`bun run start`). |

## Setup sheet columns

| Column | Feeds | Notes |
|---|---|---|
| `CHECK` | `isRowEnabled` | `1/true/yes/on/x` (case-insensitive) |
| `MODE` | `top` \| `race` | blank ⇒ inferred: has `Seller` ⇒ `race`, else `top` |
| `SORT` | `price` \| `recommend` | only meaningful when `MODE=top`; blank/invalid ⇒ `price` |
| `GAME` / `SERVICE` / `NAME` | display only | not used for any API param |
| `LINK CRAWL` | `type_category_id` (via `typeCategory`) | rows sharing the same category page share the same `LINK CRAWL` |
| `LINK IMAGE` | matches the right variant inside `planList` | **required** — no per-product crawl URL exists on GamsGo |
| `LINK EDIT` | `ownTypePlanId` (excluded from the competitor pool) | strict `/shop/<id>` extraction, no guessing |
| `Seller` | `MODE=race` target `merchant_id`(s) | currently always exactly one per row in practice; no multi-seller tie-break implemented yet. Blank **and** `MODE` explicitly `race`/`0` ⇒ defaults to `f58a591c-68e8-dada-ab1b-856a52ed11f9` (merchant "CNLTeam") — only actually followed if that merchant is present in the crawled pool, same as any other race target. Any entry not shaped like a GamsGo merchant UUID triggers a **warning** (row still runs) — see below |
| `Price step` | undercut amount + rounding precision | comma-decimal tolerant (`0,01`) |
| `PRICE MIN` | floor clamp + reset-rule threshold | blank ⇒ no floor, no reset rule (`MODE=top` just follows candidate #1). **Non-blank but unparseable ⇒ hard error, row skipped** (see below) — silently treating a typo as "no floor" would be a real revenue risk |
| `SELLER_BLACK LIST` | excluded `merchant_id`(s) | comma/semicolon/newline separated. Same UUID-shape **warning** as `Seller` above |

## Setup row validation: `PRICE MIN` errors, `Seller`/`SELLER_BLACK LIST` warnings

Two data-entry mistakes were identified as silent risks and are now handled explicitly in
`target.ts::parseTarget()`:

- **`PRICE MIN` non-blank but unparseable ⇒ hard error, the row is skipped entirely** (same tier as
  `LINK CRAWL`/`Price step` errors). Before this, an unparseable value (e.g. a stray letter) fell back
  to `null` — silently treated as "no floor" — which is indistinguishable from the operator
  deliberately leaving it blank. For `MODE=top` that means losing the reset rule's protection entirely
  with no signal anything was wrong. A genuinely blank cell is still valid (no floor, by design) — only
  a non-blank value that fails to parse is an error.
  - Note: `parseNum()` was also tightened to require the **entire** string to match a number pattern,
    not just a valid prefix — plain `parseFloat("133.o0")` returns `133` (not `NaN`), silently accepting
    typos with trailing garbage. This was caught while writing the throwaway verification for this
    exact fix.
- **`Seller` / `SELLER_BLACK LIST` entries not shaped like a GamsGo merchant UUID (`8-4-4-4-12` hex)
  produce a warning, but do NOT block the row.** Lower severity than `PRICE MIN`: a malformed entry
  simply fails to match anyone during pool filtering (one exclusion silently no-ops, or one race target
  is unreachable) rather than removing an entire safety mechanism. `parseTarget()` returns these via an
  optional `warnings: string[]` field; `dev-test.ts`/`dev-apply.ts` print each one prefixed with `⚠️`
  before continuing.

## Known gaps / open items (Phase 2 territory)

- **The price-edit token is static, with no login/refresh flow.** `core/auth.ts::getAuthToken()` reads
  a fixed, manually re-exported cookies file — there is no equivalent of G2G's
  `POST /user/refresh_access`. An expired token surfaces as an `editPlanInfo` failure with the raw
  GamsGo response echoed; the operator must export a fresh cookies file by hand. No error-response
  shape has been captured yet either (only the success shape is confirmed) — `editPlanInfo()`'s error
  handling is necessarily generic (`code !== 1` ⇒ throw with the raw body) until a real failure is seen.
- **No process manager / auto-restart for the daemon.** `main.ts` itself never daemonizes (matching
  G2G — neither tool bakes in pm2/systemd/screen/tmux). If the process dies (crash, server reboot,
  terminal closed without `nohup`/a session manager), nothing restarts it automatically; the operator
  is expected to run it under whatever process manager they prefer. `build:exe`/`build:linux` scripts
  exist (mirroring G2G) to produce a standalone binary for that purpose.
- **The real "Edit History" tab needs manual cleanup before first use.** It currently holds unrelated
  data from a different tool (confirmed: a Roblox RBX top-up log, no proper header row) — `appendEditHistory()`
  refuses to write into it until the operator clears or renames that tab, by design (see "Logging real
  edits" above). Every real edit — from `dev-apply --yes` or the daemon — is logged there; one-off
  dry-runs are not.
- **Telegram noti has no real channel configured yet.** `.env` ships with `NOTI_API_KEY`/`NOTI_CHANNEL`
  blank; the operator needs to supply GamsGo-specific values (deliberately not shared with G2G's) before
  any message actually sends — until then `sendNoti()` silently no-ops, which is safe but means nothing
  is sent yet in practice.
- **`MODE=race` with multiple `Seller` ids has no tie-break rule.** Deferred by explicit agreement with
  the operator until a real row actually needs more than one listed seller.
- **Whether `typeCategory` truly works with no token at all is unverified.** The one real capture we
  have included a real token value; `planList` was confirmed to work with `token: undefined`, but
  `typeCategory` hasn't been separately re-tested without a token.
