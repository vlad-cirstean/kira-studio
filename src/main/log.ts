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
