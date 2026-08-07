/**
 * dev-apply.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Script sửa giá THẬT cho 1 dòng Setup — khác `dev-test.ts` (script đó 100%
 * read-only). Chạy đúng pipeline crawl + tính giá của `dev-test.ts`, in ra diff
 * (giá hiện tại → giá mới), rồi CHỈ gọi `editPlanInfo()` (mutate giá thật trên
 * GamsGo) khi có cờ `--yes` — mặc định luôn là dry-run để không bao giờ lỡ tay
 * sửa giá thật.
 *
 * Chạy: bun run src/dev-apply.ts <rowIndex>            (dry-run, in diff)
 *       bun run src/dev-apply.ts <rowIndex> --yes       (sửa giá THẬT)
 *
 * `rowIndex` là số dòng trên Google Sheet (1-based, cột A) — xem cột đầu output
 * của `dev-test.ts` (=== Dòng N: ... ===) để biết đúng số.
 */

import { loadConfig } from './util/config';
import { readSetupRows, appendEditHistory, SPREADSHEET_ID } from './core/sheets';
import { getAuthToken } from './core/auth';
import { resolveTypeCategoryId } from './core/category';
import { fetchOffers, editPlanInfo } from './core/gamsgo';
import { pickCompetitor } from './pick';
import { parseTarget, isRowEnabled } from './core/target';
import { sendNoti } from './util/noti';
import { nowUtc7 } from './util/time';

/**
 * Escape ký tự đặc biệt HTML (& < >) để nhúng AN TOÀN giá trị động (tên game/
 * service/note/URL có thể chứa `&`...) vào tin nhắn Telegram (gateway gửi
 * parse_mode=HTML) — mirror đúng helper G2G định nghĩa trong `main.ts` (không
 * phải trong `noti.ts`). KHÔNG áp cho chuỗi có thẻ `<b>`/`<i>` cố định trong
 * template. Bỏ escape → 1 ký tự `<`/`&` lọt vào là Telegram báo lỗi parse và bỏ
 * NGUYÊN tin nhắn.
 */
