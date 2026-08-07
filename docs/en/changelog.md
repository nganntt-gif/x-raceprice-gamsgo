# Changelog

## [0.2.1] - 2026-08-06 — README rewritten to match G2G's structure/brevity

The operator asked for the README to describe the project the way G2G's README does — a compact
numbered-section reference (setup columns, per-cycle flow, pricing rules, directory tree, `.env`,
install/run) — instead of the phase-status banners and prose walkthroughs that had accumulated across
this session's incremental changes.

### Changed

- **`README.md`** — rewritten from scratch following G2G's exact section skeleton: intro paragraph +
  endpoint table → `## 1. Tab Setup` → `## 2. Luồng chạy mỗi chu kỳ` → `## 3. Quy tắc tính giá` →
  `## 4. Cấu trúc thư mục` → `## 5. Cấu hình .env` → `## 6. Cài đặt & chạy`. Removed the "Phase 2..."
  status banner, the standalone `dev-test`/`dev-apply`/daemon marketing sections with detailed
  safety-warning prose, and the "known gaps" style notes — all of that detail already lives in
  `ARCHITECTURE.md`/`changelog.md`, matching how G2G's own README stays terse and defers depth to its
  `docs/`.
- The `credentials.json`/cookies-file requirements are now stated in one line each (matching G2G's
  exact phrasing style: "X — Y có quyền Z"), not as multi-step walkthroughs. An initial attempt to move
  the walkthrough into `ARCHITECTURE.md` instead of deleting it was reverted at the operator's explicit
  request — G2G's own `ARCHITECTURE.md` doesn't carry that walkthrough either, and the operator wants
  parity, not just "don't lose information" by relocating it.

## [0.2.0] - 2026-08-06 — Polling daemon (`src/main.ts`), mirroring G2G's `main.ts`/`Dashboard`/`state.ts`

The operator asked to build the remaining automation (daemon loop, cache invalidation, background
running, Dashboard, error classification, `state.json`) explicitly following the G2G tool's `main.ts`
architecture, which was re-read in full (`main.ts`, `core/auth.ts`, `core/g2g.ts`, `util/dashboard.ts`,
`util/state.ts`, `util/noti.ts`, `CLAUDE.md`) to mirror it precisely.

### Added

- **`src/main.ts` (new)** — the polling daemon. `bootstrap()` → `loop()` (`while(true)`: `runCycle()`,
  `Dashboard.setPhase('SLEEPING', nextAt)`, sleep `pollIntervalSeconds`) → `runCycle()` (calls
  `clearPlanListCache()` first, loads cached targets, isolates each `processTarget()` call in its own
  try/catch) → `processTarget()` (crawl, compare `desired` against the live-crawled price, call
  `editPlanInfo()` if different, persist `editCount`, log to Edit History, notify Telegram). No dry-run
  mode — confirmed with the operator to match G2G exactly; `dev-test.ts`/`dev-apply.ts` remain the
  pre-daemon validation path.
- **`src/util/dashboard.ts` (new)** — `Dashboard`, ported near-verbatim from G2G (terminal render via
  `log-update`+`chalk`, `TargetStatus`/`SystemPhase`, scrolling log buffer). Renamed the displayed title
  only. Used exclusively by `main.ts` — `dev-test.ts`/`dev-apply.ts` keep `console.log` (they're linear
  one-shot scripts with no persistent frame to protect, unlike G2G which has no one-shot script at all).
- **`src/util/state.ts` (new)** — `loadState()`/`saveState()`, persisting to `state.json`. Holds only
  `editCount` (keyed by `ownTypePlanId`) — deliberately **no** `lastApplied`, unlike G2G. See "Deviation
  #1" below.
- **`src/util/time.ts` (new)** — extracted `nowUtc7()` (now `dayjs`-based) shared by `dev-apply.ts` and
  `main.ts`, replacing `dev-apply.ts`'s previous native-`Date` version now that `dayjs` is a real
  dependency (added for the Dashboard).
- **`src/core/gamsgo.ts::clearPlanListCache()`** — the invalidation hook the code/docs had been warning
  about since the `planList` cache was added; `runCycle()` calls it first thing, every cycle.
- **`src/util/config.ts`** — added `pollIntervalSeconds` (`POLL_INTERVAL_SECONDS`, default `20`) and
  `setupCacheSeconds` (`SETUP_CACHE_SECONDS`, default `300`), matching G2G's defaults.
