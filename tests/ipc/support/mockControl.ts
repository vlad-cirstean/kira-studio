import type { ElectronApplication } from '@playwright/test';
import type { ControlSnapshot } from './types';

/**
 * Swaps the control channel's `ipcMain` handlers in the main process (P50 D3) — never in the
 * renderer, because `window.kira` is deeply frozen and non-configurable, and
 * `renderer/bridge/control.ts` binds it at module scope regardless (F4). The mock therefore sits
 * *behind* the real `contextBridge` and the real `ipcRenderer.invoke`, so a frontend spec still
 * crosses the real structured-clone boundary. `tests/ui/s3.spec.ts`'s own `dialog` stub via
 * `app.evaluate` is the existing precedent this generalises (F5).
 *
 * Every invoke this installs is logged on `globalThis.__kiraIpcLog`; read it back with
 * `readControlLog`.
 */
export async function installControlMocks(
  app: ElectronApplication,
  snapshots: readonly ControlSnapshot[],
): Promise<void> {
  await app.evaluate(({ ipcMain }, snaps) => {
    const g = globalThis as unknown as { __kiraIpcLog?: { channel: string; args: unknown }[] };
    g.__kiraIpcLog = g.__kiraIpcLog ?? [];
    const log = g.__kiraIpcLog;
    const byChannel = new Map<string, ControlSnapshot[]>();
    for (const snap of snaps) {
      const list = byChannel.get(snap.channel) ?? [];
      list.push(snap);
      byChannel.set(snap.channel, list);
    }
    // Structured clone (what ipcRenderer.invoke actually uses, unlike JSON) preserves an object
    // key whose value is `undefined` — e.g. `treeChildren(id, path)`'s `refresh` argument, left
    // undefined by every caller that doesn't pass a third argument. Comparing raw JSON.stringify
    // output would make that call fail to match a fixture recorded from a caller that never set
    // the key in the first place, so both sides drop undefined-valued keys before comparing.
    function canonical(value: unknown): string {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
          const v = (value as Record<string, unknown>)[key];
          if (v !== undefined) out[key] = v;
        }
        return JSON.stringify(out);
      }
      return JSON.stringify(value);
    }
    for (const [channel, list] of byChannel) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, args) => {
        log.push({ channel, args });
        // A channel called with the same args every time (connectionsList, connectionsStates)
        // has exactly one snapshot; a channel whose response depends on its args (treeChildren
        // for different paths) has one per distinct args value, matched here. A single-snapshot
        // channel answers regardless of the exact args it was called with — e.g. opsCancel's
        // opId is generated client-side per run and can never appear in a captured fixture.
        if (list.length === 1) return list[0].response;
        const match = list.find((s) => canonical(s.args) === canonical(args));
        if (!match)
          throw new Error(`no fixture snapshot for ${channel} args ${JSON.stringify(args)}`);
        return match.response;
      });
    }
  }, snapshots as ControlSnapshot[]);
}

export interface ControlLogEntry {
  channel: string;
  args: unknown;
}

/** Every invoke the mocked control channel actually received, in order (P50 D7). */
export async function readControlLog(app: ElectronApplication): Promise<ControlLogEntry[]> {
  return app.evaluate(() => {
    const g = globalThis as unknown as { __kiraIpcLog?: ControlLogEntry[] };
    return g.__kiraIpcLog ?? [];
  });
}
