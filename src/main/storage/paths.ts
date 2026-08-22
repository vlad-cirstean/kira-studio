import { chmodSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function kiraHome(): string {
  return process.env.KIRA_HOME ?? join(homedir(), '.kira-studio');
}

export function dbPath(): string {
  return join(kiraHome(), 'kira.sqlite');
}

export function logsDir(): string {
  return join(kiraHome(), 'logs');
}

function ensureDir(dir: string): void {
  // mkdir's mode is masked by the process umask, so the chmod below is not redundant.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export function ensureLayout(): void {
  ensureDir(kiraHome());
  ensureDir(logsDir());
}
