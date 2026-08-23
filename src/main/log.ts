import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import electronLog from 'electron-log/main';
import { logsDir } from './storage/paths';

type Level = 'info' | 'warn' | 'error';

electronLog.transports.file.resolvePathFn = () => {
  const date = new Date().toISOString().slice(0, 10);
  return join(logsDir(), `kira-${date}.log`);
};
if (process.env.NODE_ENV === 'test') {
  electronLog.transports.console.level = false;
}

export function log(level: Level, scope: string, message: string): void {
  electronLog.scope(scope)[level](message);
}

// D12: matches SPEC §6's "rotated, capped" for the app's other on-disk history. A fixed constant
// rather than `advanced.opLogRetentionDays` — that setting is documented as the op log's
// retention, and silently making it also govern diagnostic files would surprise a user who sets
// it low to keep the op log small.
const LOG_RETENTION_DAYS = 30;

// Best-effort and swallows every failure — a log directory that cannot be read must never block
// startup. Ages files by mtime rather than parsing `kira-YYYY-MM-DD.log`'s date, so any rotated
// or renamed file electron-log produces is covered without depending on its naming scheme.
export function sweepOldLogs(): void {
  try {
    const dir = logsDir();
    const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('kira-') || !name.endsWith('.log')) continue;
      const path = join(dir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) unlinkSync(path);
      } catch {
        // best-effort per file
      }
    }
  } catch {
    // best-effort — a missing/unreadable logs dir must never block startup
  }
}
