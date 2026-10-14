// Same estimate as internal/memory/importer/tokens.go EstimateTokens: (runes + 2) / 3.
export function estimateTokens(text: string): number {
  return Math.floor((countChars(text) + 2) / 3);
}

/** Characters as Go counts runes: one per code point, not per UTF-16 unit. */
export function countChars(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}
