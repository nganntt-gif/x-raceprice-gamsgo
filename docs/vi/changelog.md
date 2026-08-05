# Changelog

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
