/**
 * `Logger` over a `vscode.LogOutputChannel`, which owns level filtering (the user's "Set Log
 * Level" command and the Output panel's own picker); this adapter only formats and routes.
 */
import type { Logger, LogLevel } from '@kira/git-core';
import type * as vscode from 'vscode';

function formatData(data: unknown): string {
  if (data === undefined) return '';
  if (data instanceof Error) return ` ${data.name}: ${data.message}`;
  try {
    return ` ${JSON.stringify(data)}`;
  } catch {
    return ` ${String(data)}`;
  }
}

export class VsCodeLogger implements Logger {
  readonly #channel: vscode.LogOutputChannel;
  readonly #scope: string;

  constructor(channel: vscode.LogOutputChannel, scope = '') {
    this.#channel = channel;
    this.#scope = scope;
  }

  log(level: Exclude<LogLevel, 'off'>, message: string, data?: unknown): void {
    const prefix = this.#scope.length > 0 ? `[${this.#scope}] ` : '';
    this.#channel[level](`${prefix}${message}${formatData(data)}`);
  }

  child(scope: string): Logger {
    const qualified = this.#scope.length > 0 ? `${this.#scope}.${scope}` : scope;
    return new VsCodeLogger(this.#channel, qualified);
  }
}
