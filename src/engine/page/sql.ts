import { AdapterError } from '../adapters/errors';

// Shared SELECT / COUNT builder (P2 D6, D12, D13, D18). Both SQL adapters build page SQL through
// this one file; the only dialect differences are the identifier quoter and the placeholder
// function. Assembly rules, in order: SELECT list · FROM quoted parts · WHERE (free text wrapped in
// parentheses, AND-ed with the keyset row comparison when present) · ORDER BY (free text verbatim,
// else the generated PK order) · LIMIT n + 1 (the extra row decides nextToken; the caller drops it
// before encoding) · OFFSET only for offset cursors.

export function assertIdentifier(name: string): void {
  if (name.includes('\0')) {
    throw new AdapterError('E_QUERY', `invalid identifier (contains NUL)`);
  }
}

export function quoteIdentPostgres(name: string): string {
  assertIdentifier(name);
  return `"${name.replaceAll('"', '""')}"`;
}

export function quoteIdentMariadb(name: string): string {
  assertIdentifier(name);
  return `\`${name.replaceAll('`', '``')}\``;
}

export interface SelectSpec {
  quote: (s: string) => string;
  /** already-unquoted name parts, e.g. ['app', 'orders'] or ['shopdb', 'orders'] */
  table: string[];
  /** projection (D18); null ⇒ '*' */
  columns: string[] | null;
  /** free text (D13) */
  where: string;
  /** free text, or generated PK order */
  orderBy: string;
  keyset: {
    columns: string[];
    direction: 'asc' | 'desc';
    values: unknown[];
  } | null;
  limit: number;
  offset: number | null;
  placeholder: (i: number) => string;
}

export function buildSelect(spec: SelectSpec): { text: string; params: unknown[] } {
  const q = spec.quote;
  const parts: string[] = [];

  const selectList =
    spec.columns === null ? '*' : spec.columns.map((c) => q(c)).join(', ');
  parts.push(`SELECT ${selectList}`);

  const table = spec.table.map((t) => q(t)).join('.');
  parts.push(`FROM ${table}`);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (spec.where.trim() !== '') {
    conditions.push(`(${spec.where})`);
  }
  if (spec.keyset && spec.keyset.values.length > 0) {
    const { columns, direction, values } = spec.keyset;
    const placeholders = columns.map((_, i) => spec.placeholder(params.length + 1 + i));
    const operator = direction === 'asc' ? '>' : '<';
    const list = `(${columns.map((c) => q(c)).join(', ')})`;
    conditions.push(`(${list} ${operator} (${placeholders.join(', ')}))`);
    params.push(...values);
  }
  if (conditions.length > 0) {
    parts.push(`WHERE ${conditions.join(' AND ')}`);
  }

  if (spec.orderBy.trim() !== '') {
    parts.push(`ORDER BY ${spec.orderBy}`);
  }

  parts.push(`LIMIT ${spec.limit}`);
  if (spec.offset !== null) parts.push(`OFFSET ${spec.offset}`);

  return { text: parts.join('\n'), params };
}

export function buildCount(spec: Pick<SelectSpec, 'quote' | 'table' | 'where'>): {
  text: string;
  params: unknown[];
} {
  const parts: string[] = [`SELECT COUNT(*)`];
  parts.push(`FROM ${spec.table.map((t) => spec.quote(t)).join('.')}`);
  if (spec.where.trim() !== '') parts.push(`WHERE (${spec.where})`);
  return { text: parts.join('\n'), params: [] };
}
