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

export function buildHoverSource(
  lookup: (doc: string, pos: number) => ConsoleHoverInfo | null,
): HoverTooltipSource {
  return (view, pos): Tooltip | null => {
    const info = lookup(view.state.doc.toString(), pos);
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
