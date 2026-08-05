/**
 * target.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Parse 1 dòng cấu hình thô (SetupRowRaw) → RaceTarget dùng để bám giá GamsGo.
 * Mirror target.ts bản G2G, khác ở:
 *   - `typePlanImage`  ← LINK IMAGE (dùng nguyên, không cần trích gì — GamsGo
 *                        không có link crawl riêng cho từng gói nên phải định
 *                        danh gói bằng ảnh).
 *   - `ownTypePlanId`  ← LINK EDIT dạng https://www.gamsgo.com/shop/<uuid>.
 *   - `sortKey`        ← cột SORT ('price' | 'recommend'), chỉ có ý nghĩa khi
 *                        mode='top'.
 */

/** Một dòng cấu hình thô từ tab Setup (đã map theo tên cột, chưa parse logic). */
export interface SetupRowRaw {
  rowIndex: number;
  check: string;
  mode: string;
  sort: string;
  game: string;
  service: string;
  name: string;
  linkCrawl: string;
  linkImage: string;
  linkEdit: string;
  seller: string;
  priceStep: string;
  priceMin: string;
  sellerBlackList: string;
}

export type PriceMode = 'top' | 'race';
export type SortKey = 'price' | 'recommend';

export interface RaceTarget {
  rowIndex: number;
  game: string;
  service: string;
  name: string;
  linkCrawl: string;
  typePlanImage: string;
  ownTypePlanId: string;
  mode: PriceMode;
  /** Chỉ có ý nghĩa khi mode='top'. */
  sortKey: SortKey;
  sellerIds: string[]; // merchant_id — dùng ở mode='race'
  priceStep: number;
  priceStepDecimals: number;
  priceMin: number | null;
  blacklist: string[]; // merchant_id
}

/** "0,01" / "19.27" → number. Hỗ trợ dấu phẩy thập phân kiểu VN. Rỗng → null. */
function parseNum(raw: string): number | null {
  const s = (raw || '').trim().replace(/,/g, '.');
  if (s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Số chữ số thập phân của Price step — đọc từ CHUỖI GỐC (tránh sai số biểu diễn
 *  số). GamsGo mặc định USD 2 số, nhưng giữ động để nhất quán + phòng hờ. */
function countStepDecimals(raw: string): number {
  const s = (raw || '').trim().replace(/,/g, '.');
  const m = s.match(/\.(\d+)$/);
  return m ? m[1].length : 0;
}

/**
 * LINK EDIT dạng https://www.gamsgo.com/shop/{uuid} → tách type_plan_id của
 * chính mình. CHỈ chấp nhận ĐÚNG khuôn `/shop/<id>` (cuối path, có thể có dấu /
 * theo sau) — không đoán mò. Không khớp ⇒ trả '' để parseTarget báo lỗi rõ.
 */
function extractOwnTypePlanId(linkEdit: string): string {
  const m = (linkEdit || '').match(/\/shop\/([^/?#]+)\/?(?:[?#].*)?$/i);
  return m ? m[1] : '';
}

/** Tách danh sách id (seller / blacklist) — cách nhau bởi dấu phẩy/chấm phẩy/xuống dòng. */
function parseIdList(raw: string): string[] {
  return (raw || '')
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isRowEnabled(row: SetupRowRaw): boolean {
  return /^(1|true|yes|on|x)$/i.test((row.check || '').trim());
}

/**
 * MODE: 'top' | 'race'. Nhận chữ hoặc số 1=top/0=race. Trống → suy luận: có
 * Seller thì 'race', không có thì 'top' (giữ tương thích, giống bản G2G).
 */
function parseMode(raw: string, sellerIds: string[]): PriceMode {
  const m = (raw || '').trim().toLowerCase();
  if (m === 'top' || m === '1') return 'top';
  if (m === 'race' || m === '0') return 'race';
  return sellerIds.length > 0 ? 'race' : 'top';
}

/** SORT: 'price' | 'recommend'. Trống/không hợp lệ → mặc định 'price' (an toàn:
 *  luôn bám giá rẻ nhất). Chỉ có ý nghĩa khi mode='top'. */
function parseSortKey(raw: string): SortKey {
  const s = (raw || '').trim().toLowerCase();
  return s === 'recommend' ? 'recommend' : 'price';
}

/**
 * Parse 1 dòng Setup → RaceTarget. Trả về { target } nếu hợp lệ, hoặc { error }
 * nếu thiếu dữ liệu bắt buộc (LINK CRAWL / LINK IMAGE / LINK EDIT / Price step).
 */
export function parseTarget(row: SetupRowRaw): { target?: RaceTarget; error?: string } {
  const linkCrawl = (row.linkCrawl || '').trim();
  const typePlanImage = (row.linkImage || '').trim();
  const ownTypePlanId = extractOwnTypePlanId(row.linkEdit);
  const priceStep = parseNum(row.priceStep);

  if (!linkCrawl) return { error: `dòng ${row.rowIndex}: LINK CRAWL trống` };
  if (!typePlanImage) return { error: `dòng ${row.rowIndex}: LINK IMAGE trống` };
  if (!ownTypePlanId)
    return {
      error: `dòng ${row.rowIndex}: LINK EDIT phải là link dạng https://www.gamsgo.com/shop/<id>`,
    };
  if (priceStep === null) return { error: `dòng ${row.rowIndex}: Price step không hợp lệ` };

  const sellerIds = parseIdList(row.seller);

  return {
    target: {
      rowIndex: row.rowIndex,
      game: row.game,
      service: row.service,
      name: row.name,
      linkCrawl,
      typePlanImage,
      ownTypePlanId,
      mode: parseMode(row.mode, sellerIds),
      sortKey: parseSortKey(row.sort),
      sellerIds,
      priceStep,
      priceStepDecimals: countStepDecimals(row.priceStep),
      priceMin: parseNum(row.priceMin),
      blacklist: parseIdList(row.sellerBlackList),
    },
  };
}
