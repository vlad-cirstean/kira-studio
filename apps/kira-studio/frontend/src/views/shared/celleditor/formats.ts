import {
  type BeautifyMode,
  type BeautifyResult,
  beautifyJson,
  beautifyXml,
} from '../../../beautify';
import type { EditorLanguageId } from '../../../editor/languages';

/** §8.6's closed vocabulary, decided once (D8). P42 D23/D25: uuid/url dropped (F19 — both were
 *  inert on selection, changing nothing but a label and, for uuid, whether one button was
 *  enabled); reordered common-first (D15) into three groups the picker separates (D27):
 *  read-it-directly formats, then time, then binary encodings. */
export const CELL_FORMATS = [
  'text',
  'json',
  'xml',
  'csv',
  'sql',
  'iso8601',
  'epochSeconds',
  'epochMillis',
  'base64',
  'hex',
] as const;
export type CellFormat = (typeof CELL_FORMATS)[number];

/** P42 D25: only the label changed — 'Time (ISO 8601)' reads more plainly than the wire format's
 *  own name. The key stays `iso8601` (a stored override value and a Playwright attribute);
 *  renaming it would be a migration for a label change. */
export const FORMAT_LABEL: Record<CellFormat, string> = {
  text: 'Plain text',
  json: 'JSON',
  xml: 'XML / HTML',
  csv: 'CSV',
  sql: 'SQL',
  iso8601: 'Time (ISO 8601)',
  epochSeconds: 'Epoch (seconds)',
  epochMillis: 'Epoch (milliseconds)',
  base64: 'Base64',
  hex: 'Hex',
};

/** P42 D28: one sentence per format — the single source both the picker's rows (hover) and its
 *  trigger's own tooltip (the effective format) read, so the two surfaces can't drift. Distinct
 *  from typeGlossary.ts's own per-*column-type* descriptions (`int4`, `timestamptz`): this is
 *  about a *cell format*, a different vocabulary over a different thing. */
export const FORMAT_HELP: Record<CellFormat, string> = {
  text: 'No decoding — the value is shown exactly as stored.',
  json: 'A JSON document — objects and arrays get syntax highlighting and Beautify.',
  xml: 'XML or HTML markup — tags get syntax highlighting and Beautify.',
  csv: 'Comma/tab/semicolon-separated rows, all with the same column count.',
  sql: 'A SQL statement or fragment — gets SQL syntax highlighting.',
  iso8601: 'A calendar date and time, spelled as an ISO-8601 timestamp.',
  epochSeconds: 'A Unix timestamp counted in whole seconds since 1970-01-01 UTC.',
  epochMillis: 'A Unix timestamp counted in milliseconds since 1970-01-01 UTC.',
  base64: 'Bytes encoded as base64 — a decoded-text pane opens below the value.',
  hex: 'Bytes encoded as hexadecimal — a decoded-text pane opens below the value.',
};

/** P42 D27: where one group ends and the next begins in the picker — read-it-directly formats,
 *  then time, then binary encodings that open a decoded-text pane. */
export const FORMAT_GROUPS: readonly (readonly CellFormat[])[] = [
  ['text', 'json', 'xml', 'csv', 'sql'],
  ['iso8601', 'epochSeconds', 'epochMillis'],
  ['base64', 'hex'],
];

/** Which CodeMirror grammar renders a format; `plain` means no language extension. */
export const FORMAT_LANGUAGE: Record<CellFormat, EditorLanguageId> = {
  text: 'plain',
  json: 'json',
  xml: 'xml',
  csv: 'plain',
  sql: 'sql',
  iso8601: 'plain',
  epochSeconds: 'plain',
  epochMillis: 'plain',
  base64: 'plain',
  hex: 'plain',
};

/** True only where a lossless reformatter exists (D11): json and xml. */
export function canBeautify(format: CellFormat): boolean {
  return format === 'json' || format === 'xml';
}

/**
 * Applied to whatever `text` the caller passes in — the current edit buffer (P24 D21), so
 * hand-editing then beautifying formats the edit instead of discarding it. Reversibility
 * (indented <-> compact) comes from both modes being lossless, not from always starting over at
 * the stored value. Offered for `json` and `xml` only (D11); every other format has no lossless
 * formatter and the caller must not invoke this for one (see `canBeautify` above).
 */
export function beautifyFor(format: CellFormat, text: string, mode: BeautifyMode): BeautifyResult {
  if (format === 'json') return beautifyJson(text, mode);
  if (format === 'xml') return beautifyXml(text, mode);
  return { text, ok: false, reason: `${format} has no lossless formatter` };
}
