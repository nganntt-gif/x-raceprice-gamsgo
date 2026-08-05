# x-raceprice-gamsgo

Tool **race-price (auto-repricer)** cho seller trên **GamsGo.com** — cùng ý tưởng "zero gap" với dự án
chị em [`x-raceprce-g2g-zerogap`](../x-raceprce-g2g-zerogap): đọc tab `Setup` trong Google Sheet, với
mỗi dòng bật (`CHECK=1`) thì dò giá đối thủ trên GamsGo và tính ra giá mới **thấp hơn đối thủ 1
`Price step`**.

> ⚠️ **Trạng thái hiện tại: Phase 1** (crawl giá đối thủ + tính giá mới, đã đọc tab Setup thật từ Google
> Sheets). **CHƯA** có phần sửa giá thật (PUT), CHƯA ghi tab "Edit History", CHƯA có
> Dashboard/Telegram/state.json — những phần đó để Phase 2 (xem [docs/en/changelog.md](docs/en/changelog.md)
> mục "Chưa làm").

## Vì sao tách riêng, không dùng chung code với bản G2G?

Cùng **ý tưởng thuật toán** (MODE top/race, reset rule PRICE MIN) nhưng **API/nền tảng khác hẳn** G2G —
GamsGo không có 1 endpoint "search offer theo category" duy nhất như G2G; phải qua 2 bước
(`typeCategory` → `planList`) và định danh sản phẩm bằng ảnh (`LINK IMAGE`) vì không có link riêng cho
từng gói. Xem chi tiết kỹ thuật ở [docs/en/ARCHITECTURE.md](docs/en/ARCHITECTURE.md).

## Sheet "Setup"

Cột: `CHECK`, `MODE` (`top`/`race`), `SORT` (`price`/`recommend` — chỉ áp dụng khi `MODE=top`), `GAME`,
`SERVICE`, `NAME`, `LINK CRAWL`, `LINK IMAGE`, `LINK EDIT`, `Seller`, `Price step`, `PRICE MIN`,
`SELLER_BLACK LIST`.

| Cột | Ý nghĩa |
|---|---|
| `LINK CRAWL` | URL trang category GamsGo, dạng `https://www.gamsgo.com/<user_route>/<list_route>` (vd `.../top-up/honkai-star-rail`) |
| `LINK IMAGE` | URL ảnh minh họa của ĐÚNG gói cần bám giá (lấy từ field `type_plan_image` trên trang) — **bắt buộc**, vì 1 `LINK CRAWL` có thể chứa nhiều gói |
| `LINK EDIT` | URL trang shop offer của CHÍNH MÌNH, dạng `https://www.gamsgo.com/shop/<id>` — dùng để loại offer của mình khỏi pool đối thủ |
| `Seller` | `merchant_id` đối thủ cần bám khi `MODE=race` |
| `SELLER_BLACK LIST` | `merchant_id` luôn loại khỏi pool đối thủ |
| `Price step` | mức undercut; số thập phân của giá trị này cũng quyết định độ chính xác làm tròn giá mới |
| `PRICE MIN` | sàn giá — xem quy tắc bên dưới |

## Logic tính giá mới (đã chốt)

| MODE | SORT | Đối thủ = |
|---|---|---|
| `top` | `price` | merchant giá **nhỏ nhất** trong pool (sau khi loại chính mình + blacklist) |
| `top` | `recommend` | merchant có **score** (`sort_lcb_score`) **lớn nhất** trong pool |
| `race` | *(bỏ qua)* | merchant khớp cột `Seller` |

**Reset rule** (chỉ áp cho `MODE=top`, cả 2 kiểu `SORT`, giống G2G): nếu candidate đang xét có giá
**dưới** `PRICE MIN`, bỏ qua, xét candidate kế tiếp — lấy candidate **đầu tiên có giá >= `PRICE MIN`**
làm đối thủ. Quét hết mà không ai đạt sàn ⇒ **bỏ qua dòng, không đổi giá** (khác G2G — G2G fallback về
`PRICE MIN`, bản này không).

