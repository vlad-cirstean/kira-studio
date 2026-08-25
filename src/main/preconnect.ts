import { spawn } from 'node:child_process';
import { homedir } from 'node:os';

// Owns every child process the app ever spawns on the user's behalf (P11). Imports only Node
// built-ins — no `electron` — so this module is importable from the Bun-run `tests/db` suite the
// same way an adapter's AdapterDeps-shaped logger is.
export interface PreconnectDeps {
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

/** Resolved once the script is judged ready. */
export type PreconnectStart =
  | { kind: 'oneshot' } // exited 0 within the settle window — nothing left to monitor
  | { kind: 'sidecar' }; // still alive at the settle window — monitored from arm() onwards

export interface PreconnectExit {
  connectionId: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  lastStderr: string | null;
}

export interface PreconnectSupervisor {
  /**
   * Kills any process already tracked for `connectionId`, spawns `command`, and resolves once it
   * is ready. Rejects if it exits non-zero / on a signal / fails to spawn before the settle
   * window elapses — the message names the exit code and the last stderr line.
   */
  start(connectionId: string, command: string): Promise<PreconnectStart>;
  /**
   * Called only after the adapter connect succeeded: from here on, any exit fires onExit. If the
   * process already died between start() resolving and this call, fires onExit synchronously.
   */
  arm(connectionId: string): void;
  /** Idempotent. Self-inflicted kills never fire onExit. */
  stop(connectionId: string): Promise<void>;
  stopAll(): Promise<void>;
  onExit(cb: (exit: PreconnectExit) => void): () => void;
}

const PRECONNECT_SETTLE_MS = 2000; // alive this long ⇒ treated as a running sidecar
const PRECONNECT_KILL_GRACE_MS = 2000; // SIGTERM → SIGKILL escalation window
const STDERR_TAIL_MAX = 200;

interface Entry {
  pid: number;
  armed: boolean;
  killing: boolean;
  dead: PreconnectExit | null; // set if the process exited before arm() consumed it
  lastStderr: string | null;
  exited: Promise<void>;
}

// Chunks from a pipe never line up with newlines — a single echo'd line can arrive split across
// several 'data' events, or several lines can arrive in one. `carry` holds only the unterminated
// remainder after the last newline seen so far; without tracking that separately from `last`, a
// line already completed by a previous chunk's trailing newline would get silently reused as a
// prefix for the next chunk's content instead of being replaced by it.
function makeTailTracker(): { push(chunk: string): void; value(): string } {
  let carry = '';
  let last = '';
  return {
    push(chunk: string): void {
      const lines = (carry + chunk).split(/\r?\n/);
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim() !== '') last = line;
      }
      if (carry.trim() !== '') last = carry;
    },
    value(): string {
      return last.length > STDERR_TAIL_MAX ? last.slice(0, STDERR_TAIL_MAX) : last;
    },
  };
}

export function createPreconnectSupervisor(deps: PreconnectDeps): PreconnectSupervisor {
  const entries = new Map<string, Entry>();
  const exitHandlers = new Set<(exit: PreconnectExit) => void>();

  function emitExit(exit: PreconnectExit): void {
    for (const handler of exitHandlers) handler(exit);
  }

  async function killEntry(connectionId: string, entry: Entry): Promise<void> {
    entry.killing = true;
    try {
      process.kill(-entry.pid, 'SIGTERM');
    } catch {
      // already gone
    }
    const escalate = setTimeout(() => {
      try {
        process.kill(-entry.pid, 'SIGKILL');
      } catch {
        // already gone
      }
    }, PRECONNECT_KILL_GRACE_MS);
    try {
      await entry.exited;
    } finally {
      clearTimeout(escalate);
    }
    if (entries.get(connectionId) === entry) entries.delete(connectionId);
  }

  return {
    async start(connectionId, command) {
      const existing = entries.get(connectionId);
      if (existing) await killEntry(connectionId, existing);

      return new Promise<PreconnectStart>((resolve, reject) => {
        const child = spawn('/bin/sh', ['-c', command], {
          detached: true,
          cwd: homedir(),
          stdio: ['ignore', 'pipe', 'pipe'],
          env: {
            ...process.env,
            PATH: `${process.env.PATH ?? ''}:/usr/local/bin:/opt/homebrew/bin`,
          },
        });

        const stderrTailTracker = makeTailTracker();
        let settled = false;

        let resolveExited: () => void;
        const exited = new Promise<void>((res) => {
          resolveExited = res;
        });

        const entry: Entry = {
          pid: -1,
          armed: false,
          killing: false,
          dead: null,
          lastStderr: null,
          exited,
        };

        child.stderr?.on('data', (chunk: Buffer) => {
          stderrTailTracker.push(chunk.toString('utf8'));
          entry.lastStderr = stderrTailTracker.value() || null;
        });

        const settleTimer = setTimeout(() => {
          settled = true;
          if (typeof child.pid === 'number') {
            entry.pid = child.pid;
            entries.set(connectionId, entry);
          }
          resolve({ kind: 'sidecar' });
        }, PRECONNECT_SETTLE_MS);

        child.once('error', (err) => {
          clearTimeout(settleTimer);
          deps.log('error', `preconnect[${connectionId}] failed to spawn: ${err.message}`);
          if (!settled) {
            settled = true;
            resolveExited();
            reject(new Error(`Pre-connect script could not start: ${err.message}`));
          }
        });

        // 'close' rather than 'exit': 'exit' can fire before the stdio pipes finish delivering
        // buffered data, which would race the stderr tail this needs for the rejection message.
        child.once('close', (code, signal) => {
          clearTimeout(settleTimer);
          resolveExited();
          const tracked = entries.get(connectionId) === entry;
          const wasKilling = entry.killing;

          if (!settled) {
            settled = true;
            if (code === 0 && !signal) {
              deps.log('info', `preconnect[${connectionId}] one-shot exited 0`);
              resolve({ kind: 'oneshot' });
            } else {
              const detail = signal
                ? `(signal ${signal})`
                : `(exit ${code === null ? 'unknown' : code})`;
              const tail = stderrTailTracker.value() ? `: ${stderrTailTracker.value()}` : '';
              reject(new Error(`Pre-connect script failed ${detail}${tail}`));
            }
            return;
          }

          // Settled as a sidecar already. A kill this supervisor itself initiated (stop()/start()
          // superseding a previous entry) must stay silent — killEntry() owns removing it.
          if (wasKilling) return;

          const exit: PreconnectExit = {
            connectionId,
            code,
            signal,
            lastStderr: stderrTailTracker.value() || null,
          };
          if (entry.armed) {
            emitExit(exit);
            if (tracked) entries.delete(connectionId);
          } else {
            // Died between start() resolving and arm() being called — arm() reports it (D7).
            entry.dead = exit;
          }
        });
      });
    },

    arm(connectionId) {
      const entry = entries.get(connectionId);
      if (!entry) return;
      if (entry.dead) {
        const exit = entry.dead;
        entries.delete(connectionId);
        emitExit(exit);
        return;
      }
      entry.armed = true;
    },

    async stop(connectionId) {
      const entry = entries.get(connectionId);
      if (!entry) return;
      await killEntry(connectionId, entry);
    },

    async stopAll() {
      await Promise.all(
        [...entries.entries()].map(([connectionId, entry]) => killEntry(connectionId, entry)),
      );
    },

    onExit(cb) {
      exitHandlers.add(cb);
      return () => exitHandlers.delete(cb);
    },
  };
}