- **`package.json`** — added `chalk@4.1.2`, `dayjs@^1.11.19`, `log-update@4.0.0` (dependencies) and
  `rimraf@^6.0.1` (devDependency), matching G2G's exact pinned versions. Added `start`/`dev`/`race`/
  `clean`/`build:exe`/`build:linux` scripts mirroring G2G's; changed `"main"` from `src/dev-test.ts` to
  `src/main.ts`.

### Three deliberate deviations from G2G (platform-driven, not oversights)

1. **No `lastApplied` gate.** G2G needs it because `GET /offer/search` is paginated (`page_size`) and
   might not return G2G's own offer at all if it isn't competitive enough to rank. GamsGo's `planList`
   returns the *entire* merchant list for a variant — the operator's own offer is always present in the
   crawled pool. `processTarget()` therefore compares `desired` against the freshly-crawled live price
   every cycle instead, which additionally self-heals if the price drifted through some other means
   (manual web UI edit, a concurrent `dev-apply` run) that a persisted value wouldn't know about.
2. **A dead token is always FATAL — no `RefreshTokenError.fatal` distinction.** There is no refresh API
   to fall back to (still a known gap). A `401`/`403` from `editPlanInfo` mid-run (detected via
   `core/http.ts`'s `NonRetryableError.status`, through a local `isAuthDeadError()`) logs FATAL, sends a
   Telegram alert, and calls `process.exit(1)` — the same end result as G2G's fatal path, reached
   without an actual refresh attempt (there's nothing to attempt).
3. **`Dashboard` is main.ts-only.** `dev-test.ts`/`dev-apply.ts` are unaffected.

### Verified

- `bunx tsc --noEmit` — no new type errors.
- A throwaway script (no mutation) covered: `clearPlanListCache()` doesn't throw when called
  (including twice in a row); `isAuthDeadError()` correctly classifies `NonRetryableError` with status
  401/403 as fatal and 404/plain `Error` as not; `nowUtc7()`'s output matches the expected format;
  `saveState()`/`loadState()` round-trip correctly on a real (but newly-created, confirmed absent
  beforehand) `state.json`, which was deleted again afterward to leave no test artifact.

## [0.1.9] - 2026-08-06 — Setup data validation: `PRICE MIN` errors, `Seller`/`SELLER_BLACK LIST` warnings

Follow-up on a review of "what happens on bad Setup data" — two silent-failure risks identified and
fixed, prioritized as quick/high-impact before starting on the polling daemon.

### Fixed

- **`src/core/target.ts::parseNum()` accepted trailing garbage.** Plain `parseFloat("133.o0")` returns
  `133`, not `NaN` — it only reads the valid *prefix*. Tightened to require the entire string (after
  comma→dot normalization) to match `^-?\d+(\.\d+)?$` before calling `parseFloat`. Caught while writing
  the throwaway verification for the fix below — the original test data would have silently passed.
- **`PRICE MIN` non-blank but unparseable used to silently become `null` ("no floor").** Indistinguishable
  from the operator deliberately leaving it blank, and for `MODE=top` it meant losing the reset rule's
  protection entirely with zero signal. Now a hard `parseTarget()` error (same tier as `LINK CRAWL`/
  `Price step`), skipping the row. A genuinely blank cell is still valid (no floor, unchanged).

### Added

- **`Seller`/`SELLER_BLACK LIST` format warning.** GamsGo `merchant_id`s are always UUID-shaped
  (`8-4-4-4-12` hex, confirmed against every real sample seen). `parseTarget()` now returns an optional
  `warnings: string[]` when an entry doesn't match that shape — printed by `dev-test.ts`/`dev-apply.ts`
  prefixed `⚠️`, but the row still runs (lower severity than `PRICE MIN`: one malformed entry just fails
  to match anyone, not a loss of an entire safety mechanism).

### Verified

- A throwaway script called `parseTarget()` directly across 7 cases (blank `PRICE MIN` valid; valid
  comma-decimal `PRICE MIN`; garbled `PRICE MIN` → error; valid-UUID blacklist → no warning; malformed
  blacklist → warning + row still parses; malformed `Seller` in race mode → warning; default race
  seller (CNLTeam) never flagged as malformed). First run caught the `parseNum()` leniency bug above;
  all 7 passed after the fix.
- `bun run dev-test` against the real Setup sheet — no warnings/errors on current live rows (clean
  data), confirming no regression.
- `bunx tsc --noEmit` — no new type errors.

## [0.1.8] - 2026-08-06 — Telegram noti after every real price edit

### Added

- **`src/util/noti.ts` (new)** — `sendNoti(content)` / `isNotiConfigured()`, ported almost verbatim
  from the G2G tool's `util/noti.ts` (same `noti.hqwg.pro` gateway, same `NOTI_API_KEY`/`NOTI_CHANNEL`
  env vars, same "either blank ⇒ silently disabled" behavior). Only change: `Dashboard.error(...)` →
  `console.log(...)` (GamsGo has no Dashboard module).
- **`src/dev-apply.ts`** — after a successful real edit (and independent of whether `appendEditHistory()`
  succeeded), sends one Telegram message via `sendNoti()`. Added a local `escapeHtml()` helper
  (mirroring where G2G defines it — in the caller, not `noti.ts`) to safely embed dynamic values. The
  message includes an explicit `Mode`/`Sort` line (`Sort` only shown for `mode === 'top'`) in addition
  to `pickCompetitor()`'s own detailed `result.note`, plus price before → after, game/service/name,
  time (UTC+7), and the row's `LINK CRAWL`.
- **Deliberately `await`ed, not `void`, unlike G2G.** G2G's daemon process stays alive indefinitely, so
  `void sendNoti(...)` (fire-and-forget) is safe there. `dev-apply.ts` is a one-shot script that exits
  right after `main()` resolves — a fire-and-forget call risked the process exiting before the HTTP
  request completed, silently dropping the notification. `sendNoti()` never throws (failures are
  swallowed and logged internally, returning `false`), so no extra try/catch was needed around the
  `await`ed call.
- `.env.example` / `.env` — added `NOTI_API_KEY` / `NOTI_CHANNEL` (both blank by default).

### Confirmed with the operator

- **GamsGo uses its own separate Telegram channel/API key — not G2G's.** Same reasoning as the
  stricter "Edit History" header check from 0.1.5: avoid interleaving two different tools' messages
  into one chat. `.env` ships with both vars blank; the operator must supply GamsGo-specific values.

### Verified

- `bunx tsc --noEmit` — no new type errors.
- A throwaway script called `sendNoti()` directly with `NOTI_API_KEY`/`NOTI_CHANNEL` blank — confirmed
  `isNotiConfigured()` returns `false` and `sendNoti()` safely no-ops (returns `false`, sends nothing)
  rather than erroring. No real Telegram message has been sent yet — that requires the operator's
  GamsGo-specific channel credentials.

## [0.1.7] - 2026-08-06 — Default MODE=race seller when `Seller` is blank

### Added

- **`src/core/target.ts`** — when a row's `MODE` explicitly reads `race`/`0` (not blank-inferred) and
  `Seller` is empty, `sellerIds` now defaults to `['f58a591c-68e8-dada-ab1b-856a52ed11f9']` (merchant
  "CNLTeam"), via a new `DEFAULT_RACE_SELLER_ID` constant and `isExplicitRaceMode()` helper. Deliberately
  restricted to *explicit* `race`/`0` — blank `MODE` + blank `Seller` still infers `top`, exactly as
  before, so no existing `top` rows silently start following CNLTeam.
- Whether this default seller is actually followed still depends entirely on it being present in the
  crawled pool for that row's product variant — `pickCompetitor()`'s existing "not found ⇒ skip" logic
  in `pick.ts` already handles that; no changes needed there.

### Verified

- A throwaway script called `parseTarget()` directly (pure function, no network) across 4 cases:
  explicit `race` + blank `Seller` → defaults to CNLTeam; blank `MODE` + blank `Seller` → still `top`,
  no default applied; explicit `race` + a real `Seller` value → kept as-is, not overridden; `MODE="0"`
  + blank `Seller` → also defaults (confirms the numeric alias is covered too). All 4 passed.
- `bunx tsc --noEmit` — no new type errors.

## [0.1.6] - 2026-08-06 — Edit History price columns: "Before/After" instead of "Enemy/My"

Follow-up to 0.1.5, requested right after the operator cleaned up the real "Edit History" tab: replace
the two price columns' meaning entirely.

### Changed

- **`src/core/sheets.ts`** — `EDIT_HISTORY_HEADERS`'s price columns renamed `Enemy Price`/`My Price` →
  **`Price Before`/`Price After`**.
- **`src/dev-apply.ts`** — the row built for `appendEditHistory()` now sends `currentPrice` (the live
  price read right before the edit) for `Price Before`, unchanged `result.desired` for `Price After`.
  The competitor's price is not dropped — it was never a separate concern from `Note`, which already
  includes `đối thủ giá=...` from `pickCompetitor()`'s own note string.
- Docs (`ARCHITECTURE.md` en/vi, `README.md`) updated to describe the new column meaning; the 0.1.5
  changelog entry above is left as-is (accurate historical record of what shipped at that time).

## [0.1.5] - 2026-08-06 — Log every real edit to the "Edit History" sheet

`dev-apply.ts` could mutate real prices but left no trace. Ported the G2G tool's
`appendEditHistory()` pattern, adapted to GamsGo's own data shape — and, while implementing it,
discovered the operator's real "Edit History" tab already contained unrelated data from a different
tool, which shaped the design below.

### Added

- **`src/core/sheets.ts::appendEditHistory(sheetName, rowData)`** + `EDIT_HISTORY_HEADERS` — same
  header labels as the G2G tool (`Game`, `Service`, `Name`, `Enemy Price`, `My Price`, `Top Seller
  Follow`, `Note`, `Time`) for consistency across the operator's tools, but the *values* are GamsGo's
  own: `Top Seller Follow` uses `merchant_name`/`merchant_id` (no G2G-style username), there is no
  `min_qty` column (a G2G-only concept from its `min_qty*price >= 1 USD` constraint — GamsGo has no
  equivalent), and `Note` reuses `pickCompetitor()`'s own `result.note` string verbatim instead of
  rebuilding separate note-construction logic like G2G's `main.ts` does.
- **Stricter header validation than G2G's version, by design.** G2G's `appendEditHistory()` only
  checks whether the tab exists, then appends blindly, assuming the header is already correct. This
  version reads row 1 and requires an *exact* match against `EDIT_HISTORY_HEADERS`; an empty row 1 gets
  the header written, but a non-empty, non-matching row 1 throws a clear error (both expected and
  actual headers) instead of appending under the wrong columns.
- **`src/dev-apply.ts`** — added a local `nowUtc7()` helper (plain `Date` math, UTC+7,
  `HH:mm:ss DD-MM-YYYY` — deliberately no new `dayjs` dependency just for a fixed +7h offset). After a
  successful `editPlanInfo()` call, builds the row and calls `appendEditHistory()`. That call is
  wrapped in its **own** try/catch, separate from `editPlanInfo()`'s — a failed Sheet write only prints
  a warning; it never exits(1) or implies the price edit itself failed (it already succeeded by then).
- `src/util/config.ts` — added `editHistorySheet` (env `SHEET_EDIT_HISTORY`, default `"Edit History"`),
  mirroring G2G's field of the same name.

### Found while building this

- **The real "Edit History" tab already contained unrelated data from a different tool** — a Roblox
  RBX top-up log (sellers like `CNLTeam`/`AdanTv`, no proper header row; row 1 itself was a data row).
  Blind-appending (the G2G approach) would have interleaved GamsGo rows into that log with no boundary
  between the two. This directly motivated the stricter header check above — the operator must clean up
  or rename that tab before the first real `dev-apply --yes` logs anything.

### Verified

- `bunx tsc --noEmit` — no new type errors.
- A throwaway script called `appendEditHistory()` against a temporary tab name — confirmed
  auto-create-tab + write-header + append all worked, then the temp tab was deleted via one manual
  `batchUpdate` call (not added as a permanent feature).
- The same script also called `appendEditHistory('Edit History', ...)` against the **real** tab —
  confirmed it threw the expected clear mismatch error (echoing the real header found: `RBL, Topup,
  RBL - 4500 RBX, ...`) and wrote nothing, validating the safety net against the exact real-world
  situation described above.

## [0.1.4] - 2026-08-06 — Dedupe `planList` calls across rows sharing `LINK CRAWL`

The operator asked to verify whether Setup rows sharing the same `LINK CRAWL` were already grouped to
avoid redundant `planList` calls. They were not — `resolveTypeCategoryId()` already cached
`type_category_id` per `LINK CRAWL`, but `fetchOffers()` re-issued a real `planList` HTTP request on
every call regardless, even when two rows resolved to the identical `type_category_id` (confirmed with
real Setup data: rows 2/3 and rows 4/5 each share one category).

### Fixed

- **`src/core/gamsgo.ts`** — added an in-memory `planListCache` keyed by `type_category_id` (same
  pattern as `category.ts`'s cache, extracted into a new internal `fetchPlanListVariants()` helper).
  `fetchOffers()`'s public signature/behavior is unchanged; it now only issues a real request the first
  time a given `type_category_id` is seen, and any other row sharing that category reuses the cached
  variant list. No changes needed in `dev-test.ts`/`dev-apply.ts` — they already call `fetchOffers()`
  the same way.
- Documented an important caveat prominently in both the cache's own comment and `ARCHITECTURE.md`:
  this cache is safe for the current one-shot scripts (fresh process per run ⇒ cache starts empty every
  time), but **will be a real bug once a polling daemon exists** — that daemon must invalidate
  `planListCache` at the start of every poll cycle, or competitor prices would freeze at whatever was
  fetched on the daemon's very first cycle and never update again. This is unlike `category.ts`'s cache
  of `type_category_id`, which is correctly permanent (that UUID essentially never changes) — this new
  cache holds prices, which change constantly, so a future daemon absolutely cannot treat it the same
  way.

### Verified

- Temporarily instrumented `fetchPlanListVariants()` with a debug log distinguishing a real HTTP call
  from a cache hit, ran `bun run dev-test` (read-only) against the real Setup sheet, confirmed rows
  4 and 5 (sharing one `LINK CRAWL`) produced exactly one real call and one cache hit for the same
  `type_category_id`, then removed the debug log before committing.
- `bunx tsc --noEmit` — no new type errors (pre-existing, unrelated `HeadersInit` error in
  `core/http.ts` predates this change).

## [0.1.3] - 2026-08-06 — Real price mutation: `editPlanInfo` + `dev-apply.ts`

The biggest open question from Phase 1 — how to actually change a listing's price — is resolved. The
operator captured the real endpoint from a browser DevTools session and confirmed both the request and
a success response shape.

### Added

- **`src/core/gamsgo.ts::editPlanInfo(typePlanId, price, token)`** — calls `POST
  https://mapi.gamsgo2.com/product/editPlanInfo` with body `{language, show_currency, type_plan_id,
  price}` and a `token` header, reusing `core/http.ts`'s existing `requestJson()` (its per-call header
  merge was already anticipated for exactly this in a Phase-1 comment — no changes needed to
  `http.ts`). Treats any response with `code !== 1` as a failure and throws with the full raw response
  echoed; only the success shape (`{code: 1, message: "Successfully", type: "success", data:
  {type_plan_id}}`) has been captured so far.
- **`src/core/auth.ts` (new)** — `getAuthToken(cookiesPath)` reads a browser-exported cookies file
  (Playwright storageState shape: `cookies[]` + `origins[].localStorage[]`) and returns the value of
  the cookie named `token` (domain `.gamsgo.com`). Confirmed against a real exported cookies file that
  the token lives directly in `cookies[]` — no `localStorage` digging needed, unlike G2G's
  `accessToken`. Also checks the file's `has_login` cookie and fails clearly on `'0'` (logged-out
  session). Throws with the full list of cookie names present if `token` isn't found — never guesses.
