import { TransportError } from '@kira/git-ipc';
import type { DetailActions } from '../state/detailActions.ts';

/** Runs a file-open request; a rejection is announced instead of dropped, so a click the host
 *  could not resolve does not look dead. `transport-closed` means the view is already gone. */
export function openFileAnnounced(
  actions: Pick<DetailActions, 'announce'>,
  path: string,
  open: () => Promise<void>,
): void {
  open().catch((err: unknown) => {
    if (err instanceof TransportError && err.code === 'transport-closed') return;
    actions.announce(`Couldn't open ${path} — ${err instanceof Error ? err.message : String(err)}`);
  });
}