function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function main() {
  const rowIndexArg = process.argv[2];
  const apply = process.argv.includes('--yes');
  const rowIndex = Number(rowIndexArg);

  if (!rowIndexArg || !Number.isInteger(rowIndex) || rowIndex < 2) {
    console.log(
      'Dùng: bun run src/dev-apply.ts <rowIndex> [--yes]\n' +
        '  <rowIndex> = số dòng trên Google Sheet (xem output "=== Dòng N: ..." của dev-test.ts).'
    );
    process.exit(1);
  }

  if (!SPREADSHEET_ID) {
    console.log('LỖI: thiếu SPREADSHEET_ID (hoặc GOOGLE_SPREADSHEET_ID) trong .env.');
    process.exit(1);
  }

  const cfg = loadConfig();

  // Đọc token TRƯỚC KHI crawl gì cả — fail sớm, rõ ràng nếu file cookies thiếu/hỏng/
  // hết hạn, không tốn công gọi Sheets + GamsGo rồi mới báo lỗi ở bước cuối.
  let token: string;
  try {
    token = getAuthToken(cfg.cookiesPath);
  } catch (err: any) {
    console.log(`LỖI đọc token: ${err?.message || err}`);
    process.exit(1);
  }

  let rows;
  try {
    rows = await readSetupRows(cfg.setupSheet);
  } catch (err: any) {
    console.log(`LỖI đọc tab "${cfg.setupSheet}": ${err?.message || err}`);
    process.exit(1);
  }

  const row = rows.find((r) => r.rowIndex === rowIndex);
  if (!row) {
    console.log(
      `Không tìm thấy dòng ${rowIndex} trong tab "${cfg.setupSheet}" (đã đọc ${rows.length} dòng).`
    );
    process.exit(1);
  }

  console.log(`=== Dòng ${row.rowIndex}: ${row.game} / ${row.name} ===`);

  if (!isRowEnabled(row)) {
    console.log('CHECK != 1 → bỏ qua, không sửa giá.');
    return;
  }

  const { target, error, warnings } = parseTarget(row);
  if (warnings) {
    for (const w of warnings) console.log(`⚠️  ${w}`);
  }
  if (error || !target) {
    console.log(`LỖI parseTarget: ${error}`);
    process.exit(1);
  }

  const typeCategoryId = await resolveTypeCategoryId(target.linkCrawl);
  const offers = await fetchOffers(typeCategoryId, target.typePlanImage);

  const ownOffer = offers.find((o) => o.typePlanId === target.ownTypePlanId);
  if (!ownOffer) {
    console.log(
      `LỖI: không tìm thấy offer của chính mình (ownTypePlanId=${target.ownTypePlanId}) trong pool ` +
        `— kiểm tra lại LINK EDIT/LINK IMAGE của dòng này.`
    );
    process.exit(1);
  }
  const currentPrice = ownOffer.price;

  const result = pickCompetitor(target, offers);
  console.log(`→ ${result.note}`);
  console.log(`Giá hiện tại: ${currentPrice}`);

  if (result.desired === null) {
    console.log('→ Không đổi giá (xem lý do ở note trên).');
    return;
  }

  console.log(`Giá mới tính được: ${result.desired}`);

  if (result.desired === currentPrice) {
    console.log('→ Giá đã khớp, không cần sửa.');
    return;
  }

  console.log(`→ SẼ SỬA GIÁ: ${currentPrice} → ${result.desired}`);

  if (!apply) {
    console.log('Thêm --yes vào cuối lệnh để sửa giá THẬT trên GamsGo (hành động không đảo ngược).');
    return;
  }

  try {
    const res = await editPlanInfo(target.ownTypePlanId, result.desired, token);
    console.log(`✅ Đã sửa giá thật cho type_plan_id=${res.typePlanId} → ${result.desired}`);
  } catch (err: any) {
    console.log(`LỖI sửa giá: ${err?.message || err}`);
    process.exit(1);
  }

  // Ghi log Edit History — TÁCH RIÊNG try/catch với editPlanInfo ở trên: giá THẬT
  // đã đổi thành công rồi, lỗi ghi Sheet ở đây chỉ là lỗi audit-log, KHÔNG nên làm
  // exit(1) toàn bộ script (dễ hiểu lầm là sửa giá thất bại).
  try {
    await appendEditHistory(cfg.editHistorySheet, [
      target.game,
      target.service,
      target.name,
      currentPrice, // Price Before — giá TRƯỚC khi sửa (đọc live trước lúc gọi editPlanInfo)
      result.desired, // Price After — giá SAU khi sửa (chính giá đã gửi lên editPlanInfo)
      result.competitor?.merchantName || result.competitor?.merchantId || '',
      result.note,
      nowUtc7(),
    ]);
    console.log(`📝 Đã ghi log vào tab "${cfg.editHistorySheet}".`);
  } catch (err: any) {
    console.log(
      `⚠️  CẢNH BÁO: giá đã đổi thật, nhưng ghi log vào tab "${cfg.editHistorySheet}" bị lỗi: ` +
        `${err?.message || err}`
    );
  }

  // Bắn Telegram sau khi sửa giá thành công — ĐỘC LẬP với việc ghi Edit History ở
  // trên (dù log Sheet lỗi, noti vẫn phản ánh đúng việc GIÁ đã đổi thật). Lỗi gửi
  // đã tự nuốt bên trong sendNoti() (trả false, không throw) — không cần try/catch
  // thêm ở đây. QUAN TRỌNG: PHẢI `await` (không `void` như G2G) — dev-apply.ts là
  // script chạy 1 lần rồi thoát ngay, không phải daemon sống liên tục như G2G;
  // fire-and-forget ở đây có thể khiến process exit trước khi request gửi xong,
  // mất tin nhắn âm thầm.
  const sortLine = target.mode === 'top' ? ` · Sort: <b>${target.sortKey}</b>` : '';
  const competitorName = result.competitor?.merchantName || 'không rõ tên';
  const priceMinText = target.priceMin !== null ? String(target.priceMin) : 'không có';
  await sendNoti(
    `✅ <b>Đã sửa giá GamsGo</b>\n` +
      `- Service: ${escapeHtml(target.service)}\n` +
      `- Game: ${escapeHtml(target.game)}\n` +
      `- Name: ${escapeHtml(target.name)}\n` +
      `- Mode: <b>${target.mode}</b>${sortLine}\n` +
      `- Giá cũ: <b><i>${currentPrice} USD</i></b> -> Giá mới: <b><i>${result.desired}</i></b> ` +
      `(Mức giá min có thể chịu: ${priceMinText})\n` +
      `- Đối thủ: ${escapeHtml(competitorName)}\n` +
      `- Thời gian: ${nowUtc7()} (UTC+7)\n` +
      `- LINK: ${escapeHtml(target.linkCrawl)}`
  );
}

main();
