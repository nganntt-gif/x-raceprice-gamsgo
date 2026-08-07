/**
 * pick.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * pickCompetitor(): chọn đối thủ + tính giá mới từ pool offer đã crawl, theo
 * bảng MODE/SORT đã chốt (xem plan) + "reset rule" kiểu G2G cho MODE=top:
 *
 *   MODE=top,  SORT=price     → đối thủ = giá NHỎ NHẤT trong pool
 *   MODE=top,  SORT=recommend → đối thủ = score (sort_lcb_score) LỚN NHẤT
 *   MODE=race                 → đối thủ = merchant khớp cột Seller (không reset rule,
 *                                KHÔNG áp PRICE MIN dưới bất kỳ hình thức nào — xem dưới)
 *
 * Reset rule (CHỈ áp cho MODE=top, cả 2 SORT): duyệt candidate theo thứ tự
 * (giá tăng dần / score giảm dần), BỎ QUA candidate nào (giá - Price step) <
 * PRICE MIN — nghĩa là dù bám cũng không còn margin để đạt sàn — lấy candidate
 * ĐẦU TIÊN vượt qua test này. Quét hết mà không ai đạt ⇒ GIỮ NGUYÊN giá hiện
 * tại (không đổi giá) — khác G2G (G2G fallback về PRICE MIN), đã chốt với
 * người dùng. Vì điều kiện lọc đã bao gồm luôn việc trừ Price step, candidate
 * được chọn LUÔN đảm bảo (giá - step) >= PRICE MIN — không còn cần "clamp lần
 * 2" như bản trước (set cứng giá = PRICE MIN khi hụt sàn); PRICE MIN giờ
 * KHÔNG BAO GIỜ được dùng làm giá thật, chỉ làm ngưỡng lọc.
 *
 * 2 case biên sau ĐÃ được thỏa mãn tự nhiên bởi thuật toán trên, không cần
 * nhánh code riêng (giải thích chi tiết ngay trong nhánh MODE=top dưới đây):
 *   - Pool chỉ có duy nhất chính mình bán (không seller khác) → bỏ qua, không
 *     đổi giá (nhánh `sorted.length === 0`).
 *   - Mình đã đang Top 1 (giá/score mình đã tốt hơn mọi seller khác) → công
 *     thức "candidate đầu (= top 2 tính cả mình) - Price step" tự nhiên vừa
 *     giữ mình ở Top 1 vừa nâng biên lợi nhuận, không cần biết mình có đang
 *     Top 1 hay không.
 */

import type { Offer } from './core/gamsgo';
import type { RaceTarget } from './core/target';

export interface PickResult {
  competitor: Offer | null;
  /** null nghĩa là KHÔNG đổi giá (mất dấu đối thủ / reset rule quét hết không ai đạt sàn). */
  desired: number | null;
  /** Số candidate bị reset rule bỏ qua ((giá - Price step) < PRICE MIN) trước khi tới được đối thủ. */
  skippedBelowMin: number;
  note: string;
}

