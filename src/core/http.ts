/**
 * http.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * GET/POST có retry + proxy fallback + timeout, dùng undici (tương thích Bun).
 * PHỎNG THEO core/http.ts của x-raceprce-g2g-zerogap, nhưng bỏ phần
 * onUnauthorized/401-refresh: Phase 1 chỉ gọi các endpoint ẨN DANH của GamsGo
 * (`typeCategory`, `planList`) — chưa cần auth/cookie. Sẽ bổ sung lại khi Phase 2
 * (sửa giá) cần authorization.
 */

import { fetch, ProxyAgent } from 'undici';

const DEFAULT_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);

// Header dùng chung cho MỌI request GamsGo (mapi.gamsgo2.com) — lấy nguyên từ curl
// thật đã bắt được trên trình duyệt, để giả lập request thật càng giống càng tốt.
export const GAMSGO_SHARED_HEADERS: Record<string, string> = {
  accept: 'application/json',
  'accept-language': 'vi,en-US;q=0.9,en;q=0.8',
  origin: 'https://www.gamsgo.com',
  referer: 'https://www.gamsgo.com/',
  'user-agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
  'sec-ch-ua': '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Linux"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'cross-site',
};

function getProxyList(): string[] {
  // Phase 1 chưa cần đọc proxys/proxy.txt (chưa polling liên tục ngoài dev-test) —
  // để hàm rỗng sẵn chỗ, tránh phải sửa requestJson khi bổ sung sau.
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Lỗi HTTP XÁC ĐỊNH (4xx trừ 403/429) — KHÔNG retry, kèm status + body đã parse
 * (nếu là JSON) để caller đọc `code`/`message` của GamsGo.
 */
export class NonRetryableError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: any
  ) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface RequestOptions {
  timeoutMs?: number;
  /** Method HTTP (mặc định GET). GamsGo dùng POST cho cả typeCategory/planList. */
  method?: string;
  /** Body (object → JSON). Khi có body sẽ tự thêm content-type: application/json. */
  body?: unknown;
}

/**
 * Gọi JSON với retry + proxy fallback trên 403/429 + timeout. `headers` được merge
 * lên trên GAMSGO_SHARED_HEADERS (có thể override token/referer riêng theo call).
 */
export async function requestJson(
  url: string,
  headers: Record<string, string> = {},
  opts: RequestOptions = {}
): Promise<any> {
  const proxies = getProxyList();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = proxies.length > 0 ? 3 : 2;
  const method = opts.method ?? 'GET';
  const hasBody = opts.body !== undefined && opts.body !== null;
  const bodyStr = hasBody ? JSON.stringify(opts.body) : undefined;
  const bodyHeaders = hasBody ? { 'content-type': 'application/json' } : {};

  let useProxy = false;
  let lastError: any = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let dispatcher: ProxyAgent | undefined;
    if (useProxy && proxies.length > 0) {
      const randomProxy = proxies[Math.floor(Math.random() * proxies.length)];
      dispatcher = new ProxyAgent(randomProxy);
    }

    try {
      const response = await fetch(url, {
        method,
        headers: {
          ...GAMSGO_SHARED_HEADERS,
          ...bodyHeaders,
          ...headers,
        },
        body: bodyStr,
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 403 || response.status === 429) {
        if (proxies.length > 0) {
          useProxy = true;
          await sleep(2000);
          continue;
        }
        throw new Error(`Bị chặn (Status ${response.status}) và không có proxy thay thế.`);
      }

      // 4xx còn lại — lỗi XÁC ĐỊNH, ném ngay, KHÔNG retry.
      if (response.status >= 400 && response.status < 500) {
        const text = await response.text().catch(() => '');
        let body: any = text || null;
        try {
          if (text) body = JSON.parse(text);
        } catch {
          /* giữ nguyên text nếu không phải JSON */
        }
        throw new NonRetryableError(
          `HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
          response.status,
          body
        );
      }

      if (!response.ok) {
        throw new Error(`Server trả lỗi HTTP: ${response.status}`);
      }

      const text = await response.text();
      if (!text) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    } catch (error: any) {
      if (error instanceof NonRetryableError) throw error;
      lastError = error;
      if (attempt < maxAttempts - 1) {
        await sleep(2000);
        useProxy = proxies.length > 0;
        continue;
      }
    }
  }

  throw lastError || new Error('Thất bại sau nhiều lần thử không rõ nguyên nhân.');
}
