// The one place frontend code writes to the console (Biome noConsole is off only for this file).

export function logWarn(scope: string, message: string, err?: unknown): void {
  if (err === undefined) console.warn(`[${scope}] ${message}`);
  else console.warn(`[${scope}] ${message}`, err);
}

export function logError(scope: string, message: string, err?: unknown): void {
  if (err === undefined) console.error(`[${scope}] ${message}`);
  else console.error(`[${scope}] ${message}`, err);
}
