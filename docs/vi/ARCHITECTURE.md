# Kiến trúc — x-raceprice-gamsgo

> Trạng thái: **Phase 1** (crawl giá đối thủ + tính giá mới; tab Setup đã đọc THẬT qua Google Sheets
> API). Phase 2 (PUT giá thật, ghi tab "Edit History", Dashboard, Telegram, `state.json`) chưa làm.

## Đây là gì

Tool race-price (auto-repricer) cho seller trên **GamsGo.com** — cùng ý tưởng lõi với dự án chị em
[`x-raceprce-g2g-zerogap`](../../../x-raceprce-g2g-zerogap) (poll tab `Setup`, bám 1 đối thủ, giảm giá
1 `Price step`), nhưng khác nền tảng nên API khác hẳn về hình dạng. Tài liệu này mô tả đúng những gì
ĐÃ code và ĐÃ verify với API thật của GamsGo (mọi endpoint dưới đây đều đã gọi curl thật khi phát
triển, không đoán từ docs).

## Vì sao GamsGo cần pipeline crawl khác G2G

G2G chỉ cần 1 lệnh `GET /offer/search?seo_term=...` vừa định danh sản phẩm (slug lấy trực tiếp từ URL
crawl) vừa trả luôn pool đối thủ. GamsGo không có cả 2:

1. URL crawl (`LINK CRAWL`, vd `https://www.gamsgo.com/top-up/honkai-star-rail`) chỉ chứa slug người
   đọc được, không phải UUID (`type_category_id`) mà API lấy giá thật sự cần.
2. 1 trang category chứa **nhiều biến thể sản phẩm khác nhau** (vd "800 Robux", "1000 Robux", hoặc như
   thấy ở dữ liệu Setup thật — 2 `NAME` khác nhau dùng CHUNG 1 `LINK CRAWL`), và không có link crawl
   riêng cho từng sản phẩm để phân biệt.

Nên pipeline là 2 lệnh API + 1 bước match ở client, không phải 1 lệnh duy nhất:

```
LINK CRAWL  ──resolveTypeCategoryId()──▶  type_category_id  ──fetchOffers()──▶  Offer[] (pool đối thủ)
                (POST /index/typeCategory)      │
                                                 └── match với LINK IMAGE trong data.list[] của planList
```

## Endpoint (host `mapi.gamsgo2.com`, gọi HOÀN TOÀN ẨN DANH — không cookie/token)

| Method | URL | Mục đích |
|---|---|---|
| POST | `/index/typeCategory` | resolve slug từ URL crawl → `type_category_id` (UUID) |
| POST | `/index/planList` | pool đối thủ cho 1 `type_category_id` (nhóm theo biến thể sản phẩm) |

Cả 2 đã xác nhận chạy được với `token: undefined` trong request — cùng nguyên tắc "dò giá không gắn
tài khoản" của `fetchOffers` bản G2G (polling không nên buộc vào tài khoản đăng nhập).

### 1) `LINK CRAWL` → `type_category_id`: `POST /index/typeCategory`

`LINK CRAWL` luôn có dạng `https://www.gamsgo.com/<user_route>/<list_route>` (2 segment cuối path — đã
xác nhận bằng dữ liệu thật). Body request:

```json
{ "language": "en", "show_currency": "USD", "list_route": "<list_route>" }
```

Response `data[]` có thể trả **nhiều entry liên quan** — vd query `list_route: "honkai-star-rail"`
cũng trả kèm entry `"honkai-star-rail-accounts"` (category khác: "Game Accounts" thay vì "Top Ups").
Vì vậy code (`core/category.ts`) match theo **CẢ HAI** `entry.list_route === list_route` **VÀ**
`entry.user_route === '/' + user_route` — không bao giờ lấy mù `data[0]`. Không khớp ⇒ ném lỗi kèm
danh sách `user_route`/`list_route` API thực trả về, để debug LINK CRAWL sai dễ dàng chỉ từ thông báo
lỗi.

Vì UUID của category gần như không bao giờ đổi, kết quả được **cache trong bộ nhớ theo đúng chuỗi
`LINK CRAWL`**, không hết hạn ở Phase 1 — không gọi lại API này mỗi chu kỳ poll cho cùng 1 LINK CRAWL.

