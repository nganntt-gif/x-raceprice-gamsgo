/**
 * dev-test.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Script chạy tay Phase 1: đọc tab "Setup" THẬT qua Google Sheets API (xem README
 * mục "Cài đặt Google Sheets" để tạo `credentials.json` + `.env`), chạy qua đúng
 * pipeline resolveTypeCategoryId → fetchOffers → pickCompetitor, in kết quả để
 * đối chiếu bằng mắt với dữ liệu sản xuất thật.
 *
 * Chạy: bun run src/dev-test.ts   (hoặc: bun run dev-test)
 */

import { loadConfig } from './util/config';
import { readSetupRows, SPREADSHEET_ID } from './core/sheets';
import { resolveTypeCategoryId } from './core/category';
import { fetchOffers } from './core/gamsgo';
import { pickCompetitor } from './pick';
import { parseTarget, isRowEnabled } from './core/target';

async function main() {
  if (!SPREADSHEET_ID) {
    console.log(
      'LỖI: thiếu SPREADSHEET_ID (hoặc GOOGLE_SPREADSHEET_ID) trong .env — xem README mục "Cài đặt Google Sheets".'
    );
    process.exit(1);
  }

  const cfg = loadConfig();
  console.log(`Đang đọc tab "${cfg.setupSheet}" từ spreadsheet ${SPREADSHEET_ID}...`);

  let rows;
  try {
    rows = await readSetupRows(cfg.setupSheet);
  } catch (err: any) {
    console.log(`LỖI đọc tab "${cfg.setupSheet}": ${err?.message || err}`);
    process.exit(1);
  }
  console.log(`Đã đọc ${rows.length} dòng từ Sheets.`);

  for (const row of rows) {
    console.log(`\n=== Dòng ${row.rowIndex}: ${row.service} / ${row.name} ===`);

    if (!isRowEnabled(row)) {
      console.log('CHECK != 1 → bỏ qua');
      continue;
    }

    const { target, error } = parseTarget(row);
    if (error || !target) {
      console.log(`LỖI parseTarget: ${error}`);
      continue;
    }

    try {
      const typeCategoryId = await resolveTypeCategoryId(target.linkCrawl);
      console.log(`type_category_id = ${typeCategoryId}`);

      const offers = await fetchOffers(typeCategoryId, target.typePlanImage);
      console.log(`Pool đối thủ (${offers.length} merchant, đã loại own-offer? CHƯA — raw pool):`);
      for (const o of offers) {
        const isSelf = o.typePlanId === target.ownTypePlanId ? '  ← CHÍNH MÌNH' : '';
        console.log(
          `  merchant=${o.merchantId} price=${o.price} score=${o.score} typePlanId=${o.typePlanId}${isSelf}`
        );
      }

      const result = pickCompetitor(target, offers);
      console.log(`→ ${result.note}`);
      console.log(`→ desired price = ${result.desired}`);
    } catch (err: any) {
      console.log(`LỖI: ${err?.message || err}`);
    }
  }
}

main();
