/**
 * `Logger` to a file under `userData/logs` plus the main process console (§3.3, W11) — a
 * single-backup rotation (the previous run's file becomes `.old`) rather than open-ended
 * accumulation, since nothing in P3 needs more than the last two runs to debug a report.
 */
import { appendFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Logger, LogLevel } from "@kira-version/core";

const LEVEL_RANK: Record<LogLevel, number> = { off: 0, error: 1, warn: 2, info: 3, debug: 4 };

function formatData(data: unknown): string {
  if (data === undefined) return "";
  if (data instanceof Error) return ` ${data.name}: ${data.message}`;
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ` ${String(data)}`;
  }
}

function rotate(filePath: string): void {
  if (!existsSync(filePath)) return;
  renameSync(filePath, `${filePath}.old`);
}

export class ElectronLogger implements Logger {
  readonly #logsDir: string;
  readonly #filePath: string;
  readonly #getLevel: () => LogLevel;
  readonly #scope: string;

  constructor(logsDir: string, getLevel: () => LogLevel, scope = "") {
    mkdirSync(logsDir, { recursive: true });
    this.#logsDir = logsDir;
    this.#filePath = join(logsDir, "kira-version.log");
    this.#getLevel = getLevel;
    this.#scope = scope;
    if (scope.length === 0) rotate(this.#filePath);
  }

  log(level: Exclude<LogLevel, "off">, message: string, data?: unknown): void {
    if (LEVEL_RANK[level] > LEVEL_RANK[this.#getLevel()]) return;
    const prefix = this.#scope.length > 0 ? `[${this.#scope}] ` : "";
    const line = `${prefix}${level.toUpperCase()}: ${message}${formatData(data)}`;
    appendFileSync(this.#filePath, `${line}\n`, "utf8");
    console[level === "debug" ? "log" : level](line);
  }

  child(scope: string): Logger {
    const qualified = this.#scope.length > 0 ? `${this.#scope}.${scope}` : scope;
    return new ElectronLogger(this.#logsDir, this.#getLevel, qualified);
  }
}
