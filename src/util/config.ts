/**
 * config.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Cấu hình từ `.env` cho x-raceprice-gamsgo.
 *  - `setupSheet`: tên tab Setup (`SPREADSHEET_ID` đọc trực tiếp trong
 *    `core/sheets.ts`, mirror đúng quy ước bản G2G: hằng số đó gắn liền với
 *    client Sheets, không đi qua AppConfig).
 *  - `cookiesFile`/`cookiesPath`: file cookies export từ browser (đọc token cho
 *    `POST /product/editPlanInfo` qua `core/auth.ts`), mirror đúng field của
 *    bản G2G (`COOKIES_FILE`).
 *  - `editHistorySheet`: tên tab ghi log mỗi lần sửa giá THẬT, mirror đúng field
 *    `SHEET_EDIT_HISTORY` của bản G2G.
 *  - `pollIntervalSeconds`/`setupCacheSeconds`: nhịp poll + cache Setup của
 *    daemon (`main.ts`), mirror đúng field/mặc định của bản G2G.
 */

import * as dotenv from 'dotenv';
dotenv.config();
import path from 'node:path';

function num(v: string | undefined, def: number): number {
  const n = parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : def;
}

export interface AppConfig {
  /** Tên tab cấu hình offer cần bám giá. */
  setupSheet: string;
  /** Đường dẫn tương đối (từ .env) tới file cookies export từ browser. */
  cookiesFile: string;
  /** Đường dẫn tuyệt đối (từ process.cwd()) tới file cookies — dùng để đọc trực tiếp. */
  cookiesPath: string;
  /** Tên tab ghi log mỗi lần sửa giá THẬT. */
  editHistorySheet: string;
  /** Nhịp poll giá đối thủ của daemon (giây). Mặc định 20s, giống G2G. */
  pollIntervalSeconds: number;
  /** TTL cache tab Setup của daemon (giây) — chỉ đọc lại Sheets sau ngần này. Mặc định 300s, giống G2G. */
  setupCacheSeconds: number;
}

export function loadConfig(): AppConfig {
  const cookiesFile = process.env.COOKIES_FILE || 'cookies/gamsgo_go1.json';
  return {
    setupSheet: process.env.SHEET_SETUP || 'Setup',
    cookiesFile,
    cookiesPath: path.join(process.cwd(), cookiesFile),
    editHistorySheet: process.env.SHEET_EDIT_HISTORY || 'Edit History',
    pollIntervalSeconds: num(process.env.POLL_INTERVAL_SECONDS, 20),
    setupCacheSeconds: num(process.env.SETUP_CACHE_SECONDS, 300),
  };
}
