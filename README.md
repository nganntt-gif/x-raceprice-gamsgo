# x-raceprice-gamsgo

Tool **bám giá đối thủ (race-price / auto-repricer)** cho một tài khoản người bán
[GamsGo.com](https://www.gamsgo.com). Tool đọc tab **`Setup`** trong Google Sheets, và với mỗi dòng
được bật (`CHECK=1`) sẽ **dò giá đối thủ** mỗi `POLL_INTERVAL_SECONDS` giây, tính giá **thấp hơn đối thủ
đúng 1 bước** (`Price step`), rồi tự **sửa giá** listing của mình. Mỗi lần đổi giá ghi 1 dòng vào tab
**`Edit History`** (giờ UTC+7) và bắn 1 tin Telegram.

Mục tiêu: **luôn bám sát đối thủ mục tiêu, giữ giá thấp hơn 1 bước** ("zero gap") — cùng ý tưởng với dự
án chị em [`x-raceprce-g2g-zerogap`](../x-raceprce-g2g-zerogap), khác nền tảng nên API khác hẳn.

| Việc | Endpoint API |
|---|---|
| Resolve category từ LINK CRAWL | `POST https://mapi.gamsgo2.com/index/typeCategory` |
| Dò giá đối thủ (ẩn danh) | `POST https://mapi.gamsgo2.com/index/planList` |
| Sửa giá listing của mình | `POST https://mapi.gamsgo2.com/product/editPlanInfo` |

**100% REST API** — dò giá + sửa giá đều qua API, **không mở trình duyệt** khi chạy (không
Playwright/Patchright/Puppeteer). Chỉ cần trình duyệt **1 lần** để export file cookies đăng nhập ban
đầu; tool tự dùng file đó cho mọi request sửa giá, không tự đăng nhập lại. Runtime:
**[Bun](https://bun.sh)**.

> 📚 Tài liệu chi tiết (song ngữ): **[docs/vi/](docs/vi/)** (tiếng Việt) · **[docs/en/](docs/en/)**
> (English, bản chuẩn cho AI).

---

## 1. Tab `Setup` — cấu hình mỗi dòng

Mỗi dòng là 1 listing cần bám giá. Cột (header ở dòng 1):

| Cột | Ý nghĩa |
|---|---|
| `CHECK` | `1`/`true`/`yes`/`on`/`x` = bám giá dòng này, còn lại = bỏ qua |
| `MODE` | `top` (hoặc `1`) = bám merchant **tốt nhất toàn sàn** (theo `SORT`); `race` (hoặc `0`) = bám đúng merchant ở cột `Seller`. Trống → suy từ `Seller` (có → race, không → top) |
| `SORT` | `price` = bám giá **nhỏ nhất**; `recommend` = bám `sort_lcb_score` **lớn nhất**. Chỉ có ý nghĩa khi `MODE=top`; trống/sai → `price` |
| `GAME` / `SERVICE` / `NAME` | Chỉ hiển thị + ghi log, không dùng cho tham số API |
| `LINK CRAWL` | URL trang category GamsGo, dạng `https://www.gamsgo.com/<user_route>/<list_route>` → resolve ra `type_category_id` |
| `LINK IMAGE` | URL ảnh minh họa của ĐÚNG gói cần bám giá (`type_plan_image`) — **bắt buộc**, vì 1 `LINK CRAWL` có thể chứa nhiều gói |
| `LINK EDIT` | URL trang shop của CHÍNH MÌNH, dạng `https://www.gamsgo.com/shop/<id>` → lấy `type_plan_id` để loại offer của mình khỏi pool đối thủ |
| `Seller` | `merchant_id` đối thủ cần bám khi `MODE=race` — 1 hoặc nhiều (cách nhau dấu phẩy/chấm phẩy/xuống dòng). Trống + `MODE` ghi rõ `race`/`0` → mặc định 1 merchant cấu hình sẵn |
| `Price step` | Mức hạ so với đối thủ; số thập phân của giá trị này quyết định độ chính xác làm tròn giá mới |
| `PRICE MIN` | Sàn giá + ngưỡng reset rule (mục 3). Trống = không sàn |
| `SELLER_BLACK LIST` | `merchant_id` luôn loại khỏi pool đối thủ — nhiều giá trị (cách nhau dấu phẩy/chấm phẩy/xuống dòng) |

> Số chấp nhận dấu phẩy thập phân kiểu VN (`0,01` = `0.01`).

Tab **`Edit History`** (tự tạo nếu chưa có) ghi mỗi lần đổi giá: `Game · Service · Name · Price Before ·
Price After · Top Seller Follow (tên merchant đang bám) · Note (lý do chọn giá) · Time (UTC+7)`.

---

## 2. Luồng chạy mỗi chu kỳ (daemon `main.ts`, mỗi `POLL_INTERVAL_SECONDS` giây)

1. **Đọc tab `Setup`** (có cache, chỉ đọc lại Sheets mỗi `SETUP_CACHE_SECONDS` — mặc định 5 phút) →
   parse các dòng bật.
2. **Với mỗi dòng**: resolve `LINK CRAWL` → `type_category_id` → dò `planList` (**ẩn danh, không
   cookie**) → khớp đúng biến thể theo `LINK IMAGE` → chọn đối thủ theo `MODE`/`SORT` → tính giá mới →
   nếu khác giá hiện tại thì gọi `editPlanInfo` (có xác thực bằng token đọc từ file cookies) → ghi
   `Edit History` + bắn Telegram.
3. **Token hết hạn** (GamsGo trả 401/403) → daemon dừng hẳn, cần export lại file cookies rồi khởi động
   lại.

---

## 3. Quy tắc tính giá

| MODE | SORT | Đối thủ = |
|---|---|---|
| `top` | `price` | merchant giá **nhỏ nhất** trong pool (sau khi loại chính mình + blacklist) |
| `top` | `recommend` | merchant có **score** (`sort_lcb_score`) **lớn nhất** trong pool |
| `race` | *(bỏ qua)* | merchant khớp cột `Seller` |

**Reset rule** (chỉ áp cho `MODE=top`): nếu candidate đang xét có `giá − Price step` dưới `PRICE MIN`,
bỏ qua, xét candidate kế tiếp — lấy candidate **đầu tiên vượt qua test này**. Quét hết không ai đạt ⇒
giữ nguyên giá hiện tại, không đổi.

```
giá mới = round(đối thủ.price − Price step, số_thập_phân_của_Price_step)
```

`MODE=race` không áp `PRICE MIN` dưới bất kỳ hình thức nào — luôn bám đúng seller ở cột `Seller`, kể cả
khi giá đó thấp hơn `PRICE MIN`. Không tìm thấy seller nào trong `Seller` còn bán ⇒ bỏ qua, không đổi
giá.

---

## 4. Cấu trúc thư mục

```
x-raceprice-gamsgo/
├─ src/
│  ├─ main.ts                # Daemon: loop → runCycle → processTarget
│  ├─ dev-test.ts             # Script chạy tay, read-only (crawl + tính giá, không sửa)
│  ├─ dev-apply.ts            # Script chạy tay, sửa giá 1 dòng (cần --yes)
│  ├─ pick.ts                 # pickCompetitor() — chọn đối thủ + tính giá, hàm thuần
│  ├─ core/
│  │  ├─ http.ts              # requestJson() — retry + timeout
│  │  ├─ category.ts          # resolveTypeCategoryId (LINK CRAWL → type_category_id)
│  │  ├─ gamsgo.ts             # fetchOffers (ẩn danh) + editPlanInfo (có token)
│  │  ├─ auth.ts               # getAuthToken — đọc token từ file cookies
│  │  ├─ target.ts             # parse 1 dòng Setup → RaceTarget
│  │  └─ sheets.ts             # readSetupRows + appendEditHistory
│  └─ util/
│     ├─ config.ts             # đọc .env
│     ├─ dashboard.ts          # render trạng thái từng dòng (log-update + chalk)
│     ├─ state.ts              # lưu/đọc state.json (editCount theo type_plan_id)
│     ├─ noti.ts               # bắn Telegram qua noti gateway sau khi sửa giá
│     └─ time.ts               # nowUtc7()
├─ docs/
│  ├─ vi/                     # tài liệu tiếng Việt (ARCHITECTURE.md, changelog.md)
│  └─ en/                     # English docs (bản chuẩn cho AI)
├─ cookies/                   # (không commit) file cookies export từ browser
├─ .env                       # (không commit) cấu hình runtime
├─ credentials.json           # (không commit) Service Account Google Sheets
└─ package.json
```

---

## 5. Cấu hình `.env`

```dotenv
SPREADSHEET_ID=your_spreadsheet_id
SHEET_SETUP=Setup
SHEET_EDIT_HISTORY=Edit History

COOKIES_FILE=cookies/gamsgo_go1.json

POLL_INTERVAL_SECONDS=20
SETUP_CACHE_SECONDS=300

# Telegram (tùy chọn) — bắn tin sau mỗi lần sửa giá. Để trống = tắt.
NOTI_API_KEY=
NOTI_CHANNEL=
```

Ngoài ra cần:
- **`credentials.json`** — Google Service Account có quyền *Viewer* trở lên trên Spreadsheet đích.
- **`cookies/gamsgo_go1.json`** — file cookies (Playwright storageState) chứa cookie `token` (đường dẫn
  theo `COOKIES_FILE`). Token không tự refresh — hết hạn thì đăng nhập lại trên browser và export lại
  file này.

---

## 6. Cài đặt & chạy

Yêu cầu **[Bun](https://bun.sh) ≥ 1.3**.

```bash
bun install
# tạo .env + credentials.json + cookies/gamsgo_go1.json (mục 5)

bun run dev-test              # read-only: crawl + tính giá, in ra để đối chiếu
bun run dev-apply <rowIndex>  # dry-run 1 dòng; thêm --yes để sửa giá thật

bun run start                 # daemon: bun run src/main.ts
bun run dev                   # daemon, watch mode
bun run build:exe             # → output/x-raceprice-gamsgo.exe
bun run build:linux           # → linux/x-raceprice-gamsgo
```

Chạy nền bằng PM2:

```bash
pm2 start "bun run start" --name x-raceprice-gamsgo
pm2 logs x-raceprice-gamsgo
```
