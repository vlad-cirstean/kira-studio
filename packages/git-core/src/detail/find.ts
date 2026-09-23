/** The subset of `commit.detail`'s result `findChangeInDetail` needs — generic over the file
 *  element type so a caller's own `FileChange` (a `@kira/git-ipc` type; B3 forbids importing it
 *  here) is passed straight through with no cast. */
export interface DetailFileLookup<F extends { readonly path: string }> {
  readonly files: readonly F[];
  readonly parents: readonly string[];
  readonly parentIndex: number;
}

/** Looks `path` up in an already-fetched `commit.detail` result — `undefined` (not a throw) when
 *  `path` is not one of that commit's changed files, so a caller composing `editor.openDiff`'s
 *  `sha`/`fallbackSha` retry can try the fallback next without exception-driven control flow.
 *  Space's `hostHandlers.ts` and the VS Code extension's `proxyHandlers.ts` each fetched the
 *  detail their own way (a raw `Transport['request']` vs a `ConnectionManager`) and duplicated
 *  only this lookup — the fetch itself stays with each caller. */
export function findChangeInDetail<F extends { readonly path: string }>(
  detail: DetailFileLookup<F>,
  path: string,
): { readonly change: F; readonly baseSha: string | null } | undefined {
  const change = detail.files.find((f) => f.path === path);
  if (!change) return undefined;
  return { change, baseSha: detail.parents[detail.parentIndex] ?? null };
}
