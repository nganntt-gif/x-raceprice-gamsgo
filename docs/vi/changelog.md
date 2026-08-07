# Changelog

## [0.2.1] - 2026-08-06 — Viết lại README theo đúng cấu trúc/độ ngắn gọn của G2G

Người dùng yêu cầu README mô tả dự án giống đúng cách README bản G2G làm — 1 tài liệu tham khảo ngắn,
chia mục có số thứ tự (cột Setup, luồng chạy mỗi chu kỳ, quy tắc giá, cấu trúc thư mục, `.env`, cài
đặt & chạy) — thay vì banner trạng thái Phase + văn xuôi walkthrough đã tích lũy dần qua các thay đổi
trong phiên làm việc này.

### Changed

- **`README.md`** — viết lại từ đầu theo ĐÚNG khung mục của G2G: đoạn giới thiệu + bảng endpoint →
  `## 1. Tab Setup` → `## 2. Luồng chạy mỗi chu kỳ` → `## 3. Quy tắc tính giá` → `## 4. Cấu trúc thư
  mục` → `## 5. Cấu hình .env` → `## 6. Cài đặt & chạy`. Bỏ banner trạng thái "Phase 2...", bỏ các mục
  riêng biệt kiểu marketing cho `dev-test`/`dev-apply`/daemon kèm văn xuôi cảnh báo an toàn dài, bỏ style
  "known gaps" — toàn bộ chi tiết đó đã có sẵn trong `ARCHITECTURE.md`/`changelog.md`, đúng cách README
  bản G2G luôn ngắn gọn và để phần sâu cho `docs/`.
