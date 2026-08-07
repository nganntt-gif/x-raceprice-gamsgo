/**
 * dashboard.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Hiển thị trạng thái bám giá từng dòng bằng terminal render tại chỗ — port gần
 * như nguyên văn từ `util/dashboard.ts` bản `x-raceprce-g2g-zerogap`, chỉ đổi tên
 * hiển thị. CHỈ dùng trong `main.ts` (daemon sống liên tục, cần 1 khung render cố
 * định) — `dev-test.ts`/`dev-apply.ts` vẫn giữ `console.log` (script chạy 1 lần,
 * tuyến tính, không có khung nào để bảo vệ khỏi vỡ).
 *
 * AN TOÀN BỘ NHỚ (daemon chạy thường trú):
 *   - Dùng `log-update` + `chalk`, KHÔNG dùng `cli-table3`.
 *   - Lúc SLEEPING (chờ nhịp poll) chỉ làm tươi đồng hồ qua MỘT setInterval giãn 5s.
 *   - Buffer log cuộn cố định (giữ N dòng cuối).
 */

import logUpdate from 'log-update';
import chalk from 'chalk';
import dayjs from 'dayjs';

export type TargetStatus = 'IDLE' | 'WATCHING' | 'EDITED' | 'SKIP' | 'ERROR';
type SystemPhase = 'BOOT' | 'AUTH' | 'POLLING' | 'SLEEPING' | 'ERROR';

interface TargetState {
  name: string;
  status: TargetStatus;
  competitor: string; // giá đối thủ (hiển thị)
  myPrice: string; // giá mình đang đặt
  edits: number; // số lần đã sửa
  info: string;
}

const MAX_LOGS = 9;
const MAX_NAME = 26;

function blankTarget(name: string): TargetState {
  return {
    name,
    status: 'IDLE',
    competitor: '-',
    myPrice: '-',
    edits: 0,
    info: '',
  };
}

export class Dashboard {
  private static title = 'GAMSGO RACE-PRICE';
  private static phase: SystemPhase = 'BOOT';
  private static nextPollAt: number | null = null;
  private static order: string[] = []; // ownTypePlanId theo thứ tự
  private static targets: Record<string, TargetState> = {};
  private static logs: string[] = [];

  static {
    setInterval(() => {
      if (this.phase === 'SLEEPING') this.render();
    }, 5000);
  }

  static setTitle(t: string): void {
    if (t) this.title = t;
  }

  /** Khai báo danh sách dòng cần theo dõi (id → tên hiển thị). */
  static setTargets(list: { id: string; name: string }[]): void {
    this.order = list.map((t) => t.id);
    const next: Record<string, TargetState> = {};
    for (const t of list)
      next[t.id] = this.targets[t.id] || blankTarget(t.name);
    this.targets = next;
    this.render();
  }

  static updateTarget(id: string, data: Partial<TargetState>): void {
    if (!this.targets[id]) this.targets[id] = blankTarget(id);
    this.targets[id] = { ...this.targets[id], ...data };
    this.render();
  }

  static setPhase(phase: SystemPhase, nextPollAt?: number | null): void {
    this.phase = phase;
    if (nextPollAt !== undefined) this.nextPollAt = nextPollAt;
    this.render();
  }

  static log(tag: string, msg: string): void {
    this.push(
      `${chalk.cyan(`[${tag.toUpperCase()}]`)} ${chalk.gray(dayjs().format('HH:mm:ss'))} ${msg}`
    );
  }

  static error(tag: string, msg: string): void {
    this.push(
      chalk.red(`[${tag.toUpperCase()}] ${dayjs().format('HH:mm:ss')} ERROR: ${msg}`)
    );
  }

  private static push(line: string): void {
    this.logs.push(line);
    if (this.logs.length > MAX_LOGS) this.logs.shift();
    this.render();
  }

  private static formatCountdown(targetMs: number | null): string {
    if (!targetMs) return '---';
    const diff = targetMs - Date.now();
    if (diff <= 0) return chalk.green('READY');
    return `${Math.ceil(diff / 1000)}s`;
  }

  private static colorStatus(status: TargetStatus): string {
    const padded = status.padEnd(8);
    switch (status) {
      case 'WATCHING':
        return chalk.green(padded);
      case 'EDITED':
        return chalk.greenBright(padded);
      case 'SKIP':
        return chalk.yellow(padded);
      case 'ERROR':
        return chalk.red(padded);
      default:
        return chalk.gray(padded);
    }
  }

  private static colorPhase(): string {
    switch (this.phase) {
      case 'POLLING':
        return chalk.green(this.phase);
      case 'SLEEPING':
        return chalk.blue(this.phase);
      case 'ERROR':
        return chalk.red(this.phase);
      default:
        return chalk.yellow(this.phase);
    }
  }

  private static render(): void {
    const clock = chalk.gray(dayjs().format('HH:mm:ss DD.MM.YYYY'));
    const rows = this.order.map((id) => {
      const st = this.targets[id];
      if (!st) return '';
      const name = chalk.cyan(st.name.slice(0, MAX_NAME).padEnd(MAX_NAME));
      const status = this.colorStatus(st.status);
      const comp = st.competitor.padStart(12);
      const mine = st.myPrice.padStart(12);
      const edits = chalk.gray(`×${st.edits}`.padStart(5));
      const info = st.info.length > 28 ? st.info.slice(0, 26) + '..' : st.info;
      return `    ${name} ${status} ${comp} ${mine} ${edits}  ${chalk.gray(info)}`;
    });

    const header =
      `    ${chalk.bold('NAME'.padEnd(MAX_NAME))} ${chalk.bold('STATUS'.padEnd(8))} ` +
      `${chalk.bold('COMPETITOR'.padStart(12))} ${chalk.bold('MY PRICE'.padStart(12))} ${chalk.bold('EDITS'.padStart(5))}`;

    const output = `
    ${chalk.bgCyan.black.bold(`  RACE-PRICE: ${this.title}  `)}  ${clock}

    ${chalk.yellow('Phase')}      : ${this.colorPhase()}
    ${chalk.yellow('Next poll')}  : ${this.formatCountdown(this.nextPollAt)}    ${chalk.gray(`(${this.order.length} dòng)`)}

${header}
${rows.length > 0 ? rows.join('\n') : chalk.gray('    (không có dòng nào bật)')}

    ${chalk.bold('LATEST LOGS:')}
    ${this.logs.length > 0 ? this.logs.join('\n    ') : chalk.gray('Đang chờ...')}

    ${chalk.gray('Ctrl+C để dừng.')}`;

    logUpdate(output);
  }
}
