import Anser from 'anser';

export interface AnsiSegment {
  text: string;
  color?: string;
  background?: string;
  bold: boolean;
  faint: boolean;
}

const rgb = (v: string | null | undefined): string | undefined => (v ? `rgb(${v})` : undefined);

/** One log line's ANSI escapes as styled text segments. */
export function parseAnsi(line: string): AnsiSegment[] {
  if (!line.includes('\u001b')) return [{ text: line, bold: false, faint: false }];
  return Anser.ansiToJson(line, { json: true, remove_empty: true }).map((e) => ({
    text: e.content,
    color: rgb(e.fg),
    background: rgb(e.bg),
    bold: e.decorations.includes('bold'),
    faint: e.decorations.includes('dim'),
  }));
}

export interface HighlightPart {
  text: string;
  match: boolean;
}

/** Splits `text` around case-insensitive occurrences of `needle` (already lower-cased). */
export function splitMatches(text: string, needle: string): HighlightPart[] {
  if (needle === '') return [{ text, match: false }];
  const lower = text.toLowerCase();
  const out: HighlightPart[] = [];
  let at = 0;
  for (let i = lower.indexOf(needle); i !== -1; i = lower.indexOf(needle, at)) {
    if (i > at) out.push({ text: text.slice(at, i), match: false });
    out.push({ text: text.slice(i, i + needle.length), match: true });
    at = i + needle.length;
  }
  if (at < text.length) out.push({ text: text.slice(at), match: false });
  return out;
}
