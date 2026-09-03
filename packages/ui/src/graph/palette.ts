/**
 * `docs/plans/P4.md` W8: trivial by design, because SVG reads CSS. This file exports only
 * *which class* a lane or node gets — never a colour value. `scripts/gen-lane-palette.ts` owns
 * the actual `--kv-graph-lane-N` tokens and the `.kv-lane-N`/`.kv-node` CSS rules
 * (`packages/ui/src/theme/vscode-tokens.css`) that turn a class into a colour, so a theme switch,
 * a high-contrast kind, and a user's `workbench.colorCustomizations` override all reach the graph
 * through the cascade with **no JavaScript executed** — the bug §3.4 calls "the most visible
 * possible bug" (the graph keeping its old colours after a theme switch) cannot be expressed here.
 */
import { DEFAULT_PALETTE_SIZE } from "@kira-version/core";

/** `"kv-lane-0"` … `"kv-lane-7"` by default, wrapping modulo the palette's own size — a colour
 *  index at or past the palette (two open lanes can legally share a colour once `laneCount`
 *  exceeds the palette) reuses an earlier lane's class rather than naming a CSS rule that does
 *  not exist. */
export function laneClass(colorIndex: number, paletteSize: number = DEFAULT_PALETTE_SIZE): string {
  return `kv-lane-${colorIndex % paletteSize}`;
}

/** The class every *filled* node dot carries in addition to its `laneClass` — defined once here
 *  (`packages/ui/src/theme/vscode-tokens.css`'s generated block) so `rowSvg.ts` never repeats the
 *  literal string, and so a high-contrast kind's outline (`--kv-graph-node-outline*`) applies
 *  uniformly without a second source of truth for which shapes get it. Deliberately **not**
 *  applied to a merge's ring or a stash's ring (`rowSvg.ts`'s `planNode`): those shapes carry
 *  their own always-visible stroke, and `.kv-node`'s own stroke-width defaults to `0` outside a
 *  high-contrast kind, which would silently erase a ring in every ordinary theme. */
export const NODE_CLASS = "kv-node";

/** The three shapes `rowSvg.ts` draws (§7.6/W8's table): ordinary, merge (more than one parent),
 *  stash (a `stash` decoration on the row). */
export type NodeKind = "commit" | "merge" | "stash";

/**
 * Stash takes precedence over merge when a row is both — which a real stash commit always is (it
 * has two parents by construction: the index tree and the working tree), so without this
 * precedence every stash row would render as an ordinary merge, the one place it would disagree
 * with the badge (`refBadges.ts`, W7) and the row's own italic subject (`columns.ts`) about
 * whether this is a stash. `decorationAt` stays the single source either way — this function only
 * orders the two checks that already read it and `parentsOf`.
 */
export function nodeKindFor(parentCount: number, isStash: boolean): NodeKind {
  if (isStash) return "stash";
  return parentCount > 1 ? "merge" : "commit";
}
