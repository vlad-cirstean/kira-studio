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
  /** Rendered as separate lines, plain text — no markdown renderer, no new primitive (D8). */
  lines: string[];
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
        for (const line of info.lines) {
          const row = document.createElement('div');
          row.className = 'cm-kira-hover-line';
          row.textContent = line;
          dom.appendChild(row);
        }
        return { dom };
      },
    };
  };
}
