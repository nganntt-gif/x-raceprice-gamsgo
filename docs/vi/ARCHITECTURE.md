# Kiến trúc — x-raceprice-gamsgo

> Trạng thái: **Phase 2, giai đoạn có daemon.** Crawl + tính giá + endpoint sửa giá thật
> (`editPlanInfo`) đều đã chạy được với dữ liệu thật; tab Setup đọc THẬT qua Google Sheets API.
> `src/main.ts` là daemon polling thật (mirror `main.ts`/`Dashboard`/`state.ts` bản G2G) — tự sửa giá
> mọi dòng bật theo nhịp poll; `dev-test.ts` (read-only) và `dev-apply.ts` (1 dòng, cần `--yes`) vẫn giữ
> lại để chẩn đoán/sửa tay khi cần. Mọi lần sửa thật — từ daemon hoặc `dev-apply.ts` — đều ghi log vào
> "Edit History" và bắn tin Telegram (chưa cấu hình channel thật cho Gamsgo — xem mục "Telegram noti").
> Vẫn CHƯA làm: auto-refresh token (token hiện lấy từ file cookies export tay) và cơ chế process
> manager (daemon không tự daemonize — xem mục "Daemon polling").

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

**Đã gom (dedup) theo dòng Setup cùng `LINK CRAWL`.** Nhiều dòng Setup thường trỏ cùng 1 trang category
(khác biến thể sản phẩm, cùng `type_category_id`) — `core/gamsgo.ts` cache nguyên response `planList`
trong bộ nhớ, khoá theo `type_category_id`, nên `fetchOffers()` chỉ gọi request thật **ĐÚNG 1 LẦN** cho
mỗi `type_category_id` khác nhau trong 1 lượt chạy; mọi dòng khác cùng category tái dùng list biến thể
đã cache, chỉ lọc riêng theo `LINK IMAGE` của dòng đó. Đã verify bằng dữ liệu Setup thật có 2 dòng cùng
category: chỉ dòng đầu gọi request thật, dòng thứ 2 lấy từ cache. Cách này AN TOÀN với 2 script chạy 1
lượt hiện tại (`dev-test.ts`/`dev-apply.ts` — mỗi lần chạy là 1 process mới, cache tự rỗng lại) — **sẽ
KHÔNG an toàn khi có daemon polling**: cache đó phải bị xoá ở đầu MỖI chu kỳ poll, nếu không giá đối
thủ sẽ "đông cứng" mãi ở lần fetch đầu tiên, không bao giờ cập nhật. Khác với cache của
`type_category_id` (đúng là nên vĩnh viễn vì UUID đó gần như bất biến), cache này giữ GIÁ — thứ đổi
liên tục.

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

**Reset rule** (chỉ MODE=`top`, cả 2 kiểu `SORT`): duyệt candidate theo thứ tự trên, bỏ qua candidate
nào có **`giá - Price step` dưới `PRICE MIN`** — nghĩa là dù có bám cũng không còn margin để đạt sàn —
bám candidate **đầu tiên vượt qua test này**. Vì test đã trừ sẵn `Price step` trước khi so sánh, giá
tính ra cho candidate được chọn **luôn đảm bảo** >= `PRICE MIN` — không còn cần "clamp lần 2" như trước
nữa (xem dưới). Nếu mọi candidate đều trượt test này → **giữ nguyên giá hiện tại** (`desired: null`) —
`PRICE MIN` không bao giờ được dùng làm giá thật, chỉ làm ngưỡng lọc; đây là điểm chủ động **khác bản
G2G**, bản đó fallback về `PRICE MIN` ở case tương ứng.

```
desired = round(đối thủ.price - Price step, số thập phân của Price step)
```

2 case biên sau tự động thỏa mãn bởi ĐÚNG công thức trên, không cần thêm nhánh code riêng — vì pool
luôn loại trừ chính mình, nên "candidate tốt nhất còn lại" đồng thời vừa là "đối thủ cần vượt qua" (khi
mình chưa phải tốt nhất) vừa là "người xếp sau mình" (khi mình đã là tốt nhất):

