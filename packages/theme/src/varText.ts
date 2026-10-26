/**
 * Fixed copy with substituted values: a string is literal, an object is a variable.
 * `kind: 'branch'` marks a branch name, rendered as a branch chip.
 */
export type TextPart = string | { name: string; value: string; kind?: 'branch' };

export function plainText(parts: readonly TextPart[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : p.value)).join('');
}
