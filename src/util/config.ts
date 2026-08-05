/**
 * config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cấu hình từ `.env` cho x-raceprice-gamsgo. Phase 1 chỉ cần tên tab Setup —
 * `SPREADSHEET_ID` được đọc trực tiếp trong `core/sheets.ts` (mirror đúng quy ước
 * bản G2G: hằng số đó gắn liền với client Sheets, không đi qua AppConfig). Chưa có
 * POLL_INTERVAL_SECONDS/state/dashboard ở đây vì chưa có daemon polling (Phase 2).
 */

import * as dotenv from 'dotenv';
dotenv.config();

export interface AppConfig {
  /** Tên tab cấu hình offer cần bám giá. */
  setupSheet: string;
}

export function loadConfig(): AppConfig {
  return {
    setupSheet: process.env.SHEET_SETUP || 'Setup',
  };
}
