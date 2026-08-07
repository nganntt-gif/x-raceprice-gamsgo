/**
 * x-raceprice-gamsgo — main.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Daemon BÁM GIÁ (race-price) GamsGo: đọc tab "Setup" trong Google Sheet, với
 * mỗi dòng bật (`CHECK=1`) thì cứ `POLL_INTERVAL_SECONDS` giây lại dò giá đối thủ
 * và sửa giá của mình theo đúng logic `pick.ts` (MODE top/race + reset rule).
 * Mỗi lần sửa giá THẬT ghi 1 dòng vào tab "Edit History" + bắn Telegram.
 *
 * Mirror cấu trúc `main.ts` bản `x-raceprce-g2g-zerogap`, khác 3 điểm có chủ đích
 * (xem plan lúc build — ghi lại ở đây để không ai tưởng thiếu logic):
 *
 *   1. KHÔNG dùng `lastApplied`/state.json để quyết định "có sửa giá không". G2G
 *      phải làm vậy vì `/offer/search` có `page_size` — offer của G2G có thể
 *      không lọt vào top N nếu giá không đủ cạnh tranh. `planList` của GamsGo trả
 *      TOÀN BỘ merchant của biến thể (không phân trang) — offer của mình LUÔN có
 *      trong pool crawl được, nên so `desired` với giá LIVE đọc thẳng từ pool mỗi
 *      chu kỳ (giống `dev-apply.ts`) — tự "chữa lành" nếu giá bị đổi ngoài (web
 *      UI, script khác) mà state.json không biết tới. `state.json` ở đây CHỈ giữ
 *      `editCount` để hiển thị, không gate quyết định gì.
 *   2. Token TĨNH, không có refresh flow (khác `RefreshTokenError` +
 *      `POST /user/refresh_access` của G2G). Đọc 1 LẦN lúc boot; lỗi 401/403 giữa
 *      chu kỳ (`NonRetryableError.status`) coi là FATAL — không thể tự phục hồi
 *      như G2G refresh được → log rõ + Telegram + `process.exit(1)`, người vận
 *      hành export cookies mới rồi khởi động lại.
 *   3. Dùng `Dashboard` (khung terminal, chỉ hợp với process sống liên tục) —
 *      `dev-test.ts`/`dev-apply.ts` vẫn giữ `console.log` (script chạy 1 lần).
 *
 * 100% REST API, KHÔNG browser. Mọi output đi qua `Dashboard` — không console.log.
 */

import * as dotenv from 'dotenv';
dotenv.config();
import fs from 'node:fs';

import { loadConfig } from './util/config';
import { Dashboard } from './util/dashboard';
import { loadState, saveState } from './util/state';
import { sendNoti } from './util/noti';
import { nowUtc7 } from './util/time';
import { readSetupRows, appendEditHistory, SPREADSHEET_ID } from './core/sheets';
import { getAuthToken } from './core/auth';
import { resolveTypeCategoryId } from './core/category';
import { fetchOffers, editPlanInfo, clearPlanListCache } from './core/gamsgo';
import { NonRetryableError } from './core/http';
import { pickCompetitor } from './pick';
import { parseTarget, isRowEnabled, type RaceTarget } from './core/target';

const cfg = loadConfig();

// Token đọc 1 LẦN lúc boot — KHÔNG refresh giữa chừng (khác G2G, xem điểm khác biệt #2).
let token = '';

// editCount nạp từ state.json lúc khởi động, lưu lại sau mỗi lần sửa giá thành công.
const _persisted = loadState();
const editCount: Map<string, number> = new Map(Object.entries(_persisted.editCount));