*(Ghi chú: 1 bản thiết kế trước đó resolve `type_category_id` bằng cách tải trang HTML category
(~1MB) rồi parse payload SSR Nuxt 3 (`__NUXT_DATA__`, định dạng array phẳng dùng index tham chiếu).
Cách đó CHẠY ĐƯỢC nhưng nặng và dễ vỡ — bị thay hoàn toàn bởi `typeCategory` ngay khi tìm ra. Ghi lại
ở đây để không ai đi lại đường parse HTML này.)*

### 2) `type_category_id` → pool đối thủ: `POST /index/planList`

Body request:

```json
{ "language": "en", "show_currency": "USD", "type_category_id": "<uuid>" }
```

**`show_currency` KHÔNG phải optional.** Phát hiện qua 1 lần debug thật: thiếu field này KHÔNG báo
lỗi gì — chỉ âm thầm trả `total_price` theo **VND** (vd `9422572`) thay vì USD (`359.00`), không có
tín hiệu nào trong response báo có gì khác thường. `core/gamsgo.ts::fetchOffers()` luôn gửi
`show_currency: 'USD'` vì đúng lý do này. Điều này khớp với điều người dùng quan sát trên web thật —
currency đã chọn được lưu trong cookie, và frontend đọc cookie đó rồi điền vào field này ở MỌI
request; đây **KHÔNG** phải giá trị server tự suy ra từ cookie, và cũng **KHÔNG** hoàn toàn là quy đổi
hiển thị thuần client-side như nhận định ban đầu lúc dò API (1 ghi chú trước đó trong lịch sử dự án
nói "đổi currency là client-side, không cần gọi lại" — điều đó ĐÚNG cho việc *đổi giữa các currency đã
fetch trên UI trình duyệt*, nhưng 1 **request ẩn danh mới hoàn toàn không có `show_currency`** thì
KHÔNG tự mặc định về USD).

Hình dạng response:

```
data.list[]                         # mỗi phần tử = 1 BIẾN THỂ SẢN PHẨM trong category
  type_plan_id, type_plan_image, total_price, merchant_id, merchant_name, sort_lcb_score, ...
  list[]                            # TOÀN BỘ pool đối thủ cho ĐÚNG biến thể này — mỗi phần tử là 1
                                     #   listing riêng của 1 merchant, có type_plan_id RIÊNG (không
                                     #   phải cùng type_plan_id với phần tử biến thể ngoài)
```

Phần tử biến thể ở ngoài chỉ là bản sao field của `list[0]` (lựa chọn "đại diện" của chính API) — tool
không bao giờ đọc giá/merchant từ tầng ngoài, chỉ đọc từ trong `list[]`.

### 3) `LINK IMAGE` → chọn đúng biến thể

Đã xác nhận bằng dữ liệu thật: `type_plan_image` giống nhau ở mọi merchant bán cùng 1 biến thể (kiểm
chứng với 4 merchant khác nhau đều dùng chung 1 URL ảnh cho "800 Robux") — nên đây là khóa định danh
đáng tin cậy cho "dòng Setup này ứng với biến thể nào". Đây cũng là lý do sheet Setup có thêm cột
`LINK IMAGE` (khác G2G — GamsGo không có link crawl riêng cho từng sản phẩm). `core/gamsgo.ts` tìm
trong `data.list[]` phần tử có `variant.type_plan_image === typePlanImage` và ném lỗi (kèm danh sách
`type_plan_image` thực tế có) nếu không khớp — không bao giờ fallback về `list[0]`.

### 4) `LINK EDIT` → định danh (và loại) offer của chính mình

`LINK EDIT` có dạng `https://www.gamsgo.com/shop/<uuid>`, và `<uuid>` đó chính là `type_plan_id` của
1 listing merchant cụ thể **nằm trong** `list[]` của biến thể đã khớp — đã xác nhận bằng 1 dòng dữ
liệu sản xuất thật (Honkai Star Rail "Character Guarantee Bundle"): UUID trong LINK EDIT khớp CHÍNH
XÁC phần tử thứ 2 của `list[]`, không phải phần tử đầu. Nghĩa là tool KHÔNG thể giả định offer của
mình luôn là `list[0]` (lựa chọn "đại diện" của API) — `pick.ts` lọc pool bằng cách so từng
`typePlanId` của offer với `ownTypePlanId` của target (trích chặt từ `LINK EDIT` qua regex
`/shop/([^/?#]+)/?$/`, không đoán mò nếu URL sai khuôn).

## Logic tính giá

Sau khi loại offer của chính mình (`typePlanId === ownTypePlanId`) và mọi `merchant_id` trong
`SELLER_BLACK LIST`:

