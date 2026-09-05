import type { Extension } from '@codemirror/state';
import { RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view';

// P15b D2: CodeMirrorHost.vue's generic "paint these ranges" seam — pure text in, ranges out, the
// exact shape `lintSource` already keeps (diagnostics.ts). The host (and this plugin) never learn
// what a range *means* — a caller (variableCompletion.ts) decides that a `{{name}}` reference is
// resolved/deferred/unknown and hands back only offsets plus a CSS class.
export interface RangeHighlight {
  from: number;
  to: number;
  class: string;
}

// D2's two robustness rules, applied before a RangeSet is ever built: `RangeSet.of` requires its
// input sorted by `from`, and throws on a range whose `to` exceeds the document length or whose
// `from >= to` — a caller computing ranges from a slightly-stale copy of the document (the
// editable body editor, which re-derives ranges on `update:doc` a tick behind the keystroke) must
// degrade to "one keystroke of missing colour", never to an uncaught exception.
function buildDecorations(docLength: number, ranges: readonly RangeHighlight[]): DecorationSet {
  const valid = ranges
    .filter((r) => r.from >= 0 && r.from < r.to && r.to <= docLength)
    .slice()
    .sort((a, b) => a.from - b.from);
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of valid) {
    builder.add(r.from, r.to, Decoration.mark({ class: r.class }));
  }
  return builder.finish();
}

/** Builds the `ViewPlugin` `CodeMirrorHost`'s `rangeCompartment` holds — a `DecorationSet` rebuilt
 *  from `source(doc)` at construction and on every `docChanged` update, mirroring the `lintSource`
 *  pattern (`CodeMirrorHost.vue`'s own `resolveLint`) byte-for-byte. */
export function rangeHighlightPlugin(
  source: (doc: string) => readonly RangeHighlight[],
): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        const text = view.state.doc.toString();
        this.decorations = buildDecorations(text.length, source(text));
      }
      update(update: ViewUpdate): void {
        if (!update.docChanged) return;
        const text = update.state.doc.toString();
        this.decorations = buildDecorations(text.length, source(text));
      }
    },
    { decorations: (instance) => instance.decorations },
  );
}
