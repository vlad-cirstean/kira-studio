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

/** P42 D25: only the label changed — 'Time (ISO…)' reads more plainly than the wire format's own
 *  name. The key stays `iso8601` (a stored override value and a Playwright attribute); renaming
 *  it would be a migration for a label change. */
export const FORMAT_LABEL: Record<CellFormat, string> = {
  text: 'Plain text',
  json: 'JSON',
  xml: 'XML / HTML',
  csv: 'CSV',
  sql: 'SQL',
  iso8601: 'Time (ISO…)',
  epochSeconds: 'Epoch (seconds)',
  epochMillis: 'Epoch (milliseconds)',
  base64: 'Base64',
  hex: 'Hex',
};

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
