/**
 * `Logger` over `window.createOutputChannel("Kira Version")` (P3 W10). Filters by
 * `kiraVersion.log.level` itself — `Logger.log`'s signature excludes `"off"` on purpose (a
 * caller never logs *at* off), so honouring it is this adapter's job, not the caller's.
 */
import type { Logger, LogLevel } from "@kira-version/core";
import type * as vscode from "vscode";

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

export class VsCodeLogger implements Logger {
  readonly #channel: vscode.OutputChannel;
  readonly #getLevel: () => LogLevel;
  readonly #scope: string;

  constructor(channel: vscode.OutputChannel, getLevel: () => LogLevel, scope = "") {
    this.#channel = channel;
    this.#getLevel = getLevel;
    this.#scope = scope;
  }

  log(level: Exclude<LogLevel, "off">, message: string, data?: unknown): void {
    if (LEVEL_RANK[level] > LEVEL_RANK[this.#getLevel()]) return;
    const prefix = this.#scope.length > 0 ? `[${this.#scope}] ` : "";
    this.#channel.appendLine(`${prefix}${level.toUpperCase()}: ${message}${formatData(data)}`);
  }

  child(scope: string): Logger {
    const qualified = this.#scope.length > 0 ? `${this.#scope}.${scope}` : scope;
    return new VsCodeLogger(this.#channel, this.#getLevel, qualified);
  }
}
