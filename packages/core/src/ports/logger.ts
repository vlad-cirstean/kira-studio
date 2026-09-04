/**
 * Leveled logging to an output channel — VS Code's `window.createOutputChannel` today;
 * `ports/testFakes.ts`'s `FakeLogger` is the second implementation, for unit tests. `"off"` is
 * a setting value (`kiraVersion.log.level`), never a level a caller logs *at* — hence
 * `Exclude<LogLevel, "off">` on `log()`.
 */
export type LogLevel = "off" | "error" | "warn" | "info" | "debug";

export interface Logger {
  log(level: Exclude<LogLevel, "off">, message: string, data?: unknown): void;
  /** A child logger whose messages are scoped (e.g. prefixed) under `scope`, sharing the same
   *  sink as its parent. */
  child(scope: string): Logger;
}