- **`src/util/config.ts`** — added `cookiesFile`/`cookiesPath` (env `COOKIES_FILE`, default
  `cookies/gamsgo_go1.json`), mirroring the G2G tool's `COOKIES_FILE` convention.
- **`src/dev-apply.ts` (new)** — manual runner for real price mutation, deliberately **separate** from
  `dev-test.ts` (which stays 100% read-only). Reads auth token first (fails fast before any crawling if
  the cookies file is missing/invalid), runs the same crawl/pick pipeline as `dev-test.ts` for one
  `rowIndex` (CLI arg), reads the operator's own live price straight from the freshly-crawled offers
  (`offers.find(o => o.typePlanId === target.ownTypePlanId)` — no `state.json` needed), and prints a
  clear diff. Only calls `editPlanInfo()` when run with an explicit `--yes` flag; without it, the
  script prints the diff and exits — safe-by-default, no accidental real mutation.
- `.gitignore`: added `cookies/` (a real logged-in session must never be committed).
- `.env.example` / `.env`: added `COOKIES_FILE`.
- `package.json`: added the `dev-apply` script.

### Confirmed against real production data

- Ran `bun run dev-apply 4` (dry-run) against the real Setup sheet — correctly computed the diff
  (`15.07 → 14.49`) and made no API call.
