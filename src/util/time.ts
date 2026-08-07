/**
 * time.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * `nowUtc7()` — giờ hiện tại theo UTC+7 (giờ VN), dạng "HH:mm:ss DD-MM-YYYY".
 * Dùng chung cho `dev-apply.ts` (cột "Time" của Edit History) và `main.ts` (cùng
 * mục đích trong daemon).
 *
 * Trước đây `dev-apply.ts` tự viết bằng `Date` thuần (tránh thêm dependency chỉ
 * để làm đúng 1 việc này). Từ khi `dayjs` đã là dependency thật của project (cho
 * `util/dashboard.ts`), gom về đây dùng `dayjs` — đúng cách G2G viết
 * (`dayjs.utc().add(7,'hour').format(...)`) — để khỏi duplicate 2 cách tính giờ
 * khác nhau trong cùng 1 codebase.
 */

import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

export function nowUtc7(): string {
  return dayjs.utc().add(7, 'hour').format('HH:mm:ss DD-MM-YYYY');
}
