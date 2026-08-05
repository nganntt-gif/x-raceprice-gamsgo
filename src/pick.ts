/**
 * pick.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * pickCompetitor(): chọn đối thủ + tính giá mới từ pool offer đã crawl, theo
 * bảng MODE/SORT đã chốt (xem plan) + "reset rule" kiểu G2G cho MODE=top:
 *
 *   MODE=top,  SORT=price     → đối thủ = giá NHỎ NHẤT trong pool
 *   MODE=top,  SORT=recommend → đối thủ = score (sort_lcb_score) LỚN NHẤT
 *   MODE=race                 → đối thủ = merchant khớp cột Seller (không reset rule)
 *
 * Reset rule (CHỈ áp cho MODE=top, cả 2 SORT): duyệt candidate theo thứ tự
 * (giá tăng dần / score giảm dần), BỎ QUA candidate có price < PRICE MIN, lấy
 * candidate ĐẦU TIÊN có price >= PRICE MIN. Quét hết mà không ai đạt ⇒ KHÔNG
 * fallback về PRICE MIN — bỏ qua dòng, không đổi giá (khác G2G, đã chốt với
 * người dùng). PRICE MIN chỉ đóng đúng 1 vai trò: sàn clamp SAU KHI đã có đối
 * thủ hợp lệ (raw = competitor.price - priceStep có thể vẫn hụt dưới sàn).
 */

import type { Offer } from './core/gamsgo';
import type { RaceTarget } from './core/target';

export interface PickResult {
  competitor: Offer | null;
  /** null nghĩa là KHÔNG đổi giá (mất dấu đối thủ / reset rule quét hết không ai đạt sàn). */
  desired: number | null;
  /** Số candidate bị reset rule bỏ qua (giá < PRICE MIN) trước khi tới được đối thủ. */
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
    return finalize(target, competitor, 0, `MODE=race: bám merchant ${competitor.merchantId}`);
  }

  // MODE=top: sort theo SORT đã chọn.
  const sorted = [...pool].sort((a, b) =>
    target.sortKey === 'price'
      ? a.price - b.price // tăng dần — rẻ nhất trước
      : (b.score ?? -Infinity) - (a.score ?? -Infinity) // giảm dần — tiến cử nhất trước
  );

  if (sorted.length === 0) {
    return {
      competitor: null,
      desired: null,
      skippedBelowMin: 0,
      note: `MODE=top SORT=${target.sortKey}: pool rỗng sau khi loại own-offer/blacklist → bỏ qua, không đổi giá`,
    };
  }

  // Reset rule: chỉ có ý nghĩa khi có PRICE MIN. Không có PRICE MIN → lấy candidate đầu.
  if (target.priceMin === null) {
    const competitor = sorted[0];
    return finalize(
      target,
      competitor,
      0,
      `MODE=top SORT=${target.sortKey}: bám #1 (không có PRICE MIN → không áp reset rule)`
    );
  }

  let skipped = 0;
  for (const candidate of sorted) {
    if (candidate.price < target.priceMin) {
      skipped++;
      continue;
    }
    return finalize(
      target,
      candidate,
      skipped,
      skipped > 0
        ? `MODE=top SORT=${target.sortKey}: reset rule bỏ qua ${skipped} candidate < PRICE MIN, bám #${skipped + 1}`
        : `MODE=top SORT=${target.sortKey}: bám #1`
    );
  }

  // Quét hết mà không ai >= PRICE MIN → bỏ qua, KHÔNG fallback về PRICE MIN (đã chốt).
  return {
    competitor: null,
    desired: null,
    skippedBelowMin: skipped,
    note: `MODE=top SORT=${target.sortKey}: reset rule quét hết ${skipped} candidate, không ai >= PRICE MIN → bỏ qua, không đổi giá`,
  };
}

function finalize(
  target: RaceTarget,
  competitor: Offer,
  skippedBelowMin: number,
  noteBase: string
): PickResult {
  const raw = competitor.price - target.priceStep;
  const floored = target.priceMin !== null && raw < target.priceMin ? target.priceMin : raw;
  const desired = roundTo(floored, target.priceStepDecimals);
  const clampNote = floored !== raw ? ` (raw ${raw} < PRICE MIN → dùng PRICE MIN)` : '';
  return {
    competitor,
    desired,
    skippedBelowMin,
    note: `${noteBase} · đối thủ giá=${competitor.price} merchant=${competitor.merchantId} → giá mới=${desired}${clampNote}`,
  };
}
