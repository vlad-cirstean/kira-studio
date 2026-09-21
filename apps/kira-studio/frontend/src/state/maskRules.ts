// M5 §7.2: the one store the Privacy tab (ConnectionDialog.vue), the grid header menu (menu.ts)
// and the grid preview (maskPreview.ts, via SlickGridHost.vue) all share — mirrors
// state/schemas.ts's own shape. No second copy in the dialog's own draft: a rule takes effect
// immediately (it is not part of the connection's save/cancel draft), matching how the header
// menu writes one.
//
// P99 §5.5: the rule list and the masked-column counts both live in TanStack Query's cache
// (queryKeys below), not in a `reactive` — a connectionId absent from the `['maskRules', id]`
// cache means "never loaded" (the same D2-style "absent until loaded" convention schemas.ts
// uses); every real caller now goes through a `useQuery` (ConnectionDialog.vue, SlickGridHost.vue)
// whose own `enabled`/auto-fetch subsumes the old explicit "loaded?" check.

import type { MaskRule, MaskRuleFields } from '@shared/domain/mask';
import { control } from '../bridge/control';
import { queryClient } from './queryClient';

export function maskRulesQueryKey(connectionId: string): readonly ['maskRules', string] {
  return ['maskRules', connectionId] as const;
}

export const maskRuleCountsQueryKey = ['maskRuleCounts'] as const;

export function maskRulesFor(connectionId: string): MaskRule[] {
  return queryClient.getQueryData<MaskRule[]>(maskRulesQueryKey(connectionId)) ?? [];
}

export async function loadMaskRules(connectionId: string): Promise<MaskRule[]> {
  const rules = await control.maskRulesList(connectionId);
  queryClient.setQueryData(maskRulesQueryKey(connectionId), rules);
  // Kept in lockstep with the full list — in the same synchronous write, not re-fetched from
  // Counts() separately — the toolbar's own `hasMaskRules` (DataToolbar.vue) reads this map, and a
  // rule just written from the header menu (menu.ts's markColumnMaskKind) must make that toggle
  // appear in the same tick it also calls setMaskPreview(tabId, true), not on the next full
  // counts reload.
  queryClient.setQueryData<Record<string, number>>(maskRuleCountsQueryKey, (old) => ({
    ...old,
    [connectionId]: rules.length,
  }));
  return rules;
}

// P99 §5.5: upsert/remove re-call loadMaskRules synchronously (not a `useMutation` +
// `invalidateQueries`) — a caller reads maskRulesFor/hasMaskRules right after either resolves
// (menu.ts's own existingMaskRule scan, ConnectionDialog.vue's Privacy tab), and
// `invalidateQueries` alone only refetches an *active* `useQuery` observer, which not every caller
// has one of. Matches state/schemas.ts's own saveDdl: a synchronous cache write, not a fire-and-
// hope invalidate.
export async function upsertMaskRule(
  connectionId: string,
  fields: MaskRuleFields,
): Promise<MaskRule> {
  const rule = await control.maskRulesUpsert(connectionId, fields);
  await loadMaskRules(connectionId);
  // A rule can start or stop correlating on this same edit — the cached key (if any) is still
  // valid either way (keys are never invalidated by a rule edit, only by an explicit
  // regenerate), so it is deliberately left alone here.
  return rule;
}

export async function removeMaskRule(connectionId: string, id: string): Promise<void> {
  await control.maskRulesRemove(id);
  await loadMaskRules(connectionId);
}

// A plain memoised cache, not TanStack Query — never read reactively by any component (only
// correlationKeyFor below reads it), so it needs none of Query's cache/invalidation machinery.
const correlationKeys: Record<string, string> = {};

export async function regenerateMaskKey(connectionId: string): Promise<void> {
  await control.maskRulesRegenerateKey(connectionId);
  // Force the next correlationKeyFor to refetch — every existing tag is now stale.
  delete correlationKeys[connectionId];
  // M7 finding #12: SlickGridHost's own maskPreview/rules watch depends on the `['maskRules',
  // connectionId]` query data's identity, not its contents, and neither that nor maskPreview
  // itself changes here — without this, a tab whose preview is already open on this connection
  // keeps showing its now-stale tag cache (computed under the old key) until some unrelated
  // toggle or reload happens to refresh it. Reassigning to a shallow copy (same rules, new
  // reference) forces that watch to re-run without actually changing any rule.
  const rules = queryClient.getQueryData<MaskRule[]>(maskRulesQueryKey(connectionId));
  if (rules) queryClient.setQueryData(maskRulesQueryKey(connectionId), [...rules]);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Resolves connectionId's own correlation key (§6.3), fetching (and caching) it on first use.
 *  `null` means the connection currently needs no key (no correlating rule) — a real miss, not a
 *  loading state; the grid preview's own tag cache degrades to "no tag" for every value in that
 *  case, per maskPreview.ts's own fail-closed comment. */
export async function correlationKeyFor(connectionId: string): Promise<Uint8Array | null> {
  let hex = correlationKeys[connectionId];
  if (hex === undefined) {
    hex = await control.maskRulesCorrelationKey(connectionId);
    correlationKeys[connectionId] = hex;
  }
  return hex ? hexToBytes(hex) : null;
}

/** The Settings glance's own backend (§7.5) — every connection id with at least one rule, mapped
 *  to its rule count, loaded in one batch call. */
export async function loadMaskRuleCounts(): Promise<Record<string, number>> {
  const counts = await control.maskRulesCounts();
  queryClient.setQueryData(maskRuleCountsQueryKey, counts);
  return counts;
}
