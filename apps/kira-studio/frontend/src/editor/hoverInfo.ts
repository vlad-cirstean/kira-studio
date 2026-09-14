// P60b §7: `ConsoleHoverInfo`/`formatHoverValue` moved here verbatim from `editor/hover.ts` — that
// file's other export, `buildHoverSource`, existed only to turn a pure `(doc, pos) => info` lookup
// into a `@codemirror/view` `HoverTooltipSource`; `MonacoHost.vue`'s own hover provider (P60a §4.4)
// plugs a lookup of this exact shape straight in, so that glue has no CodeMirror-era equivalent to
// keep. Both call sites (`sqlHover.ts`, `api/state/variableCompletion.ts`) already only ever used
// these two exports.
export interface ConsoleHoverInfo {
  from: number;
  to: number;
  /** Rendered as separate lines, plain text — no markdown renderer, no new primitive (D8). Every
   *  existing caller (sqlHover.ts) uses this alone: line 0 as a title, the rest as a monospace
   *  detail/description list, all in one visual register — unaffected by `value` below. */
  lines: string[];
  /** Real-interaction fix (reported bug — the {{variable}} hover tooltip's value and its
   *  explanation ran together, all in one undifferentiated block of monospace lines, and a JSON-
   *  shaped value rendered as a single truncated line rather than something readable). Optional —
   *  every existing caller omits it and renders exactly as before. When set, this is the one thing
   *  in the tooltip meant to be *read as data*: pre-wrapped, its own inset block distinct from
   *  `lines` (rendered as a caption underneath, in the muted/secondary treatment `lines` alone
   *  never had before this fix) — variableCompletion.ts's own `hoverAt` supplies a resolved
   *  reference's value here (pretty-printed with `formatHoverValue` below when it parses as JSON)
   *  and moves what used to be the value's own first line ("environment variable", a transform
   *  chain, …) into `lines`, which MonacoHost.vue now renders as the caption instead of an
   *  undifferentiated peer line. */
  value?: string;
}

// Real-interaction fix: "proper JSON/value formatting, not a raw dump" — a resolved variable's
// value is arbitrary text (most often a bare string, sometimes a JSON fragment pasted into an
// environment). Re-indenting it when it actually parses as JSON is a real readability win (nested
// braces on their own lines instead of one long truncated run); anything that doesn't parse is
// shown verbatim, unchanged, since it is not JSON to begin with (a URL, a token, plain prose).
export function formatHoverValue(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