| MODE | SORT | Thứ tự candidate |
|---|---|---|
| `top` | `price` | tăng dần theo `total_price` (rẻ nhất trước) |
| `top` | `recommend` | giảm dần theo `sort_lcb_score` (ranking "tiến cử" nội bộ của GamsGo) |
| `race` | *(bỏ qua)* | chỉ 1 candidate: merchant khớp cột `Seller` |

**Reset rule** (chỉ MODE=`top`, cả 2 kiểu `SORT` — mirror đúng reset rule MODE=top của bản G2G): duyệt
candidate theo thứ tự trên, bỏ qua candidate nào giá **dưới** `PRICE MIN`, bám candidate **đầu tiên
giá >= `PRICE MIN`**. Nếu mọi candidate đều dưới `PRICE MIN` — quyết định của bản này (đã xác nhận với
người dùng, và đây là điểm **khác bản G2G**) là **bỏ qua dòng, không đổi giá** — bản G2G thì fallback
về `PRICE MIN` trong trường hợp này. `MODE=race` không bao giờ áp reset rule — bám đúng `Seller` được
liệt kê kể cả khi lỗ, giống G2G.

```
desired = round(đối thủ.price - Price step, số thập phân của Price step)
desired = desired < PRICE_MIN ? PRICE_MIN : desired   # sàn clamp LẦN 2: dù đối thủ đã >= PRICE MIN,
                                                        # trừ Price step vẫn có thể hụt xuống dưới sàn
```

`PRICE MIN` trong bản này chỉ có **đúng 1 vai trò**: sàn clamp áp dụng SAU KHI đã có đối thủ hợp lệ.
Không bao giờ dùng làm giá fallback khi KHÔNG có đối thủ hợp lệ, ở bất kỳ tình huống nào (pool rỗng sau
loại trừ, seller race không còn bán, hay reset rule quét hết không ai đạt sàn) — khác bản G2G, bản đó
vẫn fallback về `PRICE MIN` ở case "không có đối thủ".

Làm tròn: currency là USD, 2 số thập phân theo quy ước (đã xác nhận với người dùng) — không có case
sub-cent như ví dụ Carrot Seed của G2G. Cách tính theo số thập phân của CHUỖI GỐC `Price step`
(`countStepDecimals`, đọc chuỗi gốc thay vì số đã parse để tránh sai số biểu diễn float) vẫn được giữ
để nhất quán với codebase G2G và làm lớp an toàn, dù thực tế luôn ra 2.

Ghi chú tie-break: khi 2 candidate trùng CHÍNH XÁC giá trị sort (giá hoặc score), sort dùng là stable
sort nên tie được giữ theo đúng thứ tự `planList` trả về ban đầu — không được GamsGo cam kết/đảm bảo gì
thêm, chỉ là chi tiết implementation cần biết nếu kết quả có lúc trông lạ.

## Bản đồ module

| File | Vai trò |
|---|---|
| `src/core/http.ts` | `requestJson()` — retry + timeout, header giả Chrome dùng chung cho `mapi.gamsgo2.com`. Chưa có logic auth/401-refresh (Phase 1 hoàn toàn ẩn danh); xoay proxy đang để trống (`getProxyList()` trả `[]`) chờ Phase 2. |
| `src/core/category.ts` | `resolveTypeCategoryId(linkCrawl)` — `LINK CRAWL` → `type_category_id`, cache trong bộ nhớ không hết hạn theo chuỗi `LINK CRAWL`. |
| `src/core/gamsgo.ts` | `fetchOffers(typeCategoryId, typePlanImage)` — gọi `planList`, khớp đúng biến thể theo `LINK IMAGE`, trả `Offer[]` đã chuẩn hóa (giữ nguyên thứ tự, không tự sort — việc đó là của `pick.ts`). |
| `src/core/target.ts` | `SetupRowRaw`, `RaceTarget`, `parseTarget()` — mirror hình dạng/quy ước của `target.ts` bản G2G (số chấp nhận dấu phẩy VN, trích URL chặt kèm lỗi rõ, `isRowEnabled`). |
| `src/core/sheets.ts` | `readSetupRows(sheetName)` — đọc tab "Setup" qua Google Sheets API (service account, `credentials.json`), map tên cột → field `SetupRowRaw`. Port từ `core/sheets.ts` bản G2G, chỉnh lại `COLUMN_ALIASES` cho đúng cột Gamsgo (`SORT`, `LINK IMAGE`); hướng import bị đảo so với bản G2G — `SetupRowRaw` nằm ở `target.ts`, `sheets.ts` import ngược lại. `appendEditHistory()` (ghi tab "Edit History") **chưa** port — chưa có gì để ghi vì chưa có endpoint sửa giá. |
| `src/util/config.ts` | `loadConfig()` — đọc `.env` (`dotenv`) lấy `SHEET_SETUP` (mặc định `"Setup"`). `SPREADSHEET_ID`/`GOOGLE_SPREADSHEET_ID` đọc trực tiếp trong `sheets.ts`, đúng quy ước bản G2G (hằng số đó gắn liền với client Sheets). |
| `src/pick.ts` | `pickCompetitor()` — chọn đối thủ theo MODE top/race, reset rule, tính giá cuối. Hàm thuần, không I/O. |
| `src/dev-test.ts` | Script chạy tay: đọc dòng Setup thật từ Google Sheets qua `readSetupRows()`, in ra pool đã crawl + giá tính được cho từng dòng bật để đối chiếu bằng mắt với dữ liệu sản xuất thật. Cần `credentials.json` + `.env` (`SPREADSHEET_ID`) — xem mục "Cài đặt Google Sheets" trong README. |

