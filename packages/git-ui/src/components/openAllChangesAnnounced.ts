import type { DetailActions } from '../state/detailActions.ts';

/**
 * P113 F9: `CommitMeta.vue`'s header action (G-UX item 6) and `ReviewCommitRow.vue`'s own row
 * action (G14 D8 row action 1 / G21 D8c) call this identically — one awaited `openAllChanges`
 * round trip, announced either way (never a silent partial-success or a swallowed rejection).
 */
export async function openAllChangesAnnounced(
  actions: Pick<DetailActions, 'openAllChanges' | 'announce'>,
  target: { sha: string; parentIndex: number | undefined },
): Promise<void> {
  try {
    const { opened, failed, mode } = await actions.openAllChanges(target);
    actions.announce(
      failed === 0
        ? mode === 'multiDiff'
          ? `Opened all ${opened} changed files`
          : `Opened ${opened} files`
        : `Opened ${opened} of ${opened + failed} files — ${failed} couldn't be opened`,
    );
  } catch (err) {
    actions.announce(
      `Couldn't open the changes — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
