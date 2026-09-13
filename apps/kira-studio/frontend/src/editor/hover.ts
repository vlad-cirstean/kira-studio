import { syntaxTree } from '@codemirror/language';
import type { HoverTooltipSource, Tooltip } from '@codemirror/view';

// P18 (v1.1) D8/F9: turns a pure text-in lookup into a real CodeMirror HoverTooltipSource — the
// same "pure data in, no EditorView at the call site" discipline CodeMirrorHost.vue's own
// lintSource prop already keeps (diagnostics.ts). A caller (sqlHover.ts) never imports
// @codemirror/view or touches an EditorView; this module is the one place that DOM- and
// Tooltip-building glue lives, so CodeMirrorHost.vue's own resolveHover() just plugs the result
// straight into hoverTooltip().
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
   *  chain, …) into `lines`, which this file now renders as the caption instead of an
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

// P12 round 2 finding #11: `syntaxTree(view.state)` reads the tree `@codemirror/language` already
// maintains incrementally as the document changes — this is the one module allowed to touch it, so
// the tree is read once here and handed to `lookup` rather than making every caller re-parse the
// whole document from scratch on every hover. `T` is left to the caller (never named here) so this
// module stays as SQL-agnostic as the "no EditorView at the call site" docstring above already
// requires — sqlHover.ts is the only caller, and it alone knows what a `Tree`'s `topNode` means.
export function buildHoverSource<T>(
  lookup: (doc: string, pos: number, tree: T) => ConsoleHoverInfo | null,
): HoverTooltipSource {
  return (view, pos): Tooltip | null => {
    const tree = syntaxTree(view.state).topNode as unknown as T;
    const info = lookup(view.state.doc.toString(), pos, tree);
    if (!info) return null;
    return {
      pos: info.from,
      end: info.to,
      above: true,
      create: () => {
        const dom = document.createElement('div');
        dom.className = 'cm-kira-hover';
        // Real-interaction fix: `value`, when present, is the one thing here meant to be read as
        // data — its own inset block, pre-wrapped (a pretty-printed JSON value keeps its line
        // breaks), visually first and most prominent. `lines` becomes its caption underneath,
        // rendered in the muted/secondary treatment `.cm-kira-hover-caption` gives it (theme.ts) —
        // distinct from the value, and from `.cm-kira-hover-line`'s own plain treatment every
        // existing caller (sqlHover.ts, no `value`) still gets unchanged below.
        if (info.value !== undefined) {
          const valueEl = document.createElement('pre');
          valueEl.className = 'cm-kira-hover-value';
          valueEl.textContent = info.value;
          dom.appendChild(valueEl);
        }
        for (const line of info.lines) {
          const row = document.createElement('div');
          row.className = info.value !== undefined ? 'cm-kira-hover-caption' : 'cm-kira-hover-line';
          row.textContent = line;
          dom.appendChild(row);
        }
        return { dom };
      },
    };
  };
}
