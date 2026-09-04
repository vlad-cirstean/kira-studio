import type { RevealResult } from '@shared/domain/variables';
import { confirmDialog } from '../state/confirmDialog';

// P12 D13 (closing P5 OQ-2 + P9 OQ-4): the one reveal loop the module's three call sites share —
// revealVariable and revealHistoryEntry (state/variables.ts) and the Copy as curl loop
// (state/curl.ts, which calls revealVariable rather than hand-rolling its own copy). The
// four-outcome switch and the recurse-once-on-confirmation shape were identical in all three;
// project/ConnectionDialog.vue keeps its own copy on purpose (D13) — sharing it would need a home
// both project/** and http/** may import, which is exactly the Studio<->Api coupling this module
// boundary exists to prevent.
export async function runReveal(
  call: (confirmed: boolean) => Promise<RevealResult>,
  onRevealed: (value: string) => void,
  onError: (message: string) => void,
  prompt: string,
): Promise<void> {
  const handle = async (result: RevealResult): Promise<void> => {
    switch (result.outcome) {
      case 'revealed':
        if (result.value !== null) onRevealed(result.value);
        return;
      case 'cancelled':
        return;
      case 'confirmation-required': {
        const ok = await confirmDialog(prompt, { danger: false });
        if (ok) await handle(await call(true));
        return;
      }
      default:
        onError(result.error ?? 'Could not reveal the value.');
    }
  };
  await handle(await call(false));
}
