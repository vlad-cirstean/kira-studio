import { lintSql } from '@shared/domain/sql-lint';
import { scanJson, scanXml } from '../../../beautify';
import { BASE64_STD_RE, BASE64_URL_RE, base64ToStd, pickCsvShape } from './detect';
import type { CellFormat } from './formats';
import { parseTimestamp } from './timestamp';

// P42 D26: the format picker's own answer to "is my json broken, or my timestamp wrong" — every
// format validates for real, against the *effective* format (auto or override), on the same
// pure/synchronous 50 ms selection path detect.ts already runs on. An empty value is always
// valid for every format: there is nothing yet to be wrong.

export interface FormatProblem {
  message: string;
  offset?: number;
}

function validateJson(text: string): FormatProblem | null {
  const scan = scanJson(text);
  return scan.ok
    ? null
    : { message: `broken JSON, invalid at offset ${scan.offset}`, offset: scan.offset };
}

function validateXml(text: string): FormatProblem | null {
  const scan = scanXml(text);
  return scan.ok ? null : { message: 'tags do not balance' };
}

function validateCsv(text: string): FormatProblem | null {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { message: 'a single line is never CSV' };
  return pickCsvShape(lines) ? null : { message: 'rows have inconsistent column counts' };
}

function validateSql(text: string): FormatProblem | null {
  const first = lintSql(text).find((i) => i.severity === 'error');
  return first ? { message: first.message, offset: first.from } : null;
}

function validateTimestamp(format: CellFormat, text: string): FormatProblem | null {
  return parseTimestamp(format, text) ? null : { message: 'not a valid timestamp for this format' };
}

// Same shape check the detector itself runs (§5b), minus the score — a value that fails this is
// not decodable as this encoding at all, valid UTF-8 or not.
function validateBase64(text: string): FormatProblem | null {
  const isStd = BASE64_STD_RE.test(text);
  const isUrlSafe = !isStd && BASE64_URL_RE.test(text);
  if (!isStd && !isUrlSafe) return { message: 'not a valid base64 value' };
  try {
    atob(base64ToStd(text, isUrlSafe));
    return null;
  } catch {
    return { message: 'not a valid base64 value' };
  }
}

function validateHex(text: string): FormatProblem | null {
  const digits = text.startsWith('0x') || text.startsWith('0X') ? text.slice(2) : text;
  if (digits.length % 2 !== 0 || /[^0-9a-fA-F]/.test(digits)) {
    return { message: 'not a valid hex value' };
  }
  return null;
}

export function validateFormat(format: CellFormat, text: string): FormatProblem | null {
  const t = text.trim();
  if (t.length === 0) return null;
  switch (format) {
    case 'json':
      return validateJson(t);
    case 'xml':
      return validateXml(t);
    case 'csv':
      return validateCsv(t);
    case 'sql':
      return validateSql(t);
    case 'iso8601':
    case 'epochSeconds':
    case 'epochMillis':
      return validateTimestamp(format, t);
    case 'base64':
      return validateBase64(t);
    case 'hex':
      return validateHex(t);
    case 'text':
      return null;
  }
}
