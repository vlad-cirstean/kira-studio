/**
 * Fixed copy with substituted values: a string is literal, an object is a variable.
 * `kind: 'branch'` / `'path'` mark a branch name / folder path, rendered as a chip in `variant`.
 */
export type TextPart =
  | string
  | {
      name: string;
      value: string;
      kind?: 'branch' | 'path';
      variant?: 'default' | 'info' | 'warn';
    };

export function plainText(parts: readonly TextPart[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : p.value)).join('');
}
