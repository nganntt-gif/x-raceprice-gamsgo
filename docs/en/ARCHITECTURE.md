# Architecture — x-raceprice-gamsgo

> Status: **Phase 1** (crawl competitor prices + compute the new price; the Setup sheet is read for
> real via the Google Sheets API). Phase 2 (actually PUT the new price, append to the "Edit History"
> sheet, Dashboard, Telegram, `state.json`) is not built yet.

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

**Reset rule** (MODE=`top` only, both `SORT` variants — mirrors the G2G tool's MODE=top reset rule):
walk the candidate order above, skipping any candidate priced **below** `PRICE MIN`, and follow the
**first candidate priced at or above `PRICE MIN`**. If every candidate is below `PRICE MIN`, this
tool's decision (confirmed with the operator, and this is where it **diverges from the G2G tool**) is
to **skip the row and leave the price unchanged** — the G2G tool instead falls back to `PRICE MIN` in
that case. `MODE=race` never applies the reset rule — it follows the listed `Seller` even at a loss,
same as G2G.

```
desired = round(competitor.price - Price step, decimals of Price step)
desired = desired < PRICE_MIN ? PRICE_MIN : desired   # floor applied a second time: even a competitor
                                                        # above PRICE MIN can still put us below it once
                                                        # Price step is subtracted
```

`PRICE MIN` has **exactly one role** in this tool: a floor clamp applied *after* a valid competitor has
been found. It is never used as a fallback price when no valid competitor exists, in any mode or
sub-case (pool empty after exclusions, `race` seller no longer listed, or reset rule exhausting every
candidate) — unlike the G2G tool, which does fall back to `PRICE MIN` in the "no competitor found"
case.

Rounding: currency is USD, 2 decimals by convention (confirmed with the operator) — no sub-cent case
like G2G's Carrot Seed example. The decimal-count-of-`Price step` approach (`countStepDecimals`,
reading the raw string the operator typed rather than the parsed float, to avoid float-representation
artifacts) is kept anyway for consistency with the G2G codebase and as a safety net, even though it
will always resolve to 2 in practice today.

Tie-breaking note: when two candidates tie exactly on the sort key (price or score), the sort is
stable, so the tie is broken by the original order `planList` returned them in — not further
specified/guaranteed by GamsGo's API, just an implementation detail worth knowing if results ever look
surprising.

## Module map

| File | Responsibility |
|---|---|
| `src/core/http.ts` | `requestJson()` — retry + timeout, shared Chrome-like headers for `mapi.gamsgo2.com`. No auth/401-refresh logic yet (Phase 1 is anonymous-only); proxy rotation is stubbed (`getProxyList()` returns `[]`) pending Phase 2. |
| `src/core/category.ts` | `resolveTypeCategoryId(linkCrawl)` — `LINK CRAWL` → `type_category_id`, with an in-memory, non-expiring cache keyed by the raw `LINK CRAWL` string. |
| `src/core/gamsgo.ts` | `fetchOffers(typeCategoryId, typePlanImage)` — calls `planList`, matches the right variant by `LINK IMAGE`, returns a normalized `Offer[]` (order preserved, no re-sort — that's `pick.ts`'s job). |
| `src/core/target.ts` | `SetupRowRaw`, `RaceTarget`, `parseTarget()` — mirrors the G2G tool's `target.ts` shape/conventions (comma-decimal numbers, strict URL extraction with clear errors, `isRowEnabled`). |
| `src/core/sheets.ts` | `readSetupRows(sheetName)` — reads the "Setup" tab via the Google Sheets API (service-account auth, `credentials.json`), maps header names to `SetupRowRaw` fields. Ported from the G2G tool's `core/sheets.ts`, adapted `COLUMN_ALIASES` for GamsGo's columns (`SORT`, `LINK IMAGE`); import direction is reversed from the G2G version — `SetupRowRaw` lives in `target.ts` here, and `sheets.ts` imports it, not the other way around. `appendEditHistory()` (writing the "Edit History" tab) is **not** ported yet — nothing to log until a price-mutation endpoint exists. |
| `src/util/config.ts` | `loadConfig()` — reads `.env` (`dotenv`) for `SHEET_SETUP` (default `"Setup"`). `SPREADSHEET_ID`/`GOOGLE_SPREADSHEET_ID` is read directly in `sheets.ts`, matching the G2G tool's convention of keeping that constant next to the Sheets client. |
| `src/pick.ts` | `pickCompetitor()` — MODE top/race selection, the reset rule, and the final price computation. Pure, no I/O. |
| `src/dev-test.ts` | Manual runner: reads real Setup rows from Google Sheets via `readSetupRows()`, prints the crawled pool and computed price per enabled row for eyeball verification against real production data. Requires `credentials.json` + `.env` (`SPREADSHEET_ID`) — see README's "Cài đặt Google Sheets" section for one-time setup. |

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
| `Seller` | `MODE=race` target `merchant_id`(s) | currently always exactly one per row in practice; no multi-seller tie-break implemented yet |
| `Price step` | undercut amount + rounding precision | comma-decimal tolerant (`0,01`) |
| `PRICE MIN` | floor clamp + reset-rule threshold | blank ⇒ no floor, no reset rule (`MODE=top` just follows candidate #1) |
| `SELLER_BLACK LIST` | excluded `merchant_id`(s) | comma/semicolon/newline separated |

## Known gaps / open items (Phase 2 territory)

- **No price-editing endpoint identified yet.** Finding the authenticated "change my listing's price"
  call (and its auth header shape — cookie? a `token` header with a real JWT, as seen in the
  `typeCategory` sample curl?) is the next big unknown, same role as G2G's `PUT /offer/{id}?v=v2`.
- **Google Sheets integration is read-only so far.** `core/sheets.ts::readSetupRows()` is ported and
  wired into `dev-test.ts`; `appendEditHistory()` (write to "Edit History") is still not ported — there
  is nothing to log until the price-mutation endpoint above is found.
- **No Dashboard / `state.json` / Telegram noti.** All console output currently goes through plain
  `console.log` in `dev-test.ts` — fine for a manual dev script, but the eventual polling daemon should
  follow the G2G tool's "route everything through one output module" convention once built.
- **`MODE=race` with multiple `Seller` ids has no tie-break rule.** Deferred by explicit agreement with
  the operator until a real row actually needs more than one listed seller.
- **Whether `typeCategory` truly works with no token at all is unverified.** The one real capture we
  have included a real token value; `planList` was confirmed to work with `token: undefined`, but
  `typeCategory` hasn't been separately re-tested without a token.