```
giá mới = round(đối thủ.price − Price step, số_thập_phân_của_Price_step)
giá mới = giá mới < PRICE MIN ? PRICE MIN : giá mới    # sàn clamp lần 2
```

`MODE=race` không áp reset rule — bám đúng seller ở cột `Seller`, kể cả khi seller đó đang phá giá dưới
sàn. Không tìm thấy seller nào trong `Seller` còn bán ⇒ bỏ qua, không đổi giá.

## Cài đặt Google Sheets

`dev-test.ts` đọc tab **Setup** thật qua Google Sheets API (service account, không OAuth người dùng).
Cần làm 1 lần:

1. Vào [Google Cloud Console](https://console.cloud.google.com/) → tạo (hoặc chọn) 1 project → bật
   **Google Sheets API** (APIs & Services → Library).
2. Tạo **Service Account** (APIs & Services → Credentials → Create Credentials → Service Account) →
   vào tab **Keys** của service account đó → **Add Key** → **JSON** → tải file key về.
3. Đổi tên file vừa tải thành `credentials.json`, đặt ở **thư mục gốc** dự án (cùng cấp `package.json`).
   File này **không commit** (đã có trong `.gitignore`).
4. Mở Google Sheet cần đọc → **Share** → thêm địa chỉ email của service account (field `client_email`
   trong `credentials.json`, dạng `...@...iam.gserviceaccount.com`) với quyền **Viewer** trở lên.
5. Copy `.env.example` thành `.env`, điền `SPREADSHEET_ID` (đoạn giữa `/d/` và `/edit` trong URL sheet).
   Đổi `SHEET_SETUP` nếu tab Setup không tên là "Setup".

## Cài đặt & chạy

Yêu cầu **Bun ≥ 1.3**.

```bash
bun install
cp .env.example .env   # rồi điền SPREADSHEET_ID (xem mục "Cài đặt Google Sheets" ở trên)
bun run dev-test        # = bun run src/dev-test.ts
```

`dev-test.ts` đọc tab **Setup** thật từ Google Sheets (qua `core/sheets.ts`) — in ra pool đối thủ đã
crawl + giá mới tính được cho từng dòng bật `CHECK=1`, để kiểm tra bằng mắt trước khi nối daemon polling
thật (Phase 2). Ghi log lại tab "Edit History" **chưa** làm — chưa có gì để ghi vì chưa tìm ra endpoint
sửa giá thật (xem mục "Việc còn hở" trong ARCHITECTURE).

## Ghi chú kỹ thuật quan trọng (đọc thêm ở ARCHITECTURE)

- **`show_currency: "USD"` là BẮT BUỘC** trong body gọi `planList` — thiếu field này, giá trả về âm
  thầm đổi sang VND mà không có lỗi gì báo. Đã tốn 1 vòng debug để phát hiện — xem
  [docs/en/changelog.md](docs/en/changelog.md).
- Crawl giá (`typeCategory` + `planList`) là **ẨN DANH**, không cookie/token — giống nguyên tắc "dò giá
  không gắn tài khoản" của bản G2G.
- `type_category_id` được **cache theo `LINK CRAWL`** trong runtime (không hết hạn ở Phase 1) — chỉ
  gọi `typeCategory` 1 lần cho mỗi `LINK CRAWL` khác nhau.

## Tài liệu

- [docs/en/ARCHITECTURE.md](docs/en/ARCHITECTURE.md) — kiến trúc kỹ thuật đầy đủ (tiếng Anh, canonical).
- [docs/vi/ARCHITECTURE.md](docs/vi/ARCHITECTURE.md) — bản dịch tiếng Việt.
- [docs/en/changelog.md](docs/en/changelog.md) / [docs/vi/changelog.md](docs/vi/changelog.md) — lịch sử thay đổi.
