// M5 §6.2/§6.3: the grid preview's own masking transform and tag cache.
//
// Framing, stated once (§6.1): the grid toggle is a preview, not a control. The security boundary
// is the MCP path (internal/dbmcp/render.go), where the user is not the adversary. This module
// exists so a human can see what an AI client sees, over their own data, on their own machine —
// where they already hold the real values. That is why search and clipboard (elsewhere) stay over
// raw values, and why a cache miss here degrades to *less* information, never a leaked one.

import type { MaskingRule } from '@shared/domain/mask';
import { applyVisible, tag } from '@shared/domain/mask';
import { cellText, isNull, type TabularPage } from '@shared/protocol/page';
import type { CellView } from './page';

/** page.ts's own CellView, plus the one bit cellFormatter needs to draw a masked cell's `#TAG`
 *  suffix muted (`.cell-masked`, SlickGridHost.vue's own cellFormatter) — absent (not `false`) on
 *  every untouched cell, so the common (preview off, or no rule on this column) case allocates
 *  nothing new and stays byte-for-byte what `cell()` already returned. */
export type MaskedCellView = CellView & { masked?: boolean };

/**
 * Builds one page's own tag cache: every distinct real value across every correlating masked
 * column, tagged once (§6.3's own "precompute tags per page, not per render" — SlickGrid's
 * cellFormatter runs synchronously and Web Crypto's HMAC does not). Empty when there is no key
 * (no correlating rule has minted one yet, or the connection has none) — every cache miss then
 * degrades the transform below to redaction without a tag, never a leaked value, only less
 * information (§6.3's own "fail-closed again").
 */
export async function buildMaskTagCache(
  page: TabularPage,
  rules: ReadonlyMap<string, MaskingRule>,
  key: Uint8Array | null,
): Promise<Map<string, string>> {
  const cache = new Map<string, string>();
  if (!key || key.length === 0 || rules.size === 0) return cache;

  const decoder = new TextDecoder();
  const distinct = new Set<string>();
  for (let col = 0; col < page.columns.length; col++) {
    const rule = rules.get(page.columns[col].name.toLowerCase());
    if (!rule?.correlate || rule.kind === 'number') continue;
    const chunk = page.chunks[col];
    for (let row = 0; row < page.rowCount; row++) {
      if (isNull(chunk, row)) continue;
      const value = cellText(chunk, row, decoder);
      // apply()/Apply() never tag an empty string (short-circuit to '' before tagging) — matching
      // that here keeps this cache from minting a tag createMaskPreviewTransform must never use.
      if (value === '') continue;
      distinct.add(value);
    }
  }
  if (distinct.size === 0) return cache;

  await Promise.all(
    Array.from(distinct, async (value) => {
      cache.set(value, await tag(key, value));
    }),
  );
  return cache;
}

/**
 * The synchronous `(CellView, field) => CellView` transform `createDisplayValueExtractor`'s
 * fourth parameter takes (§6.2) — reads the precomputed tag cache above, never awaits.
 *
 * **Always returns a NEW object; never mutates `view` in place.** `page.ts`'s own
 * `store.cachedView` memoises the `CellView` `cell()` returns — writing `view.text = masked`
 * would poison that cache for the tab's lifetime, surviving even after the preview toggles back
 * off, with nothing short of a reload to clear it. This is the single highest-value invariant in
 * this file.
 *
 * A NULL cell, or a column with no matching rule, returns `view` itself unchanged — no
 * allocation, and `masked` stays absent so `cellFormatter` draws it exactly as it does today.
 */
export function createMaskPreviewTransform(
  rules: ReadonlyMap<string, MaskingRule>,
  tagCache: ReadonlyMap<string, string>,
): (view: CellView, field: string) => MaskedCellView {
  return (view, field) => {
    if (view.isNull) return view;
    // Mirror apply()/Apply()'s own value === '' short-circuit: an empty string carries nothing to
    // hide and is never tagged there, so the preview must not mask or tag it here either.
    if (view.text === '') return view;
    const rule = rules.get(field.toLowerCase());
    if (!rule) return view;
    const visible = applyVisible(rule, view.text);
    const suffix = rule.correlate && rule.kind !== 'number' ? (tagCache.get(view.text) ?? '') : '';
    return { text: visible + suffix, isNull: false, truncated: view.truncated, masked: true };
  };
}
