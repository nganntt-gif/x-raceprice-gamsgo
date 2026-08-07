/**
 * sheets.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Tầng Google Sheets cho tool RACE-PRICE (GamsGo) — mirror `core/sheets.ts` bản
 * `x-raceprce-g2g-zerogap`, chỉ khác ở `COLUMN_ALIASES` để khớp đúng cột Setup của
 * Gamsgo (có thêm `SORT` + `LINK IMAGE`, không có `Seller Level`).
 *
 *   - readSetupRows(sheetName)      : đọc tab Setup → SetupRowRaw[].
 *   - appendEditHistory(sheet, row) : ghi 1 dòng log mỗi lần sửa giá THẬT vào tab
 *     "Edit History" — dùng từ `dev-apply.ts` sau khi `editPlanInfo()` thành công.
 *     Header mượn phần lớn label của bản G2G (Game/Service/Name/.../Top Seller
 *     Follow/Note/Time) để nhất quán giữa các tool của người dùng, nhưng 2 cột giá
 *     đổi khác G2G theo yêu cầu: `Price Before`/`Price After` (giá TRƯỚC/SAU khi
 *     sửa) thay vì `Enemy Price`/`My Price` (giá đối thủ/giá mình) — giá đối thủ
 *     vẫn xem được qua cột `Note` (đã có sẵn "đối thủ giá=..." từ `pick.ts`, không
 *     mất thông tin). Seller dùng merchant_id/merchant_name thay username, không
 *     có `min_qty` vì Gamsgo không có ràng buộc đó.
 *
 *     KHÁC G2G ở 1 điểm quan trọng: G2G chỉ check "tab đã tồn tại chưa" rồi append
 *     thẳng, giả định header luôn đúng nếu tab đã có. Ở đây kiểm CHẶT HƠN — nếu
 *     tab đã tồn tại mà header dòng 1 KHÔNG khớp đúng `EDIT_HISTORY_HEADERS`, ném
 *     lỗi rõ ràng thay vì append lẫn dưới header sai (bắt đúng case tab đang chứa
 *     dữ liệu của 1 tool khác — đã gặp thật khi kiểm tra sheet của người dùng).
 *
 * Lưu ý hướng import: bản G2G định nghĩa `SetupRowRaw` NGAY TRONG sheets.ts rồi
 * cho target.ts import ngược lại. Ở dự án này `target.ts` đã có sẵn type đó từ
 * trước (viết trước sheets.ts) nên chiều import bị đảo: sheets.ts import type từ
 * `./target`, không phải ngược lại.
 */

import * as dotenv from 'dotenv';
dotenv.config();
import { google, sheets_v4 } from 'googleapis';
import fs from 'node:fs';
import path from 'node:path';
import type { SetupRowRaw } from './target';

export const SPREADSHEET_ID =
  process.env.SPREADSHEET_ID || process.env.GOOGLE_SPREADSHEET_ID || '';
const KEY_FILE_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Tạo client Sheets từ service-account key `credentials.json` ở thư mục gốc dự
 * án. Kiểm tra file tồn tại TRƯỚC khi gọi GoogleAuth để báo lỗi dễ hiểu — thay vì
 * để lộ ENOENT khó đoán ra từ bên trong thư viện `googleapis`.
 */
