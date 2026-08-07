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
 *   - `sellerIds`      ← cột Seller; MODE ghi rõ "race" + Seller trống → mặc
 *                        định bám CNLTeam (`DEFAULT_RACE_SELLER_ID`), xem
 *                        `isExplicitRaceMode`.
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

/**
 * "0,01" / "19.27" → number. Hỗ trợ dấu phẩy thập phân kiểu VN. Rỗng → null.
 *
 * Bắt buộc khớp NGUYÊN chuỗi bằng regex trước khi `parseFloat` — `parseFloat`
 * thuần chỉ đọc PHẦN ĐẦU hợp lệ rồi bỏ qua rác phía sau mà không báo gì (vd
 * `parseFloat("133.o0")` = `133`, KHÔNG phải `NaN`) — đã gặp thật lúc verify: 1
 * giá trị PRICE MIN gõ lẫn ký tự lẽ ra phải bị coi là lỗi vẫn lọt qua như số hợp
 * lệ nếu chỉ dựa vào `Number.isFinite(parseFloat(...))`.
 */
function parseNum(raw: string): number | null {
  const s = (raw || '').trim().replace(/,/g, '.');
  if (s === '') return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
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

/**
 * Merchant mặc định cho MODE=race khi cột `Seller` bỏ trống — seller CNLTeam.
 * Chỉ áp dụng khi cột MODE ghi RÕ RÀNG "race" (xem `isExplicitRaceMode`) — KHÔNG
 * áp dụng khi MODE để trống + Seller để trống (case đó vẫn suy luận 'top' như cũ,
 * tránh âm thầm biến các dòng 'top' chưa điền Seller thành 'race' bám CNLTeam
 * ngoài ý muốn). Seller này có ĐƯỢC BÁM THẬT hay không còn phụ thuộc nó có đang
 * bán biến thể đó không — `pickCompetitor()` (pick.ts) đã tự bỏ qua nếu không
 * tìm thấy trong pool, không cần thêm logic riêng ở đây.
 */
const DEFAULT_RACE_SELLER_ID = 'f58a591c-68e8-dada-ab1b-856a52ed11f9'; // CNLTeam

/** MODE ghi rõ ràng là race (chữ "race" hoặc số "0") — không tính case suy luận từ Seller trống. */
function isExplicitRaceMode(raw: string): boolean {
  const m = (raw || '').trim().toLowerCase();
  return m === 'race' || m === '0';
}

/**
 * `merchant_id` của GamsGo luôn có dạng UUID (8-4-4-4-12 hex, đã xác nhận qua mọi
 * dữ liệu thật crawl được) — dùng để phát hiện SỚM lỗi gõ nhầm ở cột Seller/
 * SELLER_BLACK LIST (thiếu/dư ký tự, dán nhầm chuỗi khác...) mà KHÔNG cần crawl gì
 * cả. Chỉ CẢNH BÁO (không chặn dòng như PRICE MIN) — hậu quả nhẹ hơn nhiều: 1 entry
 * gõ sai chỉ khiến chính entry đó không loại/bám được ai, không phải "mất cả sàn
 * giá" như PRICE MIN sai.
 */
const MERCHANT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function findMalformedIds(ids: string[]): string[] {
  return ids.filter((id) => !MERCHANT_ID_RE.test(id));
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
 * nếu thiếu/sai dữ liệu BẮT BUỘC (LINK CRAWL / LINK IMAGE / LINK EDIT / Price step
 * / PRICE MIN có giá trị nhưng không parse được số). `warnings` (nếu có) là các
 * vấn đề KHÔNG chặn dòng (Seller/SELLER_BLACK LIST có entry không đúng dạng
 * merchant_id) — dòng vẫn chạy, caller tự in cảnh báo ra cho người vận hành biết.
 */
export function parseTarget(
  row: SetupRowRaw
): { target?: RaceTarget; error?: string; warnings?: string[] } {
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

  // PRICE MIN có giá trị nhưng KHÔNG parse được số → CHẶN DÒNG (khác 2 warning dưới).
  // Lý do khác biệt: nếu âm thầm coi là "không có sàn" (như trước đây), MODE=top mất
  // hẳn reset rule mà không ai biết — rủi ro bán lỗ không kiểm soát. Trống thật (không
  // gõ gì) vẫn hợp lệ = không sàn, đúng thiết kế cũ.
  const priceMinRaw = (row.priceMin || '').trim();
  if (priceMinRaw !== '' && parseNum(row.priceMin) === null) {
    return {
      error:
        `dòng ${row.rowIndex}: PRICE MIN "${row.priceMin}" không parse được thành số — ` +
        `sửa lại hoặc để trống hẳn (trống = không có sàn giá, đây là lựa chọn hợp lệ).`,
    };
  }

  let sellerIds = parseIdList(row.seller);
  if (sellerIds.length === 0 && isExplicitRaceMode(row.mode)) {
    sellerIds = [DEFAULT_RACE_SELLER_ID];
  }
  const blacklist = parseIdList(row.sellerBlackList);

  const warnings: string[] = [];
  const badSellerIds = findMalformedIds(sellerIds);
  if (badSellerIds.length > 0) {
    warnings.push(
      `dòng ${row.rowIndex}: cột Seller có giá trị không đúng dạng merchant_id (UUID): ` +
        `[${badSellerIds.join(', ')}] — kiểm tra lại có gõ nhầm không.`
    );
  }
  const badBlacklistIds = findMalformedIds(blacklist);
  if (badBlacklistIds.length > 0) {
    warnings.push(
      `dòng ${row.rowIndex}: cột SELLER_BLACK LIST có giá trị không đúng dạng merchant_id (UUID): ` +
        `[${badBlacklistIds.join(', ')}] — entry này sẽ KHÔNG loại được ai, kiểm tra lại có gõ nhầm không.`
    );
  }

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
      blacklist,
    },
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