function persistState(): void {
  saveState({ editCount: Object.fromEntries(editCount) });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtPrice(n: number | null | undefined): string {
  return n === null || n === undefined ? '-' : String(n);
}

/**
 * Escape ký tự đặc biệt HTML (& < >) để nhúng AN TOÀN giá trị động vào tin nhắn
 * Telegram (gateway gửi parse_mode=HTML) — mirror đúng helper đã dùng ở
 * `dev-apply.ts`/`main.ts` bản G2G.
 */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * True nếu lỗi là dấu hiệu rõ ràng "token đã chết" (401/403 từ chính GamsGo) —
 * FATAL với daemon này vì KHÔNG có cách tự phục hồi (không có login/refresh API
 * tìm được) — khác G2G có `RefreshTokenError.fatal` để tự refresh trước.
 */
function isAuthDeadError(err: unknown): boolean {
  return err instanceof NonRetryableError && (err.status === 401 || err.status === 403);
}

async function processTarget(target: RaceTarget): Promise<void> {
  const id = target.ownTypePlanId;

  let offers;
  try {
    const typeCategoryId = await resolveTypeCategoryId(target.linkCrawl);
    offers = await fetchOffers(typeCategoryId, target.typePlanImage);
  } catch (err: any) {
    Dashboard.updateTarget(id, { status: 'ERROR', info: 'lỗi dò giá' });
    Dashboard.error('CRAWL', `[${target.name}] ${err?.message || err}`);
    return;
  }

  const ownOffer = offers.find((o) => o.typePlanId === id);
  if (!ownOffer) {
    Dashboard.updateTarget(id, { status: 'ERROR', info: 'không thấy offer mình' });
    Dashboard.error(
      'CRAWL',
      `[${target.name}] không tìm thấy offer của mình (ownTypePlanId=${id}) trong pool — kiểm tra LINK EDIT/LINK IMAGE.`
    );
    return;
  }
  const currentPrice = ownOffer.price;

  const result = pickCompetitor(target, offers);
  Dashboard.updateTarget(id, {
    competitor: fmtPrice(result.competitor?.price ?? null),
    myPrice: fmtPrice(currentPrice),
  });

  if (result.desired === null) {
    Dashboard.updateTarget(id, { status: 'SKIP', info: result.note });
    return;
  }

  if (result.desired === currentPrice) {
    Dashboard.updateTarget(id, { status: 'WATCHING', info: 'giá đã khớp' });
    return;
  }

  // Giá khác → sửa thật. Lỗi ở đây được RETHROW để runCycle() phân loại
  // fatal/không (isAuthDeadError) — không bắt nuốt tại đây.
  try {
    await editPlanInfo(id, result.desired, token);
  } catch (err: any) {
    Dashboard.updateTarget(id, { status: 'ERROR', info: 'sửa giá lỗi' });
    Dashboard.error('EDIT', `[${target.name}] ${err?.message || err}`);
    throw err;
  }

  const edits = (editCount.get(id) ?? 0) + 1;
  editCount.set(id, edits);
  persistState();

  Dashboard.updateTarget(id, {
    status: 'EDITED',
    myPrice: fmtPrice(result.desired),
    edits,
    info: result.note,
  });
  Dashboard.log(
    'EDIT',
    `[${target.name}] ${fmtPrice(currentPrice)} → ${result.desired} (${result.note})`
  );

  const at = nowUtc7();

  // Ghi Edit History — AWAIT (mirror G2G), có try/catch RIÊNG: giá THẬT đã đổi
  // thành công rồi, lỗi ghi Sheet ở đây chỉ là lỗi audit-log, không chặn cycle.
  try {
    await appendEditHistory(cfg.editHistorySheet, [
      target.game,
      target.service,
      target.name,
      currentPrice,
      result.desired,
      result.competitor?.merchantName || result.competitor?.merchantId || '',
      result.note,
      at,
    ]);
  } catch (err: any) {
    Dashboard.error(
      'SHEETS',
      `Ghi Edit History lỗi (giá đã đổi thật): ${err?.message || err}`
    );
  }

  // Bắn Telegram — fire-and-forget (`void`, KHÔNG `await`) — daemon sống liên
  // tục nên an toàn, khác `dev-apply.ts` phải await (script chạy 1 lần rồi thoát).
  const sortLine = target.mode === 'top' ? ` · Sort: <b>${target.sortKey}</b>` : '';
  const competitorName = result.competitor?.merchantName || 'không rõ tên';
  const priceMinText = target.priceMin !== null ? String(target.priceMin) : 'không có';
  void sendNoti(
    `✅ <b>Đã sửa giá GamsGo</b>\n` +
      `- Service: ${escapeHtml(target.service)}\n` +
      `- Game: ${escapeHtml(target.game)}\n` +
      `- Name: ${escapeHtml(target.name)}\n` +
      `- Mode: <b>${target.mode}</b>${sortLine}\n` +
      `- Giá cũ: <b><i>${currentPrice} USD</i></b> -> Giá mới: <b><i>${result.desired}</i></b> ` +
      `(Mức giá min có thể chịu: ${priceMinText})\n` +
      `- Đối thủ: ${escapeHtml(competitorName)}\n` +
      `- Thời gian: ${at} (UTC+7)\n` +
      `- LINK: ${escapeHtml(target.linkCrawl)}`
  );
}

// Cache tab Setup để tránh spam read Sheets API mỗi chu kỳ. Chỉ đọc lại sau
// setupCacheSeconds; lỗi đọc thì giữ cache cũ (nếu đã có ít nhất 1 lần).
let cachedTargets: RaceTarget[] = [];
let setupLoadedAt = 0;

async function loadTargets(): Promise<RaceTarget[]> {
  const ttl = cfg.setupCacheSeconds * 1000;
  if (setupLoadedAt > 0 && Date.now() - setupLoadedAt < ttl) {
    return cachedTargets;
  }

  let rows;
  try {
    rows = await readSetupRows(cfg.setupSheet);
  } catch (err: any) {
    if (setupLoadedAt > 0) {
      Dashboard.error('SETUP', `Đọc Setup lỗi, dùng cache: ${err?.message || err}`);
      return cachedTargets;
    }
    throw err; // chưa có cache lần nào → để runCycle xử lý (bỏ qua chu kỳ)
  }

  const targets: RaceTarget[] = [];
  for (const row of rows) {
    if (!isRowEnabled(row)) continue;
    const { target, error, warnings } = parseTarget(row);
    if (warnings) {
      for (const w of warnings) Dashboard.error('SETUP', w);
    }
    if (error) {
      Dashboard.error('SETUP', error);
      continue;
    }
    if (target) targets.push(target);
  }

  cachedTargets = targets;
  setupLoadedAt = Date.now();
  Dashboard.setTargets(targets.map((t) => ({ id: t.ownTypePlanId, name: t.name || t.ownTypePlanId })));
  Dashboard.log(
    'SETUP',
    `Đã nạp ${targets.length} dòng từ "${cfg.setupSheet}" (cache ${cfg.setupCacheSeconds}s)`
  );
  return targets;
}

async function runCycle(): Promise<void> {
  // Xoá cache planList NGAY ĐẦU mỗi chu kỳ — bắt buộc (xem cảnh báo trong
  // core/gamsgo.ts). Thiếu bước này, giá đối thủ sẽ đông cứng ở lần fetch đầu.
  clearPlanListCache();

  let targets: RaceTarget[];
  try {
    targets = await loadTargets();
  } catch (err: any) {
    Dashboard.error('SETUP', `Đọc tab Setup lỗi: ${err?.message || err}`);
    return;
  }

  if (targets.length === 0) {
    Dashboard.setPhase('POLLING');
    Dashboard.log('SETUP', 'Không có dòng nào bật (CHECK=1).');
    return;
  }

  Dashboard.setPhase('POLLING');
  for (const target of targets) {
    try {
      await processTarget(target);
    } catch (err: any) {
      if (isAuthDeadError(err)) {
        Dashboard.error(
          'AUTH',
          `FATAL: token chết giữa chu kỳ (${err?.message || err}) — dừng daemon, export lại cookies rồi khởi động lại.`
        );
        await sendNoti(
          `🛑 <b>Gamsgo daemon DỪNG — token chết</b>\nExport lại file cookies (${escapeHtml(cfg.cookiesFile)}) rồi khởi động lại.`
        );
        await sleep(1500);
        process.exit(1);
      }
      Dashboard.updateTarget(target.ownTypePlanId, { status: 'ERROR' });
      Dashboard.error('CYCLE', `[${target.name}] ${err?.message || err}`);
    }
  }
}

async function loop(): Promise<void> {
  while (true) {
    try {
      await runCycle();
    } catch (err: any) {
      Dashboard.error('SYSTEM', `Lỗi chu kỳ: ${err?.message || err}`);
    }
    const nextAt = Date.now() + cfg.pollIntervalSeconds * 1000;
    Dashboard.setPhase('SLEEPING', nextAt);
    await sleep(cfg.pollIntervalSeconds * 1000);
  }
}

function bootstrap(): void {
  Dashboard.setTitle(cfg.cookiesFile);
  Dashboard.log('SYSTEM', 'Khởi động race-price...');

  if (!SPREADSHEET_ID) {
    Dashboard.error('SYSTEM', 'Thiếu SPREADSHEET_ID trong .env');
    process.exit(1);
  }
  if (!fs.existsSync(cfg.cookiesPath)) {
    Dashboard.error('SYSTEM', `Không tìm thấy file cookies: ${cfg.cookiesPath}`);
    process.exit(1);
  }

  try {
    token = getAuthToken(cfg.cookiesPath);
  } catch (err: any) {
    Dashboard.error('AUTH', `FATAL: ${err?.message || err}`);
    process.exit(1);
  }
  Dashboard.log('AUTH', `Token đã nạp từ ${cfg.cookiesFile} (tĩnh, không tự refresh).`);

  Dashboard.log(
    'SYSTEM',
    `Poll mỗi ${cfg.pollIntervalSeconds}s · Setup="${cfg.setupSheet}" · Log="${cfg.editHistorySheet}"`
  );

  const cacheMins = Math.round(cfg.setupCacheSeconds / 60);
  void sendNoti(
    `🚀 <b>X-RacePrice-Gamsgo is running</b>\n— Reading Setup and auto-updating prices to follow the top competitor.\n` +
      `⏱ Poll every ${cfg.pollIntervalSeconds}s · Setup reload every ${cacheMins} min.\n` +
      `📁 ${escapeHtml(cfg.cookiesFile)}`
  );

  loop();
}

bootstrap();