- Ran `bun run dev-apply 4 --yes` for real (with the operator's explicit go-ahead) — GamsGo returned
  `code: 1` / `"Successfully"` with the matching `type_plan_id`. Re-ran the dry-run afterward and
  confirmed the live price crawled back as `14.49`, matching the applied value exactly — full
  crawl → compute → mutate → re-verify loop confirmed working end-to-end against the real API.

## [0.1.2] - 2026-08-06 — Reset-rule floor fix + MODE=race drops PRICE MIN entirely

Two related fixes to `src/pick.ts`'s pricing logic, prompted by the operator walking through 3
boundary cases for MODE=`top` and, in the course of that discussion, confirming a real bug in
MODE=`race`'s handling of `PRICE MIN`.

### Fixed

- **MODE=`top` reset rule could still set the price to exactly `PRICE MIN`.** The reset rule used to
  compare a candidate's **raw** price against `PRICE MIN` to decide whether to skip it, then — even for
  a candidate that passed that check — clamp the final price up to exactly `PRICE MIN` if subtracting
  `Price step` dipped back below the floor. This contradicted the project's own stated rule that `PRICE
  MIN` is *never* used as an actual price. Fixed by changing the skip condition to `candidate.price -
  Price step < PRICE MIN` (checked *before* picking a candidate, not after), so the chosen candidate's
  computed price is guaranteed to already clear the floor — no second clamp needed. If every candidate
  now fails this stricter test, the row is skipped entirely (price left unchanged) instead of being
  forced to `PRICE MIN`.
- **MODE=`race` silently clamped to `PRICE MIN` too, contradicting its own documented intent.** Both
  MODE=`top` and MODE=`race` shared one `finalize()` helper that always applied the `PRICE MIN` clamp
  when set. This meant `race` — which the architecture docs already described as following the listed
  `Seller` "even at a loss" — was in practice never allowed to price below `PRICE MIN`. Confirmed
  explicitly with the operator ("không quan tâm price min, cứ dí thằng đối thủ" — don't care about
  `PRICE MIN` at all for race mode, just chase the competitor) that this was a bug, not intended
  behavior. Fixed by replacing `finalize()` with a floor-agnostic `priced()` helper that has no `PRICE
  MIN` parameter at all; `race` now always computes `competitor.price - Price step` with zero floor
  logic, matching the docs for the first time.

### Confirmed as already correct (no code change)

Two boundary cases the operator asked to have "added" turned out to already be satisfied by the
existing algorithm, once traced through carefully — documented explicitly in `pick.ts` comments and
both `ARCHITECTURE.md` files so this isn't mistaken for a gap later:

- **We're the only seller for a variant** (pool empty after excluding self + blacklist) → price left
  unchanged. Already the `sorted.length === 0` branch.
- **We're already the best-ranked seller** → the reset-rule scan's `sorted[0]` (the pool always
  excludes our own offer) is simultaneously "the seller we still need to beat" when we're not yet best,
  and "the runner-up" when we already are — so the exact same `competitor.price - Price step` formula
  both defends the top spot *and* raises price toward the runner-up to capture margin, with no need to
  ever check "am I already #1?" explicitly.

### Verified

- `bunx tsc --noEmit` — no new type errors (pre-existing, unrelated `HeadersInit` error in
  `core/http.ts` predates this change).
- `bun run dev-test` against the real Setup sheet — all 4 live rows produced the same prices as before
  the change (none of them are currently close enough to `PRICE MIN` to exercise the new stricter
  skip condition), confirming no regression on the common path.
- A throwaway script calling `pickCompetitor()` directly with hand-built `Offer[]` fixtures (written,
  run, and deleted — not committed) covered the 5 cases: MODE=top "keep unchanged" (single candidate
  failing the new test), MODE=top "still finds a valid later candidate" (first skipped, second
  accepted, no clamp), MODE=race with `PRICE MIN` set and a below-floor competitor (price follows the
  competitor exactly, not clamped up), plus the two "already correct" cases above (empty pool, already
  top-ranked) as regression checks.

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
