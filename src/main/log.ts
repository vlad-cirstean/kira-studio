import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { logsDir } from './storage/paths';

type Level = 'info' | 'warn' | 'error';

export function log(level: Level, scope: string, message: string): void {
  const dir = logsDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const date = new Date().toISOString().slice(0, 10);
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${scope} ${message}`;
  appendFileSync(join(dir, `kira-${date}.log`), `${line}\n`);
  if (process.env.NODE_ENV !== 'test') {
    const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    sink(line);
  }
}
