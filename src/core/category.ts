/**
 * category.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Resolve `LINK CRAWL` (URL trang category, vd
 * https://www.gamsgo.com/top-up/honkai-star-rail) → `type_category_id` (UUID)
 * cần cho `POST /index/planList`.
 *
 * LINK CRAWL không chứa UUID trực tiếp — chỉ có 2 segment cuối path dạng
 * `/<user_route>/<list_route>` (đã xác nhận bằng dữ liệu thật). Resolve qua API
 * `POST /index/typeCategory` (KHÔNG cần parse HTML/Nuxt payload).
 */

import { requestJson, type RequestOptions } from './http';

const TYPE_CATEGORY_URL = 'https://mapi.gamsgo2.com/index/typeCategory';

export interface TypeCategoryEntry {
  type_category_id: string;
  category_id?: string;
  list_route: string;
  user_route: string; // dạng "/top-up" (có dấu / ở đầu)
  name?: string;
  category_name?: string;
}

/** Tách 2 segment cuối path của LINK CRAWL: userRoute (không dấu /) + listRoute. */
export function parseLinkCrawl(
  linkCrawl: string
): { userRoute: string; listRoute: string } | null {
  const m = (linkCrawl || '').match(/\/([^/?#]+)\/([^/?#]+)\/?(?:[?#].*)?$/);
  if (!m) return null;
  return { userRoute: m[1], listRoute: m[2] };
}

// Cache theo LINK CRAWL — category gần như bất biến, KHÔNG hết hạn ở Phase 1 (khỏi
// gọi lại API mỗi chu kỳ 20s cho cùng 1 LINK CRAWL).
const cache = new Map<string, string>();

/**
 * Resolve LINK CRAWL → type_category_id. Ném lỗi rõ ràng nếu không tách được
 * userRoute/listRoute từ URL, hoặc API không trả entry khớp CẢ HAI field
 * (list_route + user_route) — không đoán mò lấy data[0].
 */
export async function resolveTypeCategoryId(
  linkCrawl: string,
  opts: RequestOptions = {}
): Promise<string> {
  const cached = cache.get(linkCrawl);
  if (cached) return cached;

  const parsed = parseLinkCrawl(linkCrawl);
  if (!parsed) {
    throw new Error(
      `LINK CRAWL không đúng khuôn https://www.gamsgo.com/<user_route>/<list_route>: "${linkCrawl}"`
    );
  }
  const { userRoute, listRoute } = parsed;

  const resp = await requestJson(
    TYPE_CATEGORY_URL,
    {},
    {
      ...opts,
      method: 'POST',
      body: { language: 'en', show_currency: 'USD', list_route: listRoute },
    }
  );

  const entries: TypeCategoryEntry[] = Array.isArray(resp?.data) ? resp.data : [];
  const match = entries.find(
    (e) => e.list_route === listRoute && e.user_route === `/${userRoute}`
  );

  if (!match) {
    const found = entries
      .map((e) => `${e.user_route}/${e.list_route}`)
      .join(', ');
    throw new Error(
      `Không tìm thấy category khớp "/${userRoute}/${listRoute}" trong typeCategory. ` +
        `Các entry API trả về: [${found || 'rỗng'}]. Kiểm tra LINK CRAWL.`
    );
  }

  cache.set(linkCrawl, match.type_category_id);
  return match.type_category_id;
}
