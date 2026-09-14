import type { MonacoModule } from './monaco';

// P60a §5/D3: `AutocompleteField.vue`'s overlay is paint-only — a full editor per filter field is
// the wrong shape (§5's own OQ-2 recommendation). `monaco.editor.colorize()` already does the
// language -> CSS class mapping this needs (it is what backs the app-wide "kira-editor" theme's
// `mtk*` colours), but its HTML is one flat run per token with no offsets — this module re-derives
// offsets by walking that HTML once, then merges in `{{variable}}`/range-highlight boundaries as a
// second, independent pass so the two never fight over who "owns" a span.

/** A run of text carrying zero or more CSS classes, positioned by document offset. Output of
 *  `mergeHighlightRanges` — never overlapping, never gapped inside `[0, textLength)`. */
export interface ClassRun {
  from: number;
  to: number;
  classes: readonly string[];
}

interface BaseRun {
  from: number;
  to: number;
  classes: readonly string[];
}

interface HighlightRange {
  from: number;
  to: number;
  class: string;
}

/** Pure boundary merge over two sorted-by-construction interval lists: `base` (syntax-colour runs,
 *  expected to tile `[0, textLength)` with no gaps) and `ranges` (`{{variable}}`/find-match
 *  highlights, arbitrary and possibly overlapping each other). Every output run's classes are its
 *  covering base run's classes plus every range's class that covers it — a run with no classes at
 *  all (plain text, no highlight) is dropped, since the caller renders it as bare text.
 *
 *  Degenerate inputs are the point of this function's own unit test (P60a §5/§9.2): a zero-width or
 *  out-of-range `range` (`from >= to`, `from < 0`, `to > textLength`) is clamped or dropped rather
 *  than thrown — the same "one keystroke of missing colour, never a crash" rule
 *  `variableHighlight.ts`'s own `buildDecorations` already keeps for CodeMirror. */
export function mergeHighlightRanges(
  textLength: number,
  base: readonly BaseRun[],
  ranges: readonly HighlightRange[],
): ClassRun[] {
  const validRanges = ranges
    .map((r) => ({ ...r, from: Math.max(0, r.from), to: Math.min(textLength, r.to) }))
    .filter((r) => r.from < r.to);

  const cuts = new Set<number>([0, textLength]);
  for (const b of base) {
    cuts.add(Math.max(0, Math.min(textLength, b.from)));
    cuts.add(Math.max(0, Math.min(textLength, b.to)));
  }
  for (const r of validRanges) {
    cuts.add(r.from);
    cuts.add(r.to);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const out: ClassRun[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    if (from >= to) continue;
    const baseRun = base.find((b) => b.from <= from && from < b.to);
    const classes = [...(baseRun?.classes ?? [])];
    for (const r of validRanges) {
      if (r.from <= from && from < r.to) classes.push(r.class);
    }
    if (classes.length === 0) continue;
    out.push({ from, to, classes });
  }
  return out;
}

// `monaco.editor.colorize()`'s own HTML shape (verified against the pinned 0.56.0's
// `viewLineRenderer.js`): one line is `<span>` wrapping a flat run of
// `<span class="mtkN">…text…</span>` (entities `&lt;`/`&gt;`/`&amp;` only — colorize is called with
// `renderWhitespace` off, so no `mtkw`/`mtkz` width-span case ever appears here), terminated by
// `<br/>`. AutocompleteField's overlay is always single-line (`singleLine` was CodeMirrorHost's own
// contract for this component; there is exactly one line to parse.
const TOKEN_SPAN_RE = /<span class="([^"]+)">([\s\S]*?)<\/span>/g;

function decodeEntities(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Parses one line of `colorize()`'s HTML into offset-positioned base runs. Exported for the unit
 *  test; not meant to be called outside this module in production code. */
export function parseColorizedLine(html: string): { text: string; runs: BaseRun[] } {
  let text = '';
  const runs: BaseRun[] = [];
  TOKEN_SPAN_RE.lastIndex = 0;
  for (let match = TOKEN_SPAN_RE.exec(html); match !== null; match = TOKEN_SPAN_RE.exec(html)) {
    const className = match[1];
    const decoded = decodeEntities(match[2]);
    const from = text.length;
    text += decoded;
    runs.push({ from, to: text.length, classes: [className] });
  }
  return { text, runs };
}

/** Renders `text` as syntax-highlighted, `{{variable}}`/find-match-highlighted HTML — the whole of
 *  `AutocompleteField.vue`'s overlay in one call. `colorize()` is `async` (it correctly awaits a
 *  Monarch grammar's own lazy load, `monacoEntry.ts`'s `registerTokensProviderFactory`); the first
 *  paint before it resolves is plain, unstyled text, same graceful degradation `MonacoHost.vue`'s
 *  own pending state uses for the same reason. */
export async function paintOverlayHtml(
  mod: MonacoModule,
  text: string,
  languageId: string,
  ranges: readonly HighlightRange[],
): Promise<string> {
  if (text === '') return '';
  const colorized = await mod.editor.colorize(text, languageId, { tabSize: 2 });
  const { text: parsedText, runs } = parseColorizedLine(colorized);
  // A colorize() mismatch (a future Monaco version changing its HTML shape) degrades to plain
  // escaped text rather than silently mis-painting — checked once here, not assumed.
  if (parsedText !== text) return escapeHtml(text);
  const merged = mergeHighlightRanges(text.length, runs, ranges);
  let html = '';
  let cursor = 0;
  for (const run of merged) {
    if (run.from > cursor) html += escapeHtml(text.slice(cursor, run.from));
    html += `<span class="${run.classes.join(' ')}">${escapeHtml(text.slice(run.from, run.to))}</span>`;
    cursor = run.to;
  }
  if (cursor < text.length) html += escapeHtml(text.slice(cursor));
  return html;
}

/** `document.caretPositionFromPoint`/`caretRangeFromPoint` (WebKit ships the latter only, as of
 *  this pin) walked back to a document character offset — DOM-native, exact, and font-agnostic,
 *  the two properties §5's own comment says CodeMirror's coordinate hit-testing was chosen *for*
 *  originally. `null` when the point falls outside the overlay entirely, matching
 *  `MonacoHost.posAtCoords`'s own contract. */
export function overlayOffsetAtPoint(overlayEl: HTMLElement, x: number, y: number): number | null {
  const doc = overlayEl.ownerDocument;
  let node: Node | null = null;
  let nodeOffset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return null;
    node = pos.offsetNode;
    nodeOffset = pos.offset;
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    if (!range) return null;
    node = range.startContainer;
    nodeOffset = range.startOffset;
  } else {
    return null;
  }
  if (!node || !overlayEl.contains(node)) return null;
  const walker = doc.createTreeWalker(overlayEl, NodeFilter.SHOW_TEXT);
  let total = 0;
  for (let current = walker.nextNode(); current; current = walker.nextNode()) {
    if (current === node) return total + nodeOffset;
    total += current.textContent?.length ?? 0;
  }
  return null;
}
