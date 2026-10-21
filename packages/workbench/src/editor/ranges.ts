// `editor/variableHighlight.ts`'s other export, `rangeHighlightPlugin`, built a `@codemirror/view`
// `ViewPlugin` from a `(doc) => RangeHighlight[]` source; `MonacoHost.vue`'s own `repaintRanges`
// rebuilds a Monaco decorations collection from the same source shape directly, so that
// CodeMirror-specific glue has no equivalent to keep. Every caller (findRanges.ts, the
// request/response body panes, api/state/variableCompletion.ts) only ever used this type,
// never the plugin function.
export interface RangeHighlight {
  from: number;
  to: number;
  class: string;
}
