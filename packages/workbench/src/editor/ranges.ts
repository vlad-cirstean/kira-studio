// P60b §7: `RangeHighlight` moved here verbatim from `editor/variableHighlight.ts` — that file's
// other export, `rangeHighlightPlugin`, built a `@codemirror/view` `ViewPlugin` from a
// `(doc) => RangeHighlight[]` source; `MonacoHost.vue`'s own `repaintRanges` (P60a §4.3) rebuilds a
// Monaco decorations collection from the same source shape directly, so that CodeMirror-specific
// glue has no equivalent to keep. Every caller (findRanges.ts, the request/response body panes,
// api/state/variableCompletion.ts) only ever used this type, never the plugin function.
export interface RangeHighlight {
  from: number;
  to: number;
  class: string;
}
