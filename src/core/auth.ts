/**
 * auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Đọc `token` xác thực cho `POST /product/editPlanInfo` từ file cookies export
 * từ browser (Playwright storageState: `cookies[]` + `origins[].localStorage[]`).
 *
 * Đơn giản hơn `core/auth.ts` bản G2G: đã xác nhận bằng file cookies thật —
 * token nằm NGAY trong `cookies[]`, là cookie tên `token` (domain
 * `.gamsgo.com`) — KHÔNG cần đào `localStorage` như G2G phải làm với
 * `accessToken`. `has_login` cũng là 1 cookie thường trong file, dùng để báo
 * sớm nếu file cookies là 1 session đã đăng xuất.
 *
 * Phase 2 hiện tại: token TĨNH theo file cookies, KHÔNG có login/refresh flow
 * (khác G2G, bản đó tự refresh accessToken qua API). Token hết hạn ⇒ phải export
 * lại file cookies mới từ browser đã đăng nhập, ghi đè vào đúng `COOKIES_FILE`.
 */

import fs from 'node:fs';

interface RawCookie {
  name?: string;
  value?: string;
  domain?: string;
}

interface StorageState {
  cookies?: RawCookie[];
}

/**
 * Đọc file cookies tại `cookiesPath`, trả về giá trị cookie `token` cho
 * gamsgo.com. Ném lỗi rõ ràng (kèm danh sách cookie thật có) nếu file thiếu,
 * hỏng, không có cookie `token`, hoặc session đã đăng xuất (`has_login=0`) —
 * không bao giờ đoán mò hay trả giá trị rỗng âm thầm.
 */
export function getAuthToken(cookiesPath: string): string {
  if (!fs.existsSync(cookiesPath)) {
    throw new Error(
      `Không tìm thấy file cookies tại ${cookiesPath} — export cookies từ browser đã đăng nhập ` +
        `gamsgo.com (Playwright storageState hoặc extension export cookies) và đặt vào đúng đường dẫn này.`
    );
  }

  let state: StorageState;
  try {
    state = JSON.parse(fs.readFileSync(cookiesPath, 'utf-8'));
  } catch (err: any) {
    throw new Error(`File cookies ${cookiesPath} không phải JSON hợp lệ: ${err?.message || err}`);
  }

  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  const tokenCookie = cookies.find(
    (c) => c.name === 'token' && String(c.domain || '').includes('gamsgo.com')
  );

  if (!tokenCookie?.value) {
    const found = cookies.map((c) => c.name).filter(Boolean).join(', ');
    throw new Error(
      `File cookies ${cookiesPath} không có cookie "token" cho gamsgo.com — export lại từ browser ` +
        `đã đăng nhập. Cookie hiện có trong file: [${found || 'rỗng'}]`
    );
  }

  const hasLogin = cookies.find((c) => c.name === 'has_login')?.value;
  if (hasLogin === '0') {
    throw new Error(
      `File cookies ${cookiesPath} có cookie has_login=0 — session này chưa đăng nhập (hoặc đã đăng ` +
        `xuất). Đăng nhập lại gamsgo.com trên browser rồi export file cookies mới.`
    );
  }

  return tokenCookie.value;
}
