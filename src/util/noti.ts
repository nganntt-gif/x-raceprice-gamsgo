/**
 * noti.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Gửi tin nhắn Telegram qua noti gateway (noti.hqwg.pro) — port nguyên từ
 * `util/noti.ts` bản G2G, chỉ đổi `Dashboard.error` → `console.log` (Gamsgo chưa
 * có Dashboard, xem "Known gaps" trong ARCHITECTURE.md).
 *
 * Cấu hình CỐ ĐỊNH qua .env:
 *   NOTI_API_KEY  — Bearer token do noti gateway cấp.
 *   NOTI_CHANNEL  — channel (đã route sẵn tới nhóm Telegram cần bắn).
 * Thiếu 1 trong 2 → bỏ qua im lặng (không cấu hình thì không bắn). Mọi lỗi gửi
 * được nuốt + log ra console, KHÔNG làm chết tiến trình gọi nó.
 */

import { fetch } from 'undici';

const NOTI_API_URL = 'https://noti.hqwg.pro/api/v1';
const FETCH_TIMEOUT_MS = 10_000;

/** True nếu đã cấu hình đủ NOTI_API_KEY + NOTI_CHANNEL. */
export function isNotiConfigured(): boolean {
  return !!process.env.NOTI_API_KEY && !!process.env.NOTI_CHANNEL;
}

/**
 * Gửi 1 tin nhắn text (hỗ trợ Telegram HTML — `parse_mode=HTML` ở phía gateway)
 * tới channel cấu hình trong .env. Trả về true nếu gửi thành công.
 */
export async function sendNoti(content: string): Promise<boolean> {
  const apiKey = process.env.NOTI_API_KEY ?? '';
  const channel = process.env.NOTI_CHANNEL ?? '';
  if (!apiKey || !channel) return false; // chưa cấu hình → bỏ qua im lặng

  try {
    const res = await fetch(`${NOTI_API_URL}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        content,
        priority: 'normal',
        disable_web_page_preview: true,
        link_preview_options: { is_disabled: true },
      }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.log(`[NOTI] gửi thất bại (${res.status}): ${text.slice(0, 100)}`);
      return false;
    }
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`[NOTI] lỗi: ${msg}`);
    return false;
  }
}