export async function getSheetsClient(): Promise<sheets_v4.Sheets> {
  if (!fs.existsSync(KEY_FILE_PATH)) {
    throw new Error(
      `Không tìm thấy file credentials.json tại ${KEY_FILE_PATH} — xem README mục "Cài đặt Google Sheets" để tạo service account key.`
    );
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: KEY_FILE_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

/** Chuẩn hóa tên cột: bỏ khoảng trắng thừa + lowercase để so khớp linh hoạt. */
function normHeader(h: string): string {
  return (h || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}

// Map tên cột trên sheet → khóa trong SetupRowRaw. Chấp nhận vài biến thể đặt tên
// cho SELLER_BLACK LIST (khoảng trắng/gạch dưới lẫn lộn tùy người nhập sheet).
const COLUMN_ALIASES: Record<string, keyof Omit<SetupRowRaw, 'rowIndex'>> = {
  check: 'check',
  mode: 'mode',
  sort: 'sort',
  game: 'game',
  service: 'service',
  name: 'name',
  'link crawl': 'linkCrawl',
  'link image': 'linkImage',
  'link edit': 'linkEdit',
  seller: 'seller',
  'price step': 'priceStep',
  'price min': 'priceMin',
  'seller_black list': 'sellerBlackList',
  'seller black list': 'sellerBlackList',
  seller_blacklist: 'sellerBlackList',
};

/**
 * Đọc tab Setup, trả về danh sách dòng đã map theo tên cột (header ở dòng 1).
 * Bỏ qua các dòng trống hoàn toàn.
 */
export async function readSetupRows(sheetName: string): Promise<SetupRowRaw[]> {
  const sheets = await getSheetsClient();
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1:Z1000`,
  });
  const values = resp.data.values || [];
  if (values.length < 2) return [];

  const header = values[0].map(normHeader);
  // colMap[key] = index cột
  const colMap: Partial<Record<keyof Omit<SetupRowRaw, 'rowIndex'>, number>> = {};
  header.forEach((h, idx) => {
    const key = COLUMN_ALIASES[h];
    if (key && colMap[key] === undefined) colMap[key] = idx;
  });

  const get = (row: any[], key: keyof Omit<SetupRowRaw, 'rowIndex'>): string => {
    const idx = colMap[key];
    if (idx === undefined) return '';
    return (row[idx] ?? '').toString().trim();
  };

  const rows: SetupRowRaw[] = [];
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row || row.every((c) => (c ?? '').toString().trim() === '')) continue;
    rows.push({
      rowIndex: i + 1,
      check: get(row, 'check'),
      mode: get(row, 'mode'),
      sort: get(row, 'sort'),
      game: get(row, 'game'),
      service: get(row, 'service'),
      name: get(row, 'name'),
      linkCrawl: get(row, 'linkCrawl'),
      linkImage: get(row, 'linkImage'),
      linkEdit: get(row, 'linkEdit'),
      seller: get(row, 'seller'),
      priceStep: get(row, 'priceStep'),
      priceMin: get(row, 'priceMin'),
      sellerBlackList: get(row, 'sellerBlackList'),
    });
  }
  return rows;
}

export const EDIT_HISTORY_HEADERS = [
  'Game',
  'Service',
  'Name',
  'Price Before',
  'Price After',
  'Top Seller Follow',
  'Note',
  'Time',
];

/**
 * Ghi 1 dòng log sửa giá THẬT vào tab "Edit History" (append xuống cuối).
 *
 *  - Tab CHƯA tồn tại        → tự tạo tab + ghi header, rồi append.
 *  - Tab tồn tại, header rỗng → ghi header, rồi append.
 *  - Tab tồn tại, header KHÁC `EDIT_HISTORY_HEADERS` → ném lỗi rõ (kèm cả header
 *    dự kiến và header thực tế) — KHÔNG tự ghi đè/đoán mò. Case này xảy ra khi
 *    tab đang chứa dữ liệu của 1 tool khác (đã gặp thật) — người dùng cần tự dọn
 *    hoặc đổi tên tab trước khi log thật lần đầu.
 *  - Tab tồn tại, header khớp đúng → append thẳng.
 */
export async function appendEditHistory(
  sheetName: string,
  rowData: (string | number)[]
): Promise<void> {
  const sheets = await getSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const exists = spreadsheet.data.sheets?.some((s) => s.properties?.title === sheetName);

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: { values: [EDIT_HISTORY_HEADERS] },
    });
  } else {
    const headerResp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${sheetName}!A1:H1`,
    });
    const header = (headerResp.data.values?.[0] ?? []).map((h) => String(h ?? '').trim());
    const headerEmpty = header.length === 0 || header.every((h) => h === '');

    if (headerEmpty) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [EDIT_HISTORY_HEADERS] },
      });
    } else if (!EDIT_HISTORY_HEADERS.every((h, i) => header[i] === h)) {
      throw new Error(
        `Tab "${sheetName}" đã tồn tại nhưng header dòng 1 KHÔNG khớp cột Gamsgo dự kiến. ` +
          `Header dự kiến: [${EDIT_HISTORY_HEADERS.join(', ')}]. ` +
          `Header hiện có: [${header.join(', ')}]. ` +
          `Có thể tab này đang chứa dữ liệu của 1 tool khác — dọn hoặc đổi tên tab rồi chạy lại.`
      );
    }
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:H`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowData] },
  });
}
