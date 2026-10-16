/** Fixed copy with substituted values: a string is literal, an object is a variable. */
export type TextPart = string | { name: string; value: string };

export function plainText(parts: readonly TextPart[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : p.value)).join('');
}
