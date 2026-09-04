/**
 * The only palette `core` invents (§3.4): a lane -> integer, never a lane -> hex colour. The
 * hex values live in `packages/ui`'s theme token layer; a `core` package that knew a colour
 * string would violate §6.1's token-only rule.
 */
import type { ColorState } from './types';

export const DEFAULT_PALETTE_SIZE = 8;

export function initialColorState(paletteSize: number = DEFAULT_PALETTE_SIZE): ColorState {
  return { nextColor: 0, paletteSize };
}

/**
 * Chooses a colour for a lane being opened, starting from `state.nextColor` and rotating
 * through the palette, skipping any colour already in use by an immediately adjacent open
 * lane when a free one is available. Deterministic — the same state and neighbours always
 * choose the same colour, which is what keeps two layout runs over the same topology
 * byte-identical and is why the P4 visual-regression suite can screenshot it at all.
 *
 * Bounded by `paletteSize` iterations regardless of how many neighbours are passed, so a
 * palette of size 1 (or a neighbour set covering every colour) degrades to "everything colour
 * 0" instead of looping forever.
 */
export function allocateColor(state: ColorState, neighbours: readonly number[]): number {
  const inUse = new Set(neighbours);
  let candidate = state.nextColor % state.paletteSize;
  for (let i = 0; i < state.paletteSize; i++) {
    if (!inUse.has(candidate)) return candidate;
    candidate = (candidate + 1) % state.paletteSize;
  }
  // Every colour is in use by a neighbour (only possible when paletteSize <= neighbours.size)
  // — fall back to the rotating counter's own next value rather than looping.
  return state.nextColor % state.paletteSize;
}

/** The state to carry forward after `allocateColor` returns `color` — call sites bump the
 *  rotating counter themselves so `allocateColor` stays a pure function of its inputs. */
export function advanceColorState(state: ColorState, color: number): ColorState {
  return { nextColor: (color + 1) % state.paletteSize, paletteSize: state.paletteSize };
}
