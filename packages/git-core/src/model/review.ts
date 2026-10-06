/** 1-based, inclusive, both ends. Always new-side (branch-tip) line numbers on the wire — a
 *  structural copy of `@kira/git-ipc`'s own `LineRange` (G11 D10), kept here so `reviewRanges.ts`
 *  needs no dependency on the wire package (C11 S1). Base resolution itself runs server-side
 *  (`apps/kira-space/internal/gitreview/resolve.go`). */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}