- **Mình là seller duy nhất bán biến thể này** (pool rỗng sau loại self + blacklist): `desired: null`,
  không đổi giá — không có gì để so sánh.
- **Mình đã đang là seller tốt nhất** (giá/score của mình đã vượt mọi candidate khác): cùng vòng quét
  reset rule chọn ra seller tốt nhất KHÁC làm `competitor`, nên `competitor.price - Price step` vừa
  giữ mình ở vị trí tốt nhất vừa nâng giá lên gần họ hơn — thu về biên lợi nhuận thay vì bỏ phí. Không
  cần kiểm tra "mình có đang top 1 không" ở đâu cả.

`MODE=race` **không bao giờ áp `PRICE MIN` dưới bất kỳ hình thức nào** — không reset rule, và (từ thay
đổi dưới đây) cũng không còn clamp sàn. Luôn bám đúng `Seller` được liệt kê ở đúng `competitor.price -
Price step`, kể cả khi giá đó thấp hơn `PRICE MIN` hoặc đang lỗ — đã xác nhận rõ với người dùng ("không
quan tâm price min, cứ dí thằng đối thủ"). Bản trước đây vẫn clamp `race` lên `PRICE MIN` qua chung 1
helper với `top`, mâu thuẫn với ý định này; giờ cả 2 mode dùng chung 1 helper tính giá `priced()` không
biết gì về `PRICE MIN` — chính vòng quét reset rule của `top` mới là thứ giữ *kết quả của nó* ở trên
sàn, không phải logic trong helper tính giá.

Làm tròn: currency là USD, 2 số thập phân theo quy ước (đã xác nhận với người dùng) — không có case
sub-cent như ví dụ Carrot Seed của G2G. Cách tính theo số thập phân của CHUỖI GỐC `Price step`
(`countStepDecimals`, đọc chuỗi gốc thay vì số đã parse để tránh sai số biểu diễn float) vẫn được giữ
để nhất quán với codebase G2G và làm lớp an toàn, dù thực tế luôn ra 2.

Ghi chú tie-break: khi 2 candidate trùng CHÍNH XÁC giá trị sort (giá hoặc score), sort dùng là stable
sort nên tie được giữ theo đúng thứ tự `planList` trả về ban đầu — không được GamsGo cam kết/đảm bảo gì
thêm, chỉ là chi tiết implementation cần biết nếu kết quả có lúc trông lạ.

## Sửa giá thật: `POST /product/editPlanInfo`

Khác 2 endpoint crawl ở trên (hoàn toàn ẩn danh), sửa giá thật YÊU CẦU xác thực. Đã xác nhận qua bắt
request thật trên browser:

```
POST https://mapi.gamsgo2.com/product/editPlanInfo
header: token: <token session, 32 ký tự>
body:   { "language": "en", "show_currency": "USD", "type_plan_id": "<uuid>", "price": <number> }
```

`type_plan_id` ở đây chính là `ownTypePlanId` — cùng giá trị đã trích từ `LINK EDIT` để loại offer của
mình khỏi pool đối thủ; sửa giá tái dùng luôn giá trị đó làm mục tiêu mutate.

Response thành công (đã xác nhận thật, không đoán):

```json
{ "code": 1, "message": "Successfully", "toast": 1, "redirect_url": "",
  "type": "success", "data": { "type_plan_id": "244a4053-26a7-512d-9960-bd91180d44d5" } }
```

Chưa bắt được mẫu response lỗi. `core/gamsgo.ts::editPlanInfo()` coi MỌI response có `code !== 1` là
lỗi và ném kèm nguyên response gốc — đúng quy ước "không đoán mò, luôn echo response thật" đã dùng ở
`category.ts` và các case lỗi khác của `gamsgo.ts`.

**Nguồn token: 1 file cookies export từ browser, không phải chuỗi copy tay.**
`core/auth.ts::getAuthToken()` đọc file JSON dạng Playwright storageState (`cookies[]` +
`origins[].localStorage[]`) và lấy trực tiếp giá trị cookie tên **`token`** (domain `.gamsgo.com`) —
đã xác nhận bằng file cookies thật, KHÔNG cần đào `localStorage` như G2G phải làm với `accessToken`.
Hàm này cũng kiểm tra cookie `has_login` trong file, báo lỗi rõ nếu đọc được `'0'` (session đã đăng
xuất). Đường dẫn file lấy từ `.env` (`COOKIES_FILE`, mặc định `cookies/gamsgo_go1.json`), đúng quy ước
`COOKIES_FILE` của bản G2G. **Token là TĨNH** — chưa có login/refresh flow (khác
`POST /user/refresh_access` của G2G); hết hạn thì export lại file cookies mới từ session đã đăng nhập —
đúng giai đoạn khởi động G2G đã từng ở trước khi có auto-refresh.

**Việc mutate CHỦ ĐỘNG KHÔNG gắn vào `dev-test.ts`** — script đó giữ 100% read-only. 1 script riêng,
`src/dev-apply.ts`, tính đúng diff (giá live hiện tại vs. `desired` của `pickCompetitor()`) cho 1
`rowIndex`, và CHỈ gọi `editPlanInfo()` khi chạy kèm cờ `--yes` — thiếu cờ này, script in diff rồi dừng,
không mutate gì cả (an toàn theo mặc định; chưa có daemon/vòng lặp tự sửa giá).

## Ghi log sửa giá thật: tab "Edit History"

Sau khi `editPlanInfo()` thành công, `dev-apply.ts` ghi đúng 1 dòng vào tab "Edit History"
(`SHEET_EDIT_HISTORY` trong `.env`, mặc định `"Edit History"`) qua
`core/sheets.ts::appendEditHistory()`. Đa số cột dùng lại label của bản G2G (`Game`, `Service`, `Name`,
`Top Seller Follow`, `Note`, `Time`) để nhất quán giữa các tool của người dùng, nhưng 2 cột giá **chủ
động khác G2G**: `Price Before`/`Price After` (giá live NGAY TRƯỚC khi sửa, và giá thật đã gửi lên
`editPlanInfo`) thay vì `Enemy Price`/`My Price` (giá đối thủ / giá mình) của G2G — đã xác nhận với
người dùng sau lần chạy thật đầu tiên. Giá đối thủ không mất đi — vẫn xem được trong cột `Note` (chuỗi
note của `pickCompetitor()` đã có sẵn `đối thủ giá=...`). Các điều chỉnh khác: `Top Seller Follow` là
`merchant_name`/`merchant_id` của Gamsgo (không có username kiểu G2G), không có cột `min_qty` (khái
niệm riêng của G2G, từ ràng buộc `min_qty*giá >= 1 USD` — Gamsgo không có ràng buộc tương đương), và
`Note` tái dùng NGUYÊN chuỗi `result.note` của `pickCompetitor()` (đã đủ chi tiết: MODE/SORT/reset-rule/
số candidate bị skip) thay vì dựng lại logic build note riêng như `main.ts` bản G2G phải làm. `Time` là
giờ UTC+7 (`HH:mm:ss DD-MM-YYYY`), tính bằng `Date` thuần (không thêm dependency `dayjs` chỉ để làm
đúng 1 việc cộng cố định 7 giờ).

**Kiểm tra chặt hơn bản G2G — có chủ đích.** `appendEditHistory()` bản G2G chỉ kiểm tra "tab đã tồn tại
chưa"; nếu có, giả định luôn header đã đúng rồi append thẳng. Bản này đọc row 1 và YÊU CẦU khớp CHÍNH
XÁC `EDIT_HISTORY_HEADERS` — row 1 rỗng thì ghi header; row 1 **có dữ liệu nhưng KHÔNG khớp** thì ném
lỗi rõ (kèm cả header dự kiến và header thực tế) thay vì append. Đây không phải giả định lý thuyết:
tab "Edit History" thật của người dùng được phát hiện đang chứa dữ liệu của 1 tool KHÁC (log bán RBX
Roblox, không có header — chính row 1 là 1 dòng data) — nếu append thẳng, dòng Gamsgo sẽ bị trộn lẫn
vào log đó không có ranh giới gì. Người dùng cần dọn hoặc đổi tên tab đó trước khi lần `dev-apply --yes`
đầu tiên ghi log thật.

Lỗi `appendEditHistory()` được bắt **riêng**, tách khỏi try/catch của `editPlanInfo()` — chỉ in cảnh
báo, không `exit(1)` hay gợi ý rằng việc sửa giá đã thất bại (giá đã đổi thành công rồi, chỉ có bước ghi
audit-log bị lỗi).

## Telegram noti

Sau khi sửa giá thật thành công, `dev-apply.ts` bắn 1 tin Telegram qua
`util/noti.ts::sendNoti()` — port gần như nguyên văn từ `util/noti.ts` bản G2G (cùng gateway
`noti.hqwg.pro`, cùng env `NOTI_API_KEY`/`NOTI_CHANNEL`, cùng hành vi "thiếu 1 trong 2 → tắt im
lặng"). Khác đúng 1 điểm: `Dashboard.error(...)` đổi thành `console.log(...)` (Gamsgo chưa có module
Dashboard).

**Đã xác nhận với người dùng: Gamsgo dùng channel/API key Telegram RIÊNG, không dùng chung với G2G**
— tránh lẫn tin sửa giá của 2 tool vào 1 nhóm chat, cùng lý do đã dẫn tới việc kiểm header chặt hơn ở
tab "Edit History" trên. `.env` để trống cả 2 field này; người dùng cần tự điền giá trị thật riêng cho
Gamsgo thì tin mới thật sự gửi được.

**Dùng `await`, không `void` như G2G.** G2G gọi `void sendNoti(...)` (fire-and-forget) vì daemon là
process sống liên tục — không cần chờ. `dev-apply.ts` là script chạy 1 lần rồi thoát ngay; fire-and-
forget ở đây có rủi ro process exit trước khi request HTTP gửi xong, làm mất tin âm thầm. Vì vậy lệnh
gọi ở `dev-apply.ts` dùng `await`. `sendNoti()` không bao giờ throw (lỗi tự nuốt + log, trả `false`) —
không cần thêm try/catch quanh lệnh gọi.

Tin nhắn có thêm dòng **Mode/Sort** riêng (theo yêu cầu người dùng) ngoài `result.note` của
`pickCompetitor()` (đã nhắc MODE/SORT trong câu văn) — `Sort` chỉ hiện khi `mode === 'top'` (không có ý
nghĩa ở `race`, đúng quy ước có sẵn trong `target.ts`). 1 helper `escapeHtml()` tại chỗ (đặt ở nơi gọi,
giống G2G, không phải trong `noti.ts`) escape giá trị động trước khi nhúng vào tin HTML.

## Daemon polling (`src/main.ts`)

Mirror sát kiến trúc `main.ts`/`Dashboard`/`state.ts` bản G2G — cùng hình dạng loop, cùng `Dashboard`
(render terminal qua `log-update`+`chalk`, port gần như nguyên văn), cùng ý tưởng cache tab Setup và
không để lỗi 1 dòng làm dừng cả chu kỳ. 3 điểm khác biệt có chủ đích, mỗi điểm gắn với 1 khác biệt
nền tảng thật so với G2G:

1. **KHÔNG dùng `lastApplied` để gate — daemon so `desired` với giá LIVE crawl được mỗi chu kỳ, không
   phải giá trị "đã đặt lần trước" lưu lại.** G2G cần `lastApplied` (nạp từ `state.json`) vì
   `fetchOffers()` (`GET /offer/search`, phân trang bằng `page_size`) có thể KHÔNG trả về offer của
   chính G2G nếu giá không đủ cạnh tranh để vào trang đầu. `planList` của Gamsgo trả **TOÀN BỘ** danh
   sách merchant của 1 biến thể (không phân trang) — offer của chính mình LUÔN có trong pool crawl được
   (đã xác nhận qua mọi lần `dev-test`/`dev-apply` chạy thật, tag `← CHÍNH MÌNH`). So với giá live thay
   vì giá đã lưu MẠNH HƠN — tự "chữa lành" nếu giá bị đổi qua đường khác (web UI tay, 1 lần chạy
   `dev-apply` khác) mà `state.json` không biết tới. `state.json` ở đây chỉ giữ `editCount` (để hiển
   thị Dashboard), KHÔNG dùng để gate quyết định — xem `util/state.ts`.
2. **Token tĩnh — token chết luôn là FATAL, khác kiểu phân loại `RefreshTokenError.fatal` của G2G.**
   `main.ts` đọc token 1 LẦN lúc boot qua `getAuthToken()`; không có API refresh nào để thử lại (xem
   mục "Sửa giá thật" trên — vẫn còn là known gap). Lỗi `401`/`403` từ `editPlanInfo` giữa chừng
   (`NonRetryableError` của `core/http.ts`, check qua helper `isAuthDeadError()` tại chỗ) coi là KHÔNG
   THỂ PHỤC HỒI: log FATAL, bắn Telegram cảnh báo, `process.exit(1)`. Người vận hành phải export file
   cookies mới rồi khởi động lại — cùng KẾT QUẢ CUỐI với nhánh `RefreshTokenError` fatal của G2G, chỉ
   khác cơ chế phát hiện (không có bước refresh nào để thất bại — 1 lỗi 401/403 sống CHÍNH LÀ tín hiệu).
3. **`Dashboard` chỉ dùng trong `main.ts`.** `dev-test.ts`/`dev-apply.ts` giữ nguyên `console.log` —
   đây là script chạy 1 lần, tuyến tính, không có khung cần bảo vệ khỏi vỡ — khác lý do CLAUDE.md của
   G2G cấm tuyệt đối `console.log` (hợp lý ở đó vì G2G KHÔNG có script chạy 1 lần nào cả, mọi thứ đều
   qua `main.ts`).

Luồng điều khiển (tất cả trong `src/main.ts`):

- `bootstrap()` — set title Dashboard, kiểm tra `SPREADSHEET_ID` + file cookies tồn tại, đọc token 1
  lần (`getAuthToken`, `process.exit(1)` nếu lỗi), log cấu hình poll/cache, bắn `void sendNoti(...)`
  ("daemon vừa khởi động" — fire-and-forget, an toàn vì process sống mãi, khác `dev-apply.ts` phải
  `await`), rồi gọi `loop()`.
- `loop()` — `while (true) { runCycle() (bắt lỗi, log) → Dashboard.setPhase('SLEEPING', nextAt) →
  sleep(pollIntervalSeconds) }`. Không tự thoát — chỉ `process.exit(1)` (auth chết) mới dừng được.
- `loadTargets()` — cache theo `setupCacheSeconds` (mặc định 300s), đúng pattern G2G: lỗi đọc Sheets
  thì giữ cache cũ nếu đã có, throw nếu đây là lần đọc đầu tiên. `warnings` của `parseTarget()` (từ
  validate `PRICE MIN`/`Seller`/`SELLER_BLACK LIST`) được đưa qua `Dashboard.error('SETUP', ...)` ở đây
  thay vì `console.log`.
- `runCycle()` — gọi `clearPlanListCache()` **NGAY ĐẦU, mỗi lần** (bắt buộc, đã cảnh báo ở `gamsgo.ts`),
  load targets, rồi gọi `processTarget()` cho từng dòng trong try/catch RIÊNG — 1 dòng lỗi không dừng
  các dòng khác, mirror đúng cách `dev-test.ts` đã cô lập lỗi từng dòng. Kết quả `isAuthDeadError()` sẽ
  cắt ngang cả chu kỳ (dừng FATAL), bỏ qua các dòng còn lại.
- `processTarget(target)` — crawl (`resolveTypeCategoryId` + `fetchOffers`, giống `dev-apply.ts`), tìm
  offer của mình trong pool lấy `currentPrice` LIVE, chạy `pickCompetitor()`, chỉ gọi `editPlanInfo()`
  nếu `desired` khác `currentPrice`. Thành công thì tăng `editCount` + `saveState()`, `await
  appendEditHistory(...)` (awaited, try/catch riêng, mirror G2G — lỗi ghi Sheet không bao giờ ngụ ý
  việc sửa giá thất bại), rồi `void sendNoti(...)` (fire-and-forget, giống G2G). Mọi nhánh đều update
  `Dashboard.updateTarget()` (`SKIP`/`WATCHING`/`EDITED`/`ERROR`).

**Không có dry-run mode, có chủ đích (đã xác nhận với người dùng) — giống đúng G2G.** `dev-test.ts`
(read-only) và `dev-apply.ts` (cần `--yes`, 1 dòng) là lớp an toàn để validate logic trước khi tin
tưởng daemon chạy không ai giám sát; `main.ts` luôn sửa giá thật ngay khi giá 1 dòng lệch, không có cờ
nào để chỉ xem trước.

## Bản đồ module

| File | Vai trò |
|---|---|
| `src/core/http.ts` | `requestJson()` — retry + timeout, header giả Chrome dùng chung cho `mapi.gamsgo2.com`. Đã hỗ trợ override header riêng theo call (dùng cho `editPlanInfo` để thêm `token`); không có logic 401-refresh (token tĩnh, xem mục "Sửa giá thật" trên). Xoay proxy đang để trống (`getProxyList()` trả `[]`) chờ Phase 2. |
| `src/core/category.ts` | `resolveTypeCategoryId(linkCrawl)` — `LINK CRAWL` → `type_category_id`, cache trong bộ nhớ không hết hạn theo chuỗi `LINK CRAWL`. |
| `src/core/gamsgo.ts` | `fetchOffers(typeCategoryId, typePlanImage)` — gọi `planList` (cache trong bộ nhớ theo `type_category_id`, xem mục "planList" trên — dòng nào cùng `LINK CRAWL` chỉ tốn 1 request thật), khớp đúng biến thể theo `LINK IMAGE`, trả `Offer[]` đã chuẩn hóa (giữ nguyên thứ tự, không tự sort — việc đó là của `pick.ts`). Ngoài ra `editPlanInfo(typePlanId, price, token)` (mutate giá thật) và `clearPlanListCache()` — bắt buộc gọi ở đầu mỗi chu kỳ poll của `main.ts`, xem mục "Daemon polling" trên. |
| `src/core/auth.ts` | `getAuthToken(cookiesPath)` — đọc file cookies export từ browser, trả giá trị cookie `token` cho `editPlanInfo`. Xem mục "Sửa giá thật" trên. |
| `src/core/target.ts` | `SetupRowRaw`, `RaceTarget`, `parseTarget()` — mirror hình dạng/quy ước của `target.ts` bản G2G (số chấp nhận dấu phẩy VN, trích URL chặt kèm lỗi rõ, `isRowEnabled`). Trả `warnings` cho entry `Seller`/`SELLER_BLACK LIST` sai dạng — xem mục "Validate dòng Setup" dưới. |
| `src/core/sheets.ts` | `readSetupRows(sheetName)` — đọc tab "Setup" qua Google Sheets API (service account, `credentials.json`), map tên cột → field `SetupRowRaw`. Port từ `core/sheets.ts` bản G2G, chỉnh lại `COLUMN_ALIASES` cho đúng cột Gamsgo (`SORT`, `LINK IMAGE`); hướng import bị đảo so với bản G2G — `SetupRowRaw` nằm ở `target.ts`, `sheets.ts` import ngược lại. Ngoài ra `appendEditHistory(sheetName, rowData)` — ghi 1 dòng log mỗi lần sửa giá thật; kiểm tra header chặt hơn bản G2G, xem mục "Ghi log sửa giá thật" trên. |
| `src/util/config.ts` | `loadConfig()` — đọc `.env` (`dotenv`) lấy `SHEET_SETUP`, `COOKIES_FILE`/`cookiesPath`, `SHEET_EDIT_HISTORY`, và (cho daemon) `POLL_INTERVAL_SECONDS`/`SETUP_CACHE_SECONDS` (mặc định `20`/`300`, giống G2G). `SPREADSHEET_ID`/`GOOGLE_SPREADSHEET_ID` đọc trực tiếp trong `sheets.ts`, đúng quy ước bản G2G (hằng số đó gắn liền với client Sheets). |
| `src/util/dashboard.ts` | `Dashboard` — render terminal qua `log-update`+`chalk`, port gần như nguyên văn từ bản G2G. Chỉ dùng trong `main.ts`; xem mục "Daemon polling" trên lý do `dev-test.ts`/`dev-apply.ts` không dùng. |
| `src/util/state.ts` | `loadState()`/`saveState()` — lưu `editCount` (theo `ownTypePlanId`) vào `state.json`. Không có `lastApplied` (khác G2G) — xem mục "Daemon polling" trên. |
| `src/util/time.ts` | `nowUtc7()` — helper tính giờ UTC+7 dùng chung (`dayjs`), cả `dev-apply.ts` và `main.ts` đều import để dùng cho cột "Time" của Edit History và tin Telegram. |
| `src/util/noti.ts` | `sendNoti(content)` / `isNotiConfigured()` — bắn tin Telegram qua gateway `noti.hqwg.pro`. Port gần như nguyên văn từ bản G2G; xem mục "Telegram noti" trên. |
| `src/pick.ts` | `pickCompetitor()` — chọn đối thủ theo MODE top/race, reset rule, tính giá cuối. Hàm thuần, không I/O. |
| `src/dev-test.ts` | Script chạy tay: đọc dòng Setup thật từ Google Sheets qua `readSetupRows()`, in ra pool đã crawl + giá tính được cho từng dòng bật để đối chiếu bằng mắt với dữ liệu sản xuất thật. 100% read-only — không bao giờ gọi `editPlanInfo`. Cần `credentials.json` + `.env` (`SPREADSHEET_ID`) — xem mục "Cài đặt Google Sheets" trong README. |
| `src/dev-apply.ts` | Script chạy tay để sửa giá THẬT: cùng pipeline crawl/tính giá với `dev-test.ts` nhưng cho 1 `rowIndex`, in ra diff giá, chỉ gọi `editPlanInfo()` khi chạy kèm `--yes`. Thành công thì ghi thêm 1 dòng vào "Edit History" qua `appendEditHistory()` (xem mục "Ghi log sửa giá thật" trên) và bắn 1 tin Telegram qua `sendNoti()` (xem mục "Telegram noti" trên). Cần cấu hình `COOKIES_FILE` (xem mục "Sửa giá thật" trên). |
| `src/main.ts` | Daemon polling — xem mục "Daemon polling" trên. Entry point (`bun run start`). |

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
| `Seller` | `merchant_id` mục tiêu khi `MODE=race` | thực tế hiện tại luôn đúng 1/dòng; chưa có logic tie-break nhiều seller. Trống **và** `MODE` ghi rõ `race`/`0` ⇒ mặc định `f58a591c-68e8-dada-ab1b-856a52ed11f9` (merchant "CNLTeam") — chỉ THẬT SỰ được bám nếu merchant đó có trong pool đã crawl, giống mọi target race khác. Entry nào không đúng dạng UUID merchant_id sẽ có **cảnh báo** (dòng vẫn chạy) — xem dưới |
| `Price step` | mức undercut + độ chính xác làm tròn | chấp nhận dấu phẩy VN (`0,01`) |
| `PRICE MIN` | sàn clamp + ngưỡng reset rule | trống ⇒ không sàn, không reset rule (`MODE=top` chỉ bám candidate #1). **Có giá trị nhưng không parse được số ⇒ NÉM LỖI, bỏ qua dòng** (xem dưới) — âm thầm coi gõ sai là "không sàn" là rủi ro doanh thu thật |
| `SELLER_BLACK LIST` | `merchant_id` bị loại | cách nhau dấu phẩy/chấm phẩy/xuống dòng. Cùng cảnh báo dạng UUID như `Seller` trên |

## Validate dòng Setup: `PRICE MIN` ném lỗi, `Seller`/`SELLER_BLACK LIST` cảnh báo

Phát hiện 2 lỗi gõ nhầm là rủi ro âm thầm, giờ xử lý rõ trong `target.ts::parseTarget()`:

- **`PRICE MIN` có giá trị nhưng không parse được số ⇒ ném lỗi, bỏ qua cả dòng** (cùng mức với lỗi
  `LINK CRAWL`/`Price step`). Trước đây, giá trị không parse được rơi về `null` — âm thầm coi là
  "không có sàn" — không phân biệt được với việc người dùng CHỦ Ý để trống. Với `MODE=top`, điều đó có
  nghĩa mất hẳn bảo vệ của reset rule mà không có tín hiệu gì báo có gì sai. Ô THẬT SỰ để trống vẫn hợp
  lệ (không sàn, đúng thiết kế) — chỉ giá trị có gõ gì đó mà parse lỗi mới bị chặn.
  - Ghi chú: `parseNum()` cũng được siết lại — bắt buộc khớp NGUYÊN chuỗi với định dạng số, không chỉ
    phần đầu — `parseFloat("133.o0")` thuần trả về `133` (không phải `NaN`), âm thầm chấp nhận lỗi gõ
    nhầm có rác phía sau. Phát hiện ngay lúc viết script verify cho đúng fix này.
- **`Seller`/`SELLER_BLACK LIST` có entry không đúng dạng UUID merchant_id (`8-4-4-4-12` hex) ⇒ cảnh
  báo, KHÔNG chặn dòng.** Mức độ nhẹ hơn `PRICE MIN`: 1 entry sai chỉ khiến chính nó không khớp được ai
  khi lọc pool (1 exclusion không có tác dụng, hoặc 1 target race không bám được ai) — không phải mất cả
  1 lớp bảo vệ. `parseTarget()` trả thêm field tùy chọn `warnings: string[]`; `dev-test.ts`/
  `dev-apply.ts` in từng cảnh báo kèm tiền tố `⚠️` trước khi tiếp tục.

## Việc còn hở / để ngỏ (phần việc của Phase 2)

- **Token sửa giá là tĩnh, chưa có login/refresh flow.** `core/auth.ts::getAuthToken()` đọc 1 file
  cookies cố định, export lại bằng tay — chưa có gì tương đương
  `POST /user/refresh_access` của G2G. Token hết hạn sẽ lộ ra qua lỗi `editPlanInfo` (kèm nguyên
  response GamsGo trả về); người vận hành phải export lại file cookies mới bằng tay. Cũng chưa bắt được
  mẫu response LỖI nào (chỉ có mẫu thành công) — xử lý lỗi của `editPlanInfo()` tất yếu còn chung
  (`code !== 1` ⇒ ném kèm nguyên body) cho tới khi thấy 1 lỗi thật.
- **Chưa có process manager / auto-restart cho daemon.** `main.ts` không tự daemonize (đúng như G2G —
  cả 2 tool đều không bake in pm2/systemd/screen/tmux). Nếu process chết (crash, reboot server, tắt
  terminal không dùng `nohup`/session manager), không có gì tự khởi động lại — người vận hành tự chọn
  process manager mình muốn. Đã có script `build:exe`/`build:linux` (mirror G2G) để build ra 1 binary
  độc lập phục vụ việc này.
- **Tab "Edit History" thật cần dọn tay trước khi dùng.** Hiện đang chứa dữ liệu của 1 tool khác (xác
  nhận: log bán RBX Roblox, không có header đúng nghĩa) — `appendEditHistory()` từ chối ghi vào cho tới
  khi người dùng dọn/đổi tên tab đó, đúng chủ đích thiết kế (xem mục "Ghi log sửa giá thật" trên). Mỗi
  lần sửa giá thật — từ `dev-apply --yes` hoặc từ daemon — sẽ được ghi vào đó; chạy dry-run thì không.
- **Telegram noti chưa có channel thật.** `.env` để trống `NOTI_API_KEY`/`NOTI_CHANNEL`; người dùng cần
  tự điền giá trị RIÊNG cho Gamsgo (chủ động không dùng chung với G2G) thì tin mới thật sự gửi được —
  trước đó `sendNoti()` tự tắt an toàn, nhưng nghĩa là chưa có tin nào được gửi trên thực tế.
- **`MODE=race` với nhiều `Seller` chưa có quy tắc tie-break.** Đã đồng ý với người dùng để lùi lại khi
  thực tế có dòng cần nhiều hơn 1 seller.
- **Chưa xác minh `typeCategory` có chạy được hoàn toàn không token.** Bản curl thật duy nhất có được
  kèm 1 token thật; `planList` đã xác nhận chạy được với `token: undefined`, nhưng `typeCategory` chưa
  test riêng không token.
