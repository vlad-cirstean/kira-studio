// M5 §7.2: the one store the Privacy tab (ConnectionDialog.vue), the grid header menu (menu.ts)
// and the grid preview (maskPreview.ts, via SlickGridHost.vue) all share — mirrors
// state/connections.ts's own shape. No second copy in the dialog's own draft: a rule takes effect
// immediately (it is not part of the connection's save/cancel draft), matching how the header
// menu writes one.

import type { MaskRule, MaskRuleFields } from '@shared/domain/mask';
import { reactive } from 'vue';
import { control } from '../bridge/control';

export const maskRulesState = reactive({
  // connectionId -> that connection's own rules, ListForConnection order. Absent (not `[]`) means
  // "never loaded" — callers that need "loaded, and empty" vs "not loaded yet" can tell the two
  // apart via maskRulesLoaded below, the same way connectionsState's own records array doesn't
  // need to (it is always loaded at startup).
  byConnection: {} as Record<string, MaskRule[]>,
  // connectionId -> its correlation key, hex-encoded, "" meaning "no key needed" (no correlating
  // rule) — absent means not yet fetched. §6.3's own local-tag-computation seam.
  correlationKeys: {} as Record<string, string>,
  // connectionId -> masked-column count, for the Settings glance (§7.5). Loaded in one batch
  // (loadMaskRuleCounts), not per row.
  counts: {} as Record<string, number>,
});

export function maskRulesFor(connectionId: string): MaskRule[] {
  return maskRulesState.byConnection[connectionId] ?? [];
}

export function maskRulesLoaded(connectionId: string): boolean {
  return connectionId in maskRulesState.byConnection;
}

export async function loadMaskRules(connectionId: string): Promise<MaskRule[]> {
  const rules = await control.maskRulesList(connectionId);
  maskRulesState.byConnection[connectionId] = rules;
  // Kept in lockstep with the full list rather than re-fetched from Counts() separately — the
  // toolbar's own `hasMaskRules` (DataToolbar.vue) reads this map, and a rule just written from
  // the header menu (menu.ts's markColumnMaskKind) must make that toggle appear in the same tick
  // it also calls setMaskPreview(tabId, true), not on the next full-counts reload.
  maskRulesState.counts[connectionId] = rules.length;
  return rules;
}

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

export async function regenerateMaskKey(connectionId: string): Promise<void> {
  await control.maskRulesRegenerateKey(connectionId);
  // Force the next correlationKeyFor to refetch — every existing tag is now stale.
  delete maskRulesState.correlationKeys[connectionId];
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
  let hex = maskRulesState.correlationKeys[connectionId];
  if (hex === undefined) {
    hex = await control.maskRulesCorrelationKey(connectionId);
    maskRulesState.correlationKeys[connectionId] = hex;
  }
  return hex ? hexToBytes(hex) : null;
}

/** The Settings glance's own backend (§7.5) — every connection id with at least one rule, mapped
 *  to its rule count, loaded in one batch call. */
export async function loadMaskRuleCounts(): Promise<Record<string, number>> {
  const counts = await control.maskRulesCounts();
  maskRulesState.counts = counts;
  return counts;
}
