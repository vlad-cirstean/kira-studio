import { reactive } from 'vue';

// D9: Postgres-only, renderer-only, session-only — never persisted, never sent to the engine.
// A console opened at a bare connection root (path === '') has no session-level way to change
// which database it targets from inside the script itself (unlike MariaDB's own `USE db;`), so
// "Set as default" on a database/schema row remembers the row's own encoded path here and
// openConsoleTab() substitutes it in when a console is opened at the root.
export const consoleDefaults = reactive({} as Record<string, string>);

export function setConsoleDefault(connectionId: string, path: string): void {
  consoleDefaults[connectionId] = path;
}

export function consoleDefaultFor(connectionId: string): string | null {
  return consoleDefaults[connectionId] ?? null;
}
