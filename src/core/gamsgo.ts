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
const EDIT_PLAN_INFO_URL = 'https://mapi.gamsgo2.com/product/editPlanInfo';

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

// Cache planList theo type_category_id — CÙNG mục đích với cache của
// resolveTypeCategoryId() ở category.ts, nhưng lý do khác: nhiều dòng Setup có thể
// dùng CHUNG 1 LINK CRAWL (cùng type_category_id, chỉ khác biến thể/LINK IMAGE) —
// gom lại để chỉ gọi planList ĐÚNG 1 LẦN cho mỗi type_category_id trong 1 lượt xử
// lý, không gọi lại riêng cho từng dòng share cùng category.

const planListCache = new Map<string, RawVariant[]>();

/**
 * Xoá cache `planList` — PHẢI gọi ở đầu mỗi chu kỳ poll của `main.ts` (xem cảnh
 * báo trên). KHÔNG đụng cache `type_category_id` của `category.ts` — cache đó
 * đúng là nên giữ mãi, không hết hạn.
 */
export function clearPlanListCache(): void {
  planListCache.clear();
}

/** Gọi planList cho `typeCategoryId`, có cache trong `planListCache` (xem comment trên). */
async function fetchPlanListVariants(
  typeCategoryId: string,
  opts: RequestOptions
): Promise<RawVariant[]> {
  const cached = planListCache.get(typeCategoryId);
  if (cached) return cached;

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
  planListCache.set(typeCategoryId, variants);
  return variants;
}

/**
 * Trả pool offer (`list[]`) của ĐÚNG gói khớp `typePlanImage` (từ LINK IMAGE) cho
 * `typeCategoryId` — đã chuẩn hóa. Không khớp được gói nào ⇒ ném lỗi rõ (liệt kê
 * type_plan_image hiện có), KHÔNG lấy variant đầu mù. Gọi `planList` qua
 * `fetchPlanListVariants()` (có cache theo `typeCategoryId`, xem comment trên) —
 * nhiều dòng Setup cùng LINK CRAWL chỉ tốn 1 request thật.
 */
export async function fetchOffers(
  typeCategoryId: string,
  typePlanImage: string,
  opts: RequestOptions = {}
): Promise<Offer[]> {
  const variants = await fetchPlanListVariants(typeCategoryId, opts);
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

interface EditPlanInfoResponse {
  code?: number;
  message?: string;
  type?: string;
  data?: { type_plan_id?: string };
}

/**
 * Sửa giá THẬT của 1 listing (`typePlanId` = `ownTypePlanId`, trích từ LINK EDIT)
 * qua `POST /product/editPlanInfo` — CÓ xác thực (khác `fetchOffers`/
 * `resolveTypeCategoryId`, 2 endpoint đó ẩn danh). `token` lấy từ file cookies
 * qua `core/auth.ts::getAuthToken()`, KHÔNG hardcode/lưu lại ở đây.
 *
 * Response THẬT lúc thành công (đã xác nhận, không đoán): `{ code: 1, message:
 * "Successfully", type: "success", data: { type_plan_id } }`. Chưa có mẫu
 * response lỗi — mọi response có `code !== 1` bị coi là lỗi và ném kèm NGUYÊN
 * response gốc (đúng quy ước "không đoán mò, luôn echo response thật" đã dùng ở
 * `category.ts`/hàm `fetchOffers` phía trên — không giả định thêm field nào).
 */
export async function editPlanInfo(
  typePlanId: string,
  price: number,
  token: string,
  opts: RequestOptions = {}
): Promise<{ typePlanId: string }> {
  const resp: EditPlanInfoResponse = await requestJson(
    EDIT_PLAN_INFO_URL,
    { token }, // requestJson merge header riêng này lên trên GAMSGO_SHARED_HEADERS
    {
      ...opts,
      method: 'POST',
      body: { language: 'en', show_currency: 'USD', type_plan_id: typePlanId, price },
    }
  );

  if (resp?.code !== 1) {
    throw new Error(
      `editPlanInfo lỗi (type_plan_id=${typePlanId}, price=${price}, code=${resp?.code}, ` +
        `message=${resp?.message}): ${JSON.stringify(resp)}`
    );
  }

  return { typePlanId: resp.data?.type_plan_id ?? typePlanId };
}
