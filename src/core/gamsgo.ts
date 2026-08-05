/**
 * gamsgo.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Thin client cho `POST /index/planList` (host `mapi.gamsgo2.com`) — lấy pool
 * offer đối thủ cho 1 gói sản phẩm cụ thể (định danh bằng `type_plan_image`, lấy
 * từ cột `LINK IMAGE` — GamsGo không có link crawl riêng cho từng gói).
 *
 * Gọi ẨN DANH (không cookie/token) — giống tinh thần "dò giá không gắn tài khoản"
 * của bản G2G. KHÔNG tự re-sort: trả nguyên thứ tự `list[]` API trả về, việc lấy
 * "giá nhỏ nhất" / "score lớn nhất" do `pickCompetitor` (pick.ts) tự `reduce`.
 */

import { requestJson, type RequestOptions } from './http';

const PLAN_LIST_URL = 'https://mapi.gamsgo2.com/index/planList';

export interface Offer {
  merchantId: string;
  merchantName: string;
  price: number;
  /** sort_lcb_score — điểm "tiến cử" nội bộ của GamsGo, dùng cho SORT=recommend. */
  score: number | null;
  /** type_plan_id của CHÍNH listing này (không phải của gói/nhóm ngoài) — dùng để
   *  so khớp với `ownTypePlanId` (từ LINK EDIT) nhằm loại offer của chính mình. */
  typePlanId: string;
}

interface RawVariant {
  type_plan_id?: string;
  type_plan_image?: string;
  list?: RawMerchantEntry[];
}

interface RawMerchantEntry {
  type_plan_id?: string;
  merchant_id?: string;
  merchant_name?: string;
  total_price?: string | number;
  sort_lcb_score?: string | number;
}

/** "99.4%" / "241891" / 200 → number. Không parse được → null. */
function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const n = parseFloat(v.replace('%', '').trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * Gọi planList cho `typeCategoryId`, tìm ĐÚNG gói khớp `typePlanImage` (từ LINK
 * IMAGE), trả pool offer (`list[]` của gói đó) đã chuẩn hóa. Không khớp được gói
 * nào ⇒ ném lỗi rõ (liệt kê type_plan_image hiện có), KHÔNG lấy variant đầu mù.
 *
 * QUAN TRỌNG: PHẢI gửi `show_currency` trong body — đã test thật, THIẾU field
 * này thì `total_price` trả về mặc định theo VND (vd "9422572") dù mọi field
 * khác (currency_icon2...) vẫn hiển thị đúng USD trong ví dụ ban đầu; có field
 * này thì trả đúng USD 2 số ("359.00"). Không phải "client-side thuần" như test
 * ban đầu tưởng — server vẫn cần biết currency NGAY LÚC fetch (khớp việc người
 * dùng thấy currency được lưu trong cookie trên web thật: FE tự đọc cookie rồi
 * điền vào field này mỗi request, KHÔNG phải tự quy đổi hoàn toàn ở client).
 */
export async function fetchOffers(
  typeCategoryId: string,
  typePlanImage: string,
  opts: RequestOptions = {}
): Promise<Offer[]> {
  const resp = await requestJson(
    PLAN_LIST_URL,
    {},
    {
      ...opts,
      method: 'POST',
      body: { language: 'en', show_currency: 'USD', type_category_id: typeCategoryId },
    }
  );

  const variants: RawVariant[] = Array.isArray(resp?.data?.list) ? resp.data.list : [];
  const variant = variants.find((v) => v.type_plan_image === typePlanImage);

  if (!variant) {
    const found = variants.map((v) => v.type_plan_image).filter(Boolean).join(', ');
    throw new Error(
      `Không tìm thấy gói khớp LINK IMAGE "${typePlanImage}" trong planList (type_category_id=${typeCategoryId}). ` +
        `Các type_plan_image API trả về: [${found || 'rỗng'}]. Kiểm tra LINK IMAGE.`
    );
  }

  const merchants: RawMerchantEntry[] = Array.isArray(variant.list) ? variant.list : [];
  return merchants
    .map((m) => ({
      merchantId: String(m.merchant_id ?? ''),
      merchantName: typeof m.merchant_name === 'string' ? m.merchant_name.trim() : '',
      price: toNumber(m.total_price) ?? NaN,
      score: toNumber(m.sort_lcb_score),
      typePlanId: String(m.type_plan_id ?? ''),
    }))
    .filter((o) => o.typePlanId && Number.isFinite(o.price));
}
