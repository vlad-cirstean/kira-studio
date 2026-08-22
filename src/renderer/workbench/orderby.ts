// Best-effort parse of the ORDER BY text box (D17): simple `col ASC`/`col DESC` lists. When it does
// not parse, the header arrows are hidden and the text still wins — the text box is the single
// source of truth, never the arrows.

export type SortIndicator = '↑' | '↓';

// term: `"col"`, `` `col` ``, or bare identifier, optionally followed by asc/desc (case-insensitive).
const TERM_RE = /^\s*("[^"]+"|`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)\s*(asc|desc)?\s*$/i;

export function parseOrderBy(text: string): { [column: string]: SortIndicator } | null {
  const trimmed = text.trim();
  if (trimmed === '') return {};
  const terms = trimmed.split(',').map((t) => t.trim()).filter((t) => t !== '');
  const out: { [column: string]: SortIndicator } = {};
  for (const term of terms) {
    const m = TERM_RE.exec(term);
    if (!m) return null;
    const raw = m[1];
    const name = raw[0] === '"' ? raw.slice(1, -1).replaceAll('""', '"') : raw[0] === '`' ? raw.slice(1, -1).replaceAll('``', '`') : raw;
    const dir = m[2] ? m[2].toLowerCase() : 'asc';
    out[name] = dir === 'desc' ? '↓' : '↑';
  }
  return out;
}

// Resolves the parse against the grid's known column names: a term naming an unknown column bails
// the whole parse (no arrows anywhere).
export function parseOrderByResolved(text: string, columns: ReadonlyArray<{ name: string }>): { [column: string]: SortIndicator } | null {
  const parsed = parseOrderBy(text);
  if (parsed === null) return null;
  const names = new Set(columns.map((c) => c.name));
  for (const col of Object.keys(parsed)) {
    if (!names.has(col)) return null;
  }
  return parsed;
}