## Cột sheet Setup

| Cột | Dùng cho | Ghi chú |
|---|---|---|
| `CHECK` | `isRowEnabled` | `1/true/yes/on/x` (không phân biệt hoa thường) |
| `MODE` | `top` \| `race` | trống ⇒ suy luận: có `Seller` ⇒ `race`, không thì `top` |
| `SORT` | `price` \| `recommend` | chỉ có ý nghĩa khi `MODE=top`; trống/sai ⇒ `price` |
| `GAME` / `SERVICE` / `NAME` | chỉ hiển thị | không dùng cho tham số API nào |
| `LINK CRAWL` | `type_category_id` (qua `typeCategory`) | các dòng cùng trang category dùng chung `LINK CRAWL` |
| `LINK IMAGE` | khớp đúng biến thể trong `planList` | **bắt buộc** — GamsGo không có link crawl riêng cho từng sản phẩm |
| `LINK EDIT` | `ownTypePlanId` (loại khỏi pool đối thủ) | trích chặt `/shop/<id>`, không đoán mò |
| `Seller` | `merchant_id` mục tiêu khi `MODE=race` | thực tế hiện tại luôn đúng 1/dòng; chưa có logic tie-break nhiều seller |
| `Price step` | mức undercut + độ chính xác làm tròn | chấp nhận dấu phẩy VN (`0,01`) |
| `PRICE MIN` | sàn clamp + ngưỡng reset rule | trống ⇒ không sàn, không reset rule (`MODE=top` chỉ bám candidate #1) |
| `SELLER_BLACK LIST` | `merchant_id` bị loại | cách nhau dấu phẩy/chấm phẩy/xuống dòng |

## Việc còn hở / để ngỏ (phần việc của Phase 2)

- **Chưa tìm ra endpoint sửa giá.** Tìm lệnh "đổi giá listing của mình" có xác thực (và hình dạng auth
  của nó — cookie? header `token` với JWT thật như mẫu curl `typeCategory` đã thấy?) là ẩn số lớn tiếp
  theo, đóng vai trò như `PUT /offer/{id}?v=v2` của G2G.
- **Google Sheets mới nối chiều ĐỌC.** `core/sheets.ts::readSetupRows()` đã port và nối vào
  `dev-test.ts`; `appendEditHistory()` (ghi "Edit History") chưa port — chưa có gì để ghi cho tới khi
  tìm ra endpoint sửa giá ở trên.
- **Chưa có Dashboard / `state.json` / Telegram noti.** Output hiện tại đi qua `console.log` thuần
  trong `dev-test.ts` — ổn cho script chạy tay, nhưng daemon polling thật sự nên theo quy ước "mọi
  output qua 1 module duy nhất" của bản G2G khi được xây.
- **`MODE=race` với nhiều `Seller` chưa có quy tắc tie-break.** Đã đồng ý với người dùng để lùi lại khi
  thực tế có dòng cần nhiều hơn 1 seller.
- **Chưa xác minh `typeCategory` có chạy được hoàn toàn không token.** Bản curl thật duy nhất có được
  kèm 1 token thật; `planList` đã xác nhận chạy được với `token: undefined`, nhưng `typeCategory` chưa
  test riêng không token.