/** roundTo(19.267, 2) → 19.27. Nudge bằng Number.EPSILON để tránh sai số float. */
function roundTo(n: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

function excludeSelfAndBlacklist(target: RaceTarget, offers: Offer[]): Offer[] {
  return offers.filter(
    (o) => o.typePlanId !== target.ownTypePlanId && !target.blacklist.includes(o.merchantId)
  );
}

export function pickCompetitor(target: RaceTarget, offers: Offer[]): PickResult {
  const pool = excludeSelfAndBlacklist(target, offers);

  if (target.mode === 'race') {
    const competitor = pool.find((o) => target.sellerIds.includes(o.merchantId)) ?? null;
    if (!competitor) {
      return {
        competitor: null,
        desired: null,
        skippedBelowMin: 0,
        note: `MODE=race: không tìm thấy seller [${target.sellerIds.join(', ')}] còn bán → bỏ qua, không đổi giá`,
      };
    }
    // MODE=race KHÔNG áp PRICE MIN dưới bất kỳ hình thức nào (kể cả clamp) — luôn bám
    // đúng Seller được liệt kê kể cả khi lỗ (đã chốt với người dùng, khác MODE=top).
    return priced(competitor, target, 0, `MODE=race: bám merchant ${competitor.merchantId}`);
  }

  // MODE=top: sort theo SORT đã chọn. Lưu ý: `sorted[0]` (sau reset rule) tự nhiên đóng
  // đúng 2 vai trò tùy tình huống, KHÔNG cần biết mình đang ở rank nào:
  //   - Mình CHƯA phải seller tốt nhất → sorted[0] là đối thủ cần vượt qua.
  //   - Mình ĐÃ là seller tốt nhất (Top 1) → sorted[0] chính là "Top 2" tính cả mình,
  //     nên "sorted[0].price - Price step" vừa giữ mình ở Top 1 vừa nâng biên lợi nhuận.
  // Cùng 1 công thức phục vụ cả 2 case này vì pool đã loại trừ chính mình từ trước.
  const sorted = [...pool].sort((a, b) =>
    target.sortKey === 'price'
      ? a.price - b.price // tăng dần — rẻ nhất trước
      : (b.score ?? -Infinity) - (a.score ?? -Infinity) // giảm dần — tiến cử nhất trước
  );

  // Case: pool rỗng (không seller nào khác đang bán ngoài chính mình) → không đổi giá.
  if (sorted.length === 0) {
    return {
      competitor: null,
      desired: null,
      skippedBelowMin: 0,
      note: `MODE=top SORT=${target.sortKey}: pool rỗng (chỉ mình bán) sau khi loại own-offer/blacklist → bỏ qua, không đổi giá`,
    };
  }

  // Reset rule: chỉ có ý nghĩa khi có PRICE MIN. Không có PRICE MIN → lấy candidate đầu.
  if (target.priceMin === null) {
    const competitor = sorted[0];
    return priced(
      competitor,
      target,
      0,
      `MODE=top SORT=${target.sortKey}: bám #1 (không có PRICE MIN → không áp reset rule)`
    );
  }

  // Bỏ qua candidate nào (giá - Price step) < PRICE MIN — dù có bám cũng không còn margin
  // để đạt sàn. Lấy candidate ĐẦU TIÊN vượt qua test này; nhờ vậy candidate được chọn LUÔN
  // đảm bảo (giá - step) >= PRICE MIN, không cần "clamp lần 2" như bản trước.
  let skipped = 0;
  for (const candidate of sorted) {
    if (candidate.price - target.priceStep < target.priceMin) {
      skipped++;
      continue;
    }
    return priced(
      candidate,
      target,
      skipped,
      skipped > 0
        ? `MODE=top SORT=${target.sortKey}: reset rule bỏ qua ${skipped} candidate có (giá - step) < PRICE MIN, bám #${skipped + 1}`
        : `MODE=top SORT=${target.sortKey}: bám #1`
    );
  }

  // Quét hết mà không ai đạt (giá - step) >= PRICE MIN → GIỮ NGUYÊN giá hiện tại — PRICE
  // MIN không bao giờ được dùng làm giá thật, chỉ làm ngưỡng lọc (khác bản trước, bản đó
  // set cứng giá = PRICE MIN ở case này).
  return {
    competitor: null,
    desired: null,
    skippedBelowMin: skipped,
    note: `MODE=top SORT=${target.sortKey}: reset rule quét hết ${skipped} candidate, không ai có (giá - step) >= PRICE MIN → giữ nguyên, không đổi giá`,
  };
}

function priced(
  competitor: Offer,
  target: RaceTarget,
  skippedBelowMin: number,
  noteBase: string
): PickResult {
  const desired = roundTo(competitor.price - target.priceStep, target.priceStepDecimals);
  return {
    competitor,
    desired,
    skippedBelowMin,
    note: `${noteBase} · đối thủ giá=${competitor.price} merchant=${competitor.merchantId} → giá mới=${desired}`,
  };
}
