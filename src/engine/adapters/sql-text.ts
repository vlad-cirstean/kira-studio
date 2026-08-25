import { createHash } from 'node:crypto';
import type { SortDirection } from '../../shared/domain/queries';
import { AdapterError } from './errors';

// The genuinely shared, driver-agnostic glue both SQL adapters' read.ts call — kept out of the
// adapter folders because duplicating it would guarantee they drift (§5e). Everything
// dialect-shaped (quoting, LIMIT syntax, catalog SQL) stays in each adapter folder.

export function buildOrderBy(
  terms: { column: string; direction: SortDirection }[],
  quote: (s: string) => string,
): string {
  return terms.map((t) => `${quote(t.column)} ${t.direction.toUpperCase()}`).join(', ');
}

/**
 * Row-value comparison for a keyset boundary: `(col1, col2) > (p1, p2)`. `columns` are already
 * quoted identifiers. `direction`/`mode` select the operator (D7): 'after' compares forward in
 * the requested direction; 'before' — having flipped the ORDER BY and reversed the builder —
 * needs the mirror-image comparison for that same flip.
 */
export function buildKeysetPredicate(
  columns: string[],
  direction: SortDirection,
  mode: 'after' | 'before',
  firstParamIndex: number,
  placeholder: (i: number) => string,
): string {
  const operator = (mode === 'after') === (direction === 'asc') ? '>' : '<';
  const lhs = `(${columns.join(', ')})`;
  const rhs = `(${columns.map((_, i) => placeholder(firstParamIndex + i)).join(', ')})`;
  return `${lhs} ${operator} ${rhs}`;
}

interface PageTokenPayload {
  v: 1;
  k: string[];
  f: string;
}

export function encodePageToken(key: string[], fingerprint: string): string {
  const payload: PageTokenPayload = { v: 1, k: key, f: fingerprint };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function isPageTokenPayload(value: unknown): value is PageTokenPayload {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.v === 1 &&
    Array.isArray(v.k) &&
    v.k.every((x) => typeof x === 'string') &&
    typeof v.f === 'string'
  );
}

/** Throws E_QUERY when the token is malformed or its fingerprint no longer matches. */
export function decodePageToken(token: string, expectedFingerprint: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    throw new AdapterError('E_QUERY', 'malformed page token');
  }
  if (!isPageTokenPayload(parsed)) {
    throw new AdapterError('E_QUERY', 'malformed page token');
  }
  if (parsed.f !== expectedFingerprint) {
    throw new AdapterError(
      'E_QUERY',
      'keyset pagination is unavailable for this request: the token does not match the ' +
        'current filter/sort/projection/page size',
    );
  }
  return parsed.k;
}

export function requestFingerprint(parts: unknown): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}
