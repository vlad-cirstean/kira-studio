import {
  type BeautifyMode,
  type BeautifyResult,
  beautifyJson,
  beautifyXml,
} from '../../../beautify';
import type { EditorLanguageId } from '../../../editor/languages';

/** §8.6's closed vocabulary, decided once (D8) — the same call P1 D4 made for `Caps`. */
export const CELL_FORMATS = [
  'json',
  'xml',
  'sql',
  'base64',
  'hex',
  'epochSeconds',
  'epochMillis',
  'iso8601',
  'uuid',
  'url',
  'csv',
  'text',
] as const;
export type CellFormat = (typeof CELL_FORMATS)[number];

export const FORMAT_LABEL: Record<CellFormat, string> = {
  json: 'JSON',
  xml: 'XML / HTML',
  sql: 'SQL',
  base64: 'Base64',
  hex: 'Hex',
  epochSeconds: 'Epoch (seconds)',
  epochMillis: 'Epoch (milliseconds)',
  iso8601: 'ISO-8601',
  uuid: 'UUID',
  url: 'URL',
  csv: 'CSV',
  text: 'Plain text',
};

/** Which CodeMirror grammar renders a format; `plain` means no language extension. */
export const FORMAT_LANGUAGE: Record<CellFormat, EditorLanguageId> = {
  json: 'json',
  xml: 'xml',
  sql: 'sql',
  base64: 'plain',
  hex: 'plain',
  epochSeconds: 'plain',
  epochMillis: 'plain',
  iso8601: 'plain',
  uuid: 'plain',
  url: 'plain',
  csv: 'plain',
  text: 'plain',
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
