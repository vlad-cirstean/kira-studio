// P11 F18: the renderer's own target/method formatting — shared by the collections tree row
// (CollectionRow.vue, http/**) and the request view (views/grpcrequest/**). Neither side may
// import the other directly (http/** may not import views/**, biome.json), so this lives in
// http/ alongside the tree it already renders for, mirroring http/substitute.ts's own "shared,
// DOM-free helpers" shape.

/** The tree row's own searchable/display text for a gRPC item — "pkg.Service/Method" when both
 *  are known, else just the target. Mirrors the denormalised `method`/`url` pair an HTTP row
 *  already carries (CollectionItemSummary). */
export function grpcMethodDisplay(method: string): string {
  return method || '';
}

/** A short label for the target column — trims a resolver-scheme prefix so the tree row and the
 *  view's own title both read the same way a person typed it, minus load-bearing punctuation. */
export function grpcTargetDisplay(target: string): string {
  return target.trim();
}
