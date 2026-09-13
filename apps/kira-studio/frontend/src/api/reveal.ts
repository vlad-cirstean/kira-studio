import type { RevealResult } from '@shared/domain/variables';
import { confirmDialog } from '../state/confirmDialog';

// P12 D13 (closing P5 OQ-2 + P9 OQ-4): the one reveal loop the module's three call sites share —
// revealVariable and revealHistoryEntry (state/variables.ts) and the Copy as curl loop
// (state/curl.ts, which calls revealVariable rather than hand-rolling its own copy). The
// four-outcome switch and the recurse-once-on-confirmation shape were identical in all three;
// project/ConnectionDialog.vue keeps its own copy on purpose (D13) — sharing it would need a home
// both project/** and http/** may import, which is exactly the Studio<->Api coupling this module
// boundary exists to prevent.
// Finding 1 (v1.2 P14 round 2): returns this call's own outcome — the revealed plaintext on
// success, `undefined` for anything else (cancelled, still-unavailable, or errored) — rather than
// `void`. A caller that instead re-reads a shared reveal map after awaiting this can't tell a
// fresh cancellation from a stale, unrelated success sitting in that map from an earlier reveal of
// the same id; returning the outcome of *this* call closes that gap at the source.
export async function runReveal(
  call: (confirmed: boolean) => Promise<RevealResult>,
  onRevealed: (value: string) => void,
  onError: (message: string) => void,
  prompt: string,
): Promise<string | undefined> {
  const handle = async (result: RevealResult): Promise<string | undefined> => {
    switch (result.outcome) {
      case 'revealed':
        if (result.value === null) return undefined;
        onRevealed(result.value);
        return result.value;
      case 'cancelled':
        return undefined;
      case 'confirmation-required': {
        const ok = await confirmDialog(prompt, { danger: false });
        return ok ? await handle(await call(true)) : undefined;
      }
      default:
        onError(result.error ?? 'Could not reveal the value.');
        return undefined;
    }
  };
  return await handle(await call(false));
}