- Yêu cầu `credentials.json`/file cookies giờ chỉ 1 dòng mỗi mục (đúng văn phong G2G: "X — Y có quyền
  Z"), không còn walkthrough nhiều bước. Lần thử đầu tiên là chuyển walkthrough sang `ARCHITECTURE.md`
  thay vì xoá hẳn — đã bị revert theo đúng yêu cầu rõ ràng của người dùng: `ARCHITECTURE.md` bản G2G
  cũng không có walkthrough đó, người dùng muốn ĐÚNG PARITY với G2G, không phải chỉ "không mất thông
  tin" bằng cách dời sang nơi khác.

## [0.2.0] - 2026-08-06 — Daemon polling (`src/main.ts`), mirror `main.ts`/`Dashboard`/`state.ts` của G2G

Người dùng yêu cầu xây phần automation còn thiếu (daemon loop, xoá cache, chạy nền, Dashboard, phân
loại lỗi, `state.json`) theo ĐÚNG kiến trúc `main.ts` bản G2G — đã đọc lại đầy đủ (`main.ts`,
`core/auth.ts`, `core/g2g.ts`, `util/dashboard.ts`, `util/state.ts`, `util/noti.ts`, `CLAUDE.md`) để
mirror chính xác.

### Added

- **`src/main.ts` (mới)** — daemon polling. `bootstrap()` → `loop()` (`while(true)`: `runCycle()`,
  `Dashboard.setPhase('SLEEPING', nextAt)`, sleep `pollIntervalSeconds`) → `runCycle()` (gọi
  `clearPlanListCache()` đầu tiên, load targets có cache, cô lập từng `processTarget()` trong try/catch
  riêng) → `processTarget()` (crawl, so `desired` với giá live crawl được, gọi `editPlanInfo()` nếu
  khác, lưu `editCount`, ghi Edit History, bắn Telegram). Không có dry-run — đã xác nhận với người dùng
  giống đúng G2G; `dev-test.ts`/`dev-apply.ts` vẫn là lớp validate trước khi tin tưởng daemon.
- **`src/util/dashboard.ts` (mới)** — `Dashboard`, port gần như nguyên văn từ G2G (render terminal qua
  `log-update`+`chalk`, `TargetStatus`/`SystemPhase`, buffer log cuộn). Chỉ đổi tên hiển thị. Chỉ dùng
  trong `main.ts` — `dev-test.ts`/`dev-apply.ts` giữ `console.log` (script chạy 1 lần, tuyến tính,
  không có khung nào cần bảo vệ, khác G2G hoàn toàn không có script chạy 1 lần nào).
- **`src/util/state.ts` (mới)** — `loadState()`/`saveState()`, lưu vào `state.json`. Chỉ giữ
  `editCount` (theo `ownTypePlanId`) — chủ động KHÔNG có `lastApplied` như G2G. Xem "Khác biệt #1" dưới.
- **`src/util/time.ts` (mới)** — tách `nowUtc7()` (giờ dùng `dayjs`) dùng chung cho `dev-apply.ts` và
  `main.ts`, thay bản `Date` thuần cũ của `dev-apply.ts` vì `dayjs` giờ đã là dependency thật (thêm cho
  Dashboard).
- **`src/core/gamsgo.ts::clearPlanListCache()`** — đúng cơ chế invalidate mà code/docs đã cảnh báo từ
  lúc thêm cache `planList`; `runCycle()` gọi ĐẦU TIÊN, mỗi chu kỳ.
- **`src/util/config.ts`** — thêm `pollIntervalSeconds` (`POLL_INTERVAL_SECONDS`, mặc định `20`) và
  `setupCacheSeconds` (`SETUP_CACHE_SECONDS`, mặc định `300`), đúng mặc định của G2G.
- **`package.json`** — thêm `chalk@4.1.2`, `dayjs@^1.11.19`, `log-update@4.0.0` (dependencies) và
  `rimraf@^6.0.1` (devDependency), đúng version G2G đang dùng. Thêm script `start`/`dev`/`race`/
  `clean`/`build:exe`/`build:linux` mirror G2G; đổi `"main"` từ `src/dev-test.ts` → `src/main.ts`.

### 3 điểm khác biệt có chủ đích so với G2G (do khác nền tảng, không phải thiếu sót)

1. **Không dùng `lastApplied` để gate.** G2G cần vì `GET /offer/search` phân trang (`page_size`), có
   thể KHÔNG trả offer của chính G2G nếu giá không đủ cạnh tranh để vào top. `planList` của Gamsgo trả
   TOÀN BỘ merchant của biến thể — offer của mình luôn có trong pool crawl được. `processTarget()` vì
   vậy so `desired` với giá LIVE crawl mỗi chu kỳ — tự "chữa lành" nếu giá bị đổi qua đường khác (web UI
   tay, 1 lần `dev-apply` khác) mà giá trị lưu lại không biết tới.
2. **Token chết luôn FATAL — không có phân loại kiểu `RefreshTokenError.fatal`.** Không có API refresh
   nào để thử (vẫn là known gap). Lỗi `401`/`403` từ `editPlanInfo` giữa chừng (phát hiện qua
   `NonRetryableError.status` của `core/http.ts`, qua helper `isAuthDeadError()`) log FATAL, bắn
   Telegram, gọi `process.exit(1)` — cùng kết quả cuối với nhánh fatal của G2G, chỉ khác không có bước
   refresh thật nào để thử (không có gì để thử).
3. **`Dashboard` chỉ dùng trong `main.ts`.** `dev-test.ts`/`dev-apply.ts` không đổi gì.

### Đã verify

- `bunx tsc --noEmit` — không phát sinh lỗi type mới.
- 1 script throwaway (không mutate) cover: `clearPlanListCache()` không throw khi gọi (kể cả gọi 2 lần
  liên tiếp); `isAuthDeadError()` phân loại đúng `NonRetryableError` status 401/403 là fatal, 404/`Error`
  thường thì không; `nowUtc7()` ra đúng format; `saveState()`/`loadState()` round-trip đúng trên
  `state.json` thật (nhưng mới tạo, đã xác nhận chưa tồn tại từ trước) — xoá lại ngay sau đó, không để
  lại dấu vết test.

## [0.1.9] - 2026-08-06 — Validate data Setup: `PRICE MIN` ném lỗi, `Seller`/`SELLER_BLACK LIST` cảnh báo

Nối tiếp việc rà lại "gặp lỗi dữ liệu Sheet thì xử lý sao" — 2 rủi ro âm thầm được phát hiện và sửa,
ưu tiên làm trước vì nhanh + rủi ro tiền thật, trước khi bắt đầu daemon polling.

### Fixed

- **`src/core/target.ts::parseNum()` chấp nhận rác phía sau.** `parseFloat("133.o0")` thuần trả về
  `133`, không phải `NaN` — chỉ đọc phần ĐẦU hợp lệ. Siết lại: bắt buộc khớp NGUYÊN chuỗi (sau khi đổi
  dấu phẩy→chấm) với `^-?\d+(\.\d+)?$` trước khi gọi `parseFloat`. Phát hiện ngay lúc viết script
  verify cho fix dưới — data test ban đầu lẽ ra đã lọt qua âm thầm nếu không bắt kịp.
- **`PRICE MIN` có giá trị nhưng không parse được số từng âm thầm thành `null` ("không sàn").** Không
  phân biệt được với việc người dùng CHỦ Ý để trống, và với `MODE=top` nghĩa là mất hẳn bảo vệ của
  reset rule mà không có tín hiệu gì. Giờ là lỗi CHẶN CỨNG của `parseTarget()` (cùng mức `LINK CRAWL`/
  `Price step`), bỏ qua cả dòng. Ô THẬT SỰ để trống vẫn hợp lệ (không sàn, không đổi).

### Added

- **Cảnh báo định dạng `Seller`/`SELLER_BLACK LIST`.** `merchant_id` của Gamsgo luôn có dạng UUID
  (`8-4-4-4-12` hex, đã xác nhận qua mọi mẫu thật gặp được). `parseTarget()` giờ trả thêm field tùy
  chọn `warnings: string[]` khi có entry không đúng dạng — `dev-test.ts`/`dev-apply.ts` in ra kèm tiền
  tố `⚠️`, nhưng dòng vẫn chạy tiếp (mức độ nhẹ hơn `PRICE MIN`: 1 entry sai chỉ không khớp được ai,
  không phải mất cả 1 lớp bảo vệ).

### Đã verify

- 1 script throwaway gọi `parseTarget()` trực tiếp qua 7 case (`PRICE MIN` trống hợp lệ; `PRICE MIN`
  dấu phẩy VN hợp lệ; `PRICE MIN` gõ lẫn ký tự → lỗi; blacklist UUID hợp lệ → không warning; blacklist
  sai dạng → có warning + dòng vẫn parse được; `Seller` sai dạng ở race mode → có warning; seller mặc
  định race CNLTeam không bao giờ bị flag sai dạng). Lần chạy đầu bắt được đúng bug leniency của
  `parseNum()` ở trên; cả 7 PASS sau khi sửa.
- `bun run dev-test` trên tab Setup thật — không có warning/lỗi nào ở các dòng hiện tại (data sạch),
  xác nhận không regression.
- `bunx tsc --noEmit` — không phát sinh lỗi type mới.

## [0.1.8] - 2026-08-06 — Telegram noti sau mỗi lần sửa giá thật

### Added

- **`src/util/noti.ts` (mới)** — `sendNoti(content)` / `isNotiConfigured()`, port gần như nguyên văn từ
  `util/noti.ts` bản G2G (cùng gateway `noti.hqwg.pro`, cùng env `NOTI_API_KEY`/`NOTI_CHANNEL`, cùng
  hành vi "thiếu 1 trong 2 → tắt im lặng"). Chỉ đổi 1 chỗ: `Dashboard.error(...)` → `console.log(...)`
  (Gamsgo chưa có module Dashboard).
- **`src/dev-apply.ts`** — sau khi sửa giá thật thành công (độc lập với việc `appendEditHistory()` có
  lỗi hay không), bắn 1 tin Telegram qua `sendNoti()`. Thêm helper `escapeHtml()` tại chỗ (đặt ở nơi
  gọi, giống G2G, không phải trong `noti.ts`) để nhúng an toàn giá trị động. Tin nhắn có thêm dòng
  **Mode/Sort** riêng (`Sort` chỉ hiện khi `mode === 'top'`) ngoài `result.note` chi tiết sẵn có của
  `pickCompetitor()`, cùng giá trước→sau, game/service/name, giờ (UTC+7), và `LINK CRAWL` của dòng.
- **Chủ động dùng `await`, không `void` như G2G.** Daemon G2G sống liên tục nên `void sendNoti(...)`
  (fire-and-forget) an toàn ở đó. `dev-apply.ts` là script chạy 1 lần rồi thoát ngay — fire-and-forget
  có rủi ro process exit trước khi request HTTP gửi xong, làm mất tin âm thầm. `sendNoti()` không bao
  giờ throw (lỗi tự nuốt + log nội bộ, trả `false`) — không cần thêm try/catch quanh lệnh `await`.
- `.env.example` / `.env` — thêm `NOTI_API_KEY` / `NOTI_CHANNEL` (mặc định để trống cả 2).

### Đã xác nhận với người dùng

- **Gamsgo dùng channel/API key Telegram RIÊNG — không dùng chung với G2G.** Cùng lý do đã dẫn tới việc
  kiểm header chặt hơn ở tab "Edit History" (0.1.5): tránh lẫn tin 2 tool vào 1 nhóm chat. `.env` để
  trống cả 2 field; người dùng cần tự điền giá trị thật riêng cho Gamsgo.

### Đã verify

- `bunx tsc --noEmit` — không phát sinh lỗi type mới.
- 1 script throwaway gọi `sendNoti()` trực tiếp khi `NOTI_API_KEY`/`NOTI_CHANNEL` còn trống — xác nhận
  `isNotiConfigured()` trả `false` và `sendNoti()` tự tắt an toàn (trả `false`, không gửi gì) thay vì
  lỗi. Chưa gửi tin Telegram thật nào — cần người dùng cung cấp channel thật riêng cho Gamsgo.

## [0.1.7] - 2026-08-06 — Mặc định seller cho MODE=race khi `Seller` trống

### Added

- **`src/core/target.ts`** — khi cột `MODE` ghi RÕ RÀNG `race`/`0` (không phải suy luận từ Seller
  trống) và `Seller` trống, `sellerIds` giờ mặc định `['f58a591c-68e8-dada-ab1b-856a52ed11f9']`
  (merchant "CNLTeam"), qua hằng số `DEFAULT_RACE_SELLER_ID` mới + helper `isExplicitRaceMode()`. Chủ
  động giới hạn ở case MODE **rõ ràng** `race`/`0` — MODE trống + Seller trống vẫn suy luận `top` như
  cũ, nên không có dòng `top` cũ nào bị âm thầm bám theo CNLTeam.
- Seller mặc định này có ĐƯỢC BÁM THẬT hay không vẫn phụ thuộc hoàn toàn vào việc nó có trong pool đã
  crawl cho đúng biến thể của dòng đó không — logic "không tìm thấy ⇒ bỏ qua" có sẵn của
  `pickCompetitor()` trong `pick.ts` đã xử lý đúng, không cần sửa gì thêm ở đó.

### Đã verify

- 1 script throwaway gọi `parseTarget()` trực tiếp (hàm thuần, không network) qua 4 case: MODE=race rõ
  ràng + Seller trống → default CNLTeam; MODE trống + Seller trống → vẫn `top`, không áp default;
  MODE=race + Seller có giá trị thật → giữ nguyên, không bị đè; `MODE="0"` + Seller trống → cũng áp
  default (xác nhận alias số cũng được cover). Cả 4 đều PASS.
- `bunx tsc --noEmit` — không phát sinh lỗi type mới.

## [0.1.6] - 2026-08-06 — Cột giá Edit History: "Trước/Sau" thay vì "Đối thủ/Của mình"

Nối tiếp 0.1.5, người dùng yêu cầu ngay sau khi dọn xong tab "Edit History" thật: đổi hẳn ý nghĩa 2
cột giá.

### Changed

- **`src/core/sheets.ts`** — 2 cột giá trong `EDIT_HISTORY_HEADERS` đổi tên `Enemy Price`/`My Price` →
  **`Price Before`/`Price After`**.
- **`src/dev-apply.ts`** — row build cho `appendEditHistory()` giờ gửi `currentPrice` (giá live đọc
  ngay trước khi sửa) cho `Price Before`, giữ nguyên `result.desired` cho `Price After`. Giá đối thủ
  không bị mất — vốn dĩ đã không phải mối lo riêng với `Note`, cột đó đã có sẵn `đối thủ giá=...` từ
  chuỗi note của `pickCompetitor()`.
- Docs (`ARCHITECTURE.md` en/vi, `README.md`) cập nhật đúng ý nghĩa cột mới; entry changelog 0.1.5 ở
  trên giữ nguyên (đúng lịch sử những gì đã ship lúc đó).

## [0.1.5] - 2026-08-06 — Ghi log mỗi lần sửa giá thật vào tab "Edit History"

`dev-apply.ts` sửa được giá thật nhưng không để lại vết gì. Port pattern `appendEditHistory()` của
bản G2G, chỉnh theo đúng data Gamsgo — và trong lúc làm, phát hiện tab "Edit History" thật của người
dùng đang chứa dữ liệu của 1 tool khác, ảnh hưởng trực tiếp tới thiết kế dưới đây.

### Added

- **`src/core/sheets.ts::appendEditHistory(sheetName, rowData)`** + `EDIT_HISTORY_HEADERS` — dùng ĐÚNG
  label cột như bản G2G (`Game`, `Service`, `Name`, `Enemy Price`, `My Price`, `Top Seller Follow`,
  `Note`, `Time`) để nhất quán giữa các tool của người dùng, nhưng GIÁ TRỊ là của riêng Gamsgo:
  `Top Seller Follow` dùng `merchant_name`/`merchant_id` (không có username kiểu G2G), không có cột
  `min_qty` (khái niệm riêng của G2G, từ ràng buộc `min_qty*giá >= 1 USD` — Gamsgo không có ràng buộc
  tương đương), và `Note` tái dùng NGUYÊN chuỗi `result.note` của `pickCompetitor()` thay vì dựng lại
  logic build note riêng như `main.ts` bản G2G phải làm.
- **Kiểm tra header chặt hơn bản G2G, có chủ đích.** `appendEditHistory()` bản G2G chỉ check tab có tồn
  tại chưa rồi append thẳng, giả định header luôn đúng. Bản này đọc row 1 và yêu cầu khớp CHÍNH XÁC
  `EDIT_HISTORY_HEADERS`; row 1 rỗng thì ghi header, nhưng row 1 có dữ liệu mà KHÔNG khớp thì ném lỗi
  rõ (kèm cả header dự kiến và thực tế) thay vì append lẫn dưới cột sai.
- **`src/dev-apply.ts`** — thêm helper `nowUtc7()` tại chỗ (Date thuần, UTC+7,
  `HH:mm:ss DD-MM-YYYY` — chủ động KHÔNG thêm dependency `dayjs` chỉ để làm đúng 1 việc cộng cố định 7
  giờ). Sau khi `editPlanInfo()` thành công, build row rồi gọi `appendEditHistory()`. Lệnh gọi này bọc
  trong try/catch RIÊNG, tách khỏi try/catch của `editPlanInfo()` — lỗi ghi Sheet chỉ in cảnh báo,
  không `exit(1)` hay ngụ ý việc sửa giá thất bại (giá đã đổi thành công rồi).
- `src/util/config.ts` — thêm `editHistorySheet` (env `SHEET_EDIT_HISTORY`, mặc định `"Edit History"`),
  đúng tên field của G2G.

### Phát hiện trong lúc làm

- **Tab "Edit History" thật đang chứa dữ liệu của 1 tool khác** — log bán RBX Roblox (seller kiểu
  `CNLTeam`/`AdanTv`, không có header đúng nghĩa; chính row 1 là 1 dòng data). Nếu append thẳng (theo
  kiểu G2G), dòng Gamsgo sẽ bị trộn lẫn vào log đó không có ranh giới gì. Đây là động lực trực tiếp cho
  việc kiểm tra header chặt hơn ở trên — người dùng cần dọn/đổi tên tab đó trước khi lần
  `dev-apply --yes` đầu tiên ghi log thật.

### Đã verify

- `bunx tsc --noEmit` — không phát sinh lỗi type mới.
- 1 script throwaway gọi `appendEditHistory()` vào 1 tab tên tạm — xác nhận tự tạo tab + ghi header +
  append đều đúng, rồi xoá tab tạm bằng 1 lệnh `batchUpdate` tay (không thêm vào code chính thức).
- Cùng script gọi `appendEditHistory('Edit History', ...)` vào tab THẬT — xác nhận ném đúng lỗi mismatch
  kỳ vọng (echo lại header thật tìm thấy: `RBL, Topup, RBL - 4500 RBX, ...`) và không ghi gì, verify
  đúng cái an toàn thiết kế cho case thật đã mô tả trên.

## [0.1.4] - 2026-08-06 — Gom `planList` cho dòng cùng `LINK CRAWL`

Người dùng hỏi kiểm tra lại: các dòng Setup cùng `LINK CRAWL` đã được gom để tránh gọi lại `planList`
thừa chưa. Câu trả lời là CHƯA — `resolveTypeCategoryId()` đã cache `type_category_id` theo
`LINK CRAWL` từ trước, nhưng `fetchOffers()` vẫn gọi request `planList` thật MỖI LẦN được gọi, kể cả
khi 2 dòng resolve ra CÙNG 1 `type_category_id` (xác nhận bằng dữ liệu Setup thật: dòng 2/3 và dòng
4/5 mỗi cặp cùng chung 1 category).

### Fixed

- **`src/core/gamsgo.ts`** — thêm cache `planListCache` trong bộ nhớ, khoá theo `type_category_id`
  (cùng pattern với cache của `category.ts`, tách ra hàm nội bộ `fetchPlanListVariants()` mới).
  Signature/hành vi công khai của `fetchOffers()` không đổi; giờ chỉ gọi request thật lần đầu gặp 1
  `type_category_id`, dòng khác cùng category tái dùng list biến thể đã cache. Không cần sửa
  `dev-test.ts`/`dev-apply.ts` — 2 script đó vẫn gọi `fetchOffers()` giống hệt như trước.
- Ghi chú rõ 1 điểm quan trọng, cả trong comment ngay tại cache và trong `ARCHITECTURE.md`: cache này
  AN TOÀN với 2 script chạy 1 lượt hiện tại (mỗi lần chạy là process mới ⇒ cache tự rỗng lại), nhưng
  **sẽ thành bug thật khi có daemon polling** — daemon đó phải xoá `planListCache` ở đầu MỖI chu kỳ
  poll, nếu không giá đối thủ sẽ đông cứng mãi ở lần fetch đầu tiên của daemon, không bao giờ cập nhật.
  Khác với cache `type_category_id` của `category.ts` (đúng là nên vĩnh viễn vì UUID đó gần như bất
  biến) — cache mới này giữ GIÁ, thứ đổi liên tục, nên daemon tương lai tuyệt đối không thể xử lý giống
  nhau.

### Đã verify

- Tạm chèn 1 dòng debug log vào `fetchPlanListVariants()` để phân biệt request thật vs cache hit, chạy
  `bun run dev-test` (read-only) trên tab Setup thật, xác nhận dòng 4 và 5 (cùng `LINK CRAWL`) ra đúng
  1 request thật + 1 cache hit cho cùng `type_category_id`, rồi xoá dòng debug trước khi hoàn tất.
- `bunx tsc --noEmit` — không phát sinh lỗi type mới (lỗi `HeadersInit` có sẵn trong `core/http.ts` là
  lỗi cũ, không liên quan).

## [0.1.3] - 2026-08-06 — Sửa giá thật: `editPlanInfo` + `dev-apply.ts`

Ẩn số lớn nhất của Phase 1 — làm sao sửa giá listing thật — đã được giải quyết. Người dùng bắt được
endpoint thật từ 1 phiên DevTools trên browser, xác nhận cả request và response thành công.

### Added

- **`src/core/gamsgo.ts::editPlanInfo(typePlanId, price, token)`** — gọi `POST
  https://mapi.gamsgo2.com/product/editPlanInfo` với body `{language, show_currency, type_plan_id,
  price}` và header `token`, tái dùng `requestJson()` có sẵn của `core/http.ts` (cơ chế merge header
  riêng theo call đã được dự đoán sẵn từ 1 comment ở Phase 1 — không cần sửa `http.ts`). Coi mọi
  response có `code !== 1` là lỗi và ném kèm nguyên response gốc; mới chỉ bắt được mẫu thành công
  (`{code: 1, message: "Successfully", type: "success", data: {type_plan_id}}`).
- **`src/core/auth.ts` (mới)** — `getAuthToken(cookiesPath)` đọc file cookies export từ browser (dạng
  Playwright storageState: `cookies[]` + `origins[].localStorage[]`), trả giá trị cookie tên `token`
  (domain `.gamsgo.com`). Đã xác nhận bằng file cookies thật: token nằm NGAY trong `cookies[]`, không
  cần đào `localStorage` như G2G phải làm với `accessToken`. Cũng kiểm tra cookie `has_login`, báo lỗi
  rõ nếu đọc được `'0'` (session đã đăng xuất). Ném kèm nguyên danh sách tên cookie thật có nếu không
  tìm thấy `token` — không đoán mò.
- **`src/util/config.ts`** — thêm `cookiesFile`/`cookiesPath` (env `COOKIES_FILE`, mặc định
  `cookies/gamsgo_go1.json`), đúng quy ước `COOKIES_FILE` của bản G2G.
- **`src/dev-apply.ts` (mới)** — script chạy tay để sửa giá thật, chủ động **tách riêng** khỏi
  `dev-test.ts` (script đó giữ 100% read-only). Đọc token TRƯỚC (fail sớm nếu file cookies thiếu/hỏng,
  trước khi tốn công crawl), chạy đúng pipeline crawl/tính giá của `dev-test.ts` cho 1 `rowIndex` (CLI
  arg), đọc giá live hiện tại của chính mình ngay từ pool vừa crawl
  (`offers.find(o => o.typePlanId === target.ownTypePlanId)` — không cần `state.json`), in diff rõ
  ràng. Chỉ gọi `editPlanInfo()` khi chạy kèm cờ `--yes`; thiếu cờ này script in diff rồi dừng — an
  toàn theo mặc định, không lỡ tay mutate.
- `.gitignore`: thêm `cookies/` (session đăng nhập thật, không bao giờ commit).
- `.env.example` / `.env`: thêm `COOKIES_FILE`.
- `package.json`: thêm script `dev-apply`.

### Đã xác nhận bằng dữ liệu sản xuất thật

- Chạy `bun run dev-apply 4` (dry-run) trên tab Setup thật — tính đúng diff (`15.07 → 14.49`), không
  gọi API nào.
- Chạy THẬT `bun run dev-apply 4 --yes` (đã xin xác nhận rõ ràng từ người dùng trước khi chạy) — GamsGo
  trả về `code: 1` / `"Successfully"` khớp đúng `type_plan_id`. Chạy lại dry-run ngay sau đó, xác nhận
  giá crawl lại được đúng `14.49`, khớp chính xác giá đã áp — xác nhận toàn bộ vòng đời
  crawl → tính giá → sửa giá → verify lại chạy đúng đầu-cuối với API thật.

## [0.1.2] - 2026-08-06 — Sửa reset rule + MODE=race bỏ hẳn PRICE MIN

2 fix liên quan trong logic tính giá `src/pick.ts`, phát sinh khi người dùng đi qua 3 case biên cho
MODE=`top` và, trong lúc trao đổi, xác nhận luôn 1 bug thật ở cách MODE=`race` xử lý `PRICE MIN`.

### Fixed

- **Reset rule MODE=`top` vẫn có thể set giá về đúng `PRICE MIN`.** Reset rule trước đó so **giá gốc**
  candidate với `PRICE MIN` để quyết định bỏ qua, rồi — ngay cả với candidate đã qua được vòng lọc đó —
  vẫn clamp giá cuối lên đúng `PRICE MIN` nếu trừ `Price step` hụt xuống dưới sàn. Điều này mâu thuẫn
  với chính quy tắc dự án đã tuyên bố: `PRICE MIN` KHÔNG BAO GIỜ được dùng làm giá thật. Sửa bằng cách
  đổi điều kiện lọc thành `candidate.price - Price step < PRICE MIN` (kiểm tra TRƯỚC khi chọn candidate,
  không phải sau), nhờ vậy candidate được chọn LUÔN đảm bảo giá tính ra đã vượt sàn — không cần clamp
  lần 2 nữa. Nếu mọi candidate đều trượt test chặt hơn này → bỏ qua dòng (giữ nguyên giá) thay vì bị ép
  về `PRICE MIN`.
- **MODE=`race` cũng âm thầm clamp về `PRICE MIN`, mâu thuẫn với chính docs của nó.** MODE=`top` và
  MODE=`race` dùng chung 1 helper `finalize()` luôn áp clamp `PRICE MIN` khi có set. Nghĩa là `race` —
  dù ARCHITECTURE.md đã ghi rõ "bám đúng Seller kể cả khi lỗ" — trên thực tế KHÔNG BAO GIỜ được đặt giá
  thấp hơn `PRICE MIN`. Đã xác nhận rõ với người dùng ("không quan tâm price min, cứ dí thằng đối thủ")
  đây là bug, không phải hành vi mong muốn. Sửa bằng cách thay `finalize()` bằng helper `priced()` mới
  không biết gì về `PRICE MIN`; `race` giờ luôn tính `giá đối thủ - Price step` không qua bất kỳ logic
  sàn nào, khớp đúng docs lần đầu tiên.

### Xác nhận ĐÃ đúng sẵn (không cần sửa code)

2 case biên người dùng yêu cầu "bổ sung" hóa ra đã được thuật toán hiện tại thỏa mãn tự nhiên, sau khi
lần theo kỹ — ghi chú rõ trong comment `pick.ts` và cả 2 file `ARCHITECTURE.md` để sau này không ai
nhầm là còn thiếu:

- **Mình là seller duy nhất bán 1 biến thể** (pool rỗng sau loại self + blacklist) → giữ nguyên giá.
  Đã có sẵn ở nhánh `sorted.length === 0`.
- **Mình đã đang là seller tốt nhất** → `sorted[0]` của vòng quét reset rule (pool luôn loại chính
  mình) đồng thời vừa là "seller cần vượt qua" khi mình chưa tốt nhất, vừa là "người xếp sau mình" khi
  mình đã tốt nhất — nên CÙNG 1 công thức `competitor.price - Price step` vừa giữ vị trí top vừa tăng
  giá lên gần người xếp sau để thu về biên lợi nhuận, không cần kiểm tra "mình có đang top 1 không" ở
  đâu cả.

### Đã verify

- `bunx tsc --noEmit` — không phát sinh lỗi type mới (lỗi `HeadersInit` có sẵn trong `core/http.ts` là
  lỗi cũ, không liên quan tới thay đổi này).
- `bun run dev-test` với tab Setup thật — cả 4 dòng thật ra đúng giá như trước khi sửa (không dòng nào
  hiện tại đủ sát `PRICE MIN` để chạm vào điều kiện lọc chặt hơn), xác nhận không regression ở case
  thường.
- 1 script throwaway gọi trực tiếp `pickCompetitor()` với `Offer[]` dựng tay (viết, chạy, xoá — không
  commit) cover 5 case: MODE=top "giữ nguyên" (1 candidate duy nhất trượt test mới), MODE=top "vẫn tìm
  được candidate hợp lệ kế tiếp" (candidate đầu bị skip, candidate 2 được chọn, không bị clamp),
  MODE=race có `PRICE MIN` nhưng đối thủ giá dưới sàn (giá bám đúng đối thủ, không bị clamp lên), cùng
  2 case "đã đúng sẵn" ở trên (pool rỗng, đã top1) làm regression check.

## [0.1.1] - 2026-08-05 — Nối đọc Google Sheets

Phần ĐỌC của tích hợp Google Sheets, port từ `core/sheets.ts` bản `x-raceprce-g2g-zerogap` và nối vào
`dev-test.ts` (trước đó chạy với 3 dòng mẫu hard-code).

### Added

- **`src/core/sheets.ts`** — `getSheetsClient()` (auth bằng service account qua `credentials.json` +
  `googleapis`) và `readSetupRows(sheetName)`, đọc tab "Setup" và map tên cột → field `SetupRowRaw`
  qua `COLUMN_ALIASES` (chỉnh lại từ bản G2G cho đúng cột Gamsgo: thêm `SORT` và `LINK IMAGE`, bỏ
  `Seller Level` vì `target.ts` bản Gamsgo không có field này). Kiểm tra `credentials.json` tồn tại
  trước khi gọi `GoogleAuth`, ném lỗi rõ ràng trỏ tới README thay vì để lộ `ENOENT` khó hiểu từ bên
  trong `googleapis`. **Chủ động không port** `appendEditHistory()` — chưa có endpoint sửa giá thật nên
  chưa có gì để ghi vào tab "Edit History" (port lúc này sẽ thành dead code).
- **`src/util/config.ts`** — `loadConfig()` đọc `SHEET_SETUP` từ `.env` (mặc định `"Setup"`).
  `SPREADSHEET_ID`/`GOOGLE_SPREADSHEET_ID` cố tình để trong `sheets.ts` thay vì `AppConfig`, đúng quy
  ước bản G2G (hằng số đó gắn liền với client Sheets).
- **`.env.example`** (`SPREADSHEET_ID`, `SHEET_SETUP`) và **`.gitignore`** (`.env`, `credentials.json`,
  `node_modules`, …) — dự án trước đó chưa có 2 file này.
- Thêm dependency: `googleapis@110.0.0`, `dotenv@^17.2.0` (đúng version bản G2G đang dùng).
- README: thêm mục "Cài đặt Google Sheets" — các bước setup service account làm 1 lần (bật API, tạo
  service account, tải JSON key thành `credentials.json`, share sheet cho `client_email` của service
  account, điền `SPREADSHEET_ID` vào `.env`).

### Changed

- **`src/dev-test.ts`** giờ gọi `readSetupRows()` thay vì lặp qua mảng `SAMPLE_ROWS` hard-code; thoát
  sớm kèm thông báo rõ ràng nếu thiếu `SPREADSHEET_ID` trong `.env`.
- **Hướng import của `SetupRowRaw` bị đảo so với dự án G2G.** Ở G2G, `sheets.ts` định nghĩa type rồi
  `target.ts` import lại. Ở đây `target.ts` đã định nghĩa `SetupRowRaw` từ trước (viết trước khi có
  `sheets.ts`), nên `sheets.ts` import type từ `./target` — ghi chú rõ trong comment đầu file ở cả 2
  file để tránh nhầm lẫn khi đối chiếu với codebase G2G.

### Đã verify

- `bunx tsc --noEmit` không phát sinh lỗi type mới từ các file đã thêm/sửa (lỗi `HeadersInit` có sẵn
  trong `core/http.ts` là lỗi cũ, không liên quan tới thay đổi này).
- `bun run dev-test` thoát kèm lỗi rõ ràng, có hướng xử lý ở cả 2 nhánh lỗi đã test: thiếu
  `SPREADSHEET_ID` trong `.env`, và thiếu file `credentials.json` trên đĩa.

## [0.1.0] - 2026-08-05 — Phase 1: crawl giá đối thủ + tính giá mới

Bản build đầu tiên của dự án, tách ý tưởng từ
[`x-raceprce-g2g-zerogap`](../../../x-raceprce-g2g-zerogap) (giữ đúng hình dạng MODE top/race +
reset-rule) nhưng nhắm vào API REST của GamsGo. Phạm vi: **chỉ crawl + tính giá** — chưa sửa giá thật,
chưa nối Google Sheets, chưa có Dashboard/Telegram/`state.json` (chủ động để lại cho Phase 2).

### Added

- **`src/core/http.ts`** — `requestJson()`: retry + timeout + header giả Chrome dùng chung cho
  `mapi.gamsgo2.com`, chuyển từ `core/http.ts` bản G2G, bỏ phần `onUnauthorized`/401-refresh (Phase 1
  chỉ gọi endpoint ẩn danh). Xoay proxy để trống tạm (`getProxyList()` trả `[]`) — chưa nối
  `proxys/proxy.txt`.
- **`src/core/category.ts`** — `resolveTypeCategoryId(linkCrawl)`: resolve 2 segment cuối URL của
  `LINK CRAWL` (`user_route`/`list_route`) thành UUID `type_category_id` qua `POST
  /index/typeCategory`, khớp theo cả 2 field (không bao giờ lấy mù `data[0]` — endpoint có thể trả
  nhiều entry liên quan cho 1 query). Kết quả cache trong bộ nhớ theo đúng chuỗi `LINK CRAWL`, không
  hết hạn.
- **`src/core/gamsgo.ts`** — `fetchOffers(typeCategoryId, typePlanImage)`: gọi `POST /index/planList`,
  tìm biến thể khớp `LINK IMAGE` (`type_plan_image`), trả `Offer[]` đã chuẩn hóa, giữ nguyên thứ tự từ
  `list[]` lồng trong biến thể đó (pool đối thủ thật).
- **`src/core/target.ts`** — `SetupRowRaw`, `RaceTarget`, `parseTarget()`: parse dòng Setup thành field
  có kiểu (`ownTypePlanId` từ `LINK EDIT` qua trích chặt `/shop/<id>`, số chấp nhận dấu phẩy VN,
  `isRowEnabled`), mirror quy ước `target.ts` bản G2G.
- **`src/pick.ts`** — `pickCompetitor()`: chọn đối thủ theo MODE `top`/`race` + reset rule kiểu G2G cho
  MODE=top (xem "Changed" dưới) + tính giá cuối có sàn `PRICE MIN`.
- **`src/dev-test.ts`** — script chạy tay với 3 dòng Setup thật hard-code (Honkai Star Rail x2, Zenless
  Zone Zero), in ra pool đã crawl + giá tính được cho từng dòng.
- Docs song ngữ (`README.md`, `docs/en/`, `docs/vi/`) mô tả kiến trúc, pipeline crawl 2 bước
  `typeCategory` → `planList`, và quy tắc tính giá.

### Changed (so với thiết kế giả định ban đầu)

- **Thêm "reset rule" kiểu G2G cho MODE=`top`** (cả `SORT=price` và `SORT=recommend`), sau khi bản
  thiết kế đầu tiên đã lên MODE=top với `PRICE MIN` chỉ là sàn thuần. Đã verify bằng dữ liệu thật: 1
  dòng thật có `PRICE MIN=357.85`, candidate rẻ nhất (298) bị bỏ qua đúng như mong đợi, tool bám
  candidate kế tiếp ở giá 359.
- **Chủ động khác G2G ở phần fallback của reset rule**: khi reset rule quét hết mọi candidate mà không
  ai đạt `PRICE MIN`, bản này bỏ qua dòng (không đổi giá) thay vì fallback về `PRICE MIN` như bản G2G.
  Đã xác nhận rõ với người dùng — giữ nhất quán với quyết định ở case "không có đối thủ nào" nói chung.
- **Đổi cách resolve category-ID từ parse HTML/Nuxt-payload sang API riêng.** Khảo sát ban đầu tìm thấy
  `type_category_id` nhúng trong payload SSR Nuxt 3 của trang category (`<script
  id="__NUXT_DATA__">`, 1 JSON array phẳng dùng index số nguyên để tham chiếu) và đã dựng 1 bản resolver
  chạy được theo cách đó. Bị thay HOÀN TOÀN khi tìm ra `POST /index/typeCategory` — cùng kết quả, nhẹ
  hơn nhiều (không cần tải HTML ~1MB) và dễ suy luận hơn.

### Fixed

- **`planList` âm thầm trả giá theo VND thay vì USD.** Phát hiện khi chạy `dev-test.ts` với dữ liệu
  thật: thiếu `show_currency: "USD"` trong body, `total_price` trả về là số VND lớn (vd `9422572`)
  không có lỗi hay tín hiệu gì báo có gì bất thường — mọi field khác vẫn trông bình thường. Nguyên
  nhân gốc: server không tự suy currency từ request ẩn danh; trên browser thật, currency đã chọn được
  lưu trong cookie và frontend tự điền vào field `show_currency` ở MỌI request. Fix bằng cách luôn gửi
  `show_currency: 'USD'` trong `fetchOffers()`. Việc này cũng đính chính 1 nhận định SAI đã ghi vào note
  dự án trước đó rằng xử lý currency "hoàn toàn client-side, không cần gọi lại" — điều đó chỉ đúng khi
  đổi giữa các currency ĐÃ fetch trong 1 session browser, không đúng cho 1 lệnh gọi API ẩn danh MỚI mà
  không chỉ định currency gì cả.

### Đã verify bằng dữ liệu sản xuất thật

- `LINK IMAGE` (`type_plan_image`) xác nhận giống nhau ở mọi merchant bán cùng 1 biến thể (4 merchant
  khác nhau, cùng 1 URL ảnh, cho "800 Robux").
- UUID của `LINK EDIT` xác nhận khớp 1 `type_plan_id` **nằm trong** `list[]` của biến thể — và ở 1 dòng
  thật, cụ thể là phần tử **thứ 2**, không phải `list[0]` — loại bỏ hẳn khả năng đi tắt giả định "offer
  của mình luôn ở vị trí đầu".
- `data[]` của `typeCategory` xác nhận trả nhiều entry liên quan cho 1 query `list_route` (khác
  `user_route`), xác nhận đúng quyết định khớp theo cả 2 field.

### Việc còn hở (theo dõi cho Phase 2 — xem mục "Việc còn hở" trong `docs/vi/ARCHITECTURE.md`)

- Chưa tìm ra endpoint sửa giá (tương đương `PUT /offer/{id}?v=v2` của G2G).
- Chưa đọc/ghi Google Sheets, chưa có Dashboard, chưa có `state.json`, chưa có Telegram noti.
- Chưa có quy tắc tie-break cho `MODE=race` khi có nhiều `Seller` được liệt kê (lùi lại — chưa có dòng
  thật nào cần).
- Chưa xác minh `typeCategory` có chạy được hoàn toàn không token (chỉ `planList` được test riêng ẩn
  danh).
