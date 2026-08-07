/**
 * state.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Lưu/đọc trạng thái daemon ra 1 file JSON (mặc định `state.json` ở cwd) — port
 * từ `util/state.ts` bản G2G, CHỈ giữ `editCount` (số lần đã sửa giá, để hiển thị
 * Dashboard/log).
 *
 * KHÁC G2G: G2G còn giữ `lastApplied` (offerId → giá đã đặt gần nhất) để QUYẾT
 * ĐỊNH có gọi changePrice không, vì `fetchOffers` (`/offer/search`, có
 * `page_size`) có thể KHÔNG trả về offer của chính G2G nếu giá không đủ cạnh
 * tranh để vào top N kết quả — không có gì đáng tin để so sánh ngoài giá trị đã
 * lưu. Gamsgo's `planList` trả TOÀN BỘ merchant của biến thể (không phân trang)
 * — offer của mình LUÔN có trong pool crawl được, nên `main.ts` so `desired` với
 * giá LIVE đọc thẳng từ pool mỗi chu kỳ (giống `dev-apply.ts`), không cần
 * `lastApplied` để gate quyết định — tự "chữa lành" nếu giá bị đổi ngoài (web UI,
 * script khác) mà state.json không biết tới.
 *
 * Lưu theo `ownTypePlanId` nên đổi cấu hình Setup (thêm/bớt dòng) vẫn an toàn —
 * dòng cũ giữ nguyên vết, dòng mới bắt đầu từ trống.
 */

import fs from 'node:fs';
import path from 'node:path';

const STATE_FILE = process.env.STATE_FILE || 'state.json';
const STATE_PATH = path.join(process.cwd(), STATE_FILE);

export interface RaceState {
  /** ownTypePlanId → số lần đã sửa giá. */
  editCount: Record<string, number>;
}

export function loadState(): RaceState {
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return {
      editCount:
        data?.editCount && typeof data.editCount === 'object' ? data.editCount : {},
    };
  } catch {
    return { editCount: {} };
  }
}

/** Ghi đè state ra file (ghi tạm rồi rename để tránh file hỏng nếu crash giữa chừng). */
export function saveState(state: RaceState): void {
  try {
    const tmp = `${STATE_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, STATE_PATH);
  } catch {
    // Lỗi ghi state không được làm chết tiến trình bám giá — bỏ qua, lần sau ghi lại.
  }
}
