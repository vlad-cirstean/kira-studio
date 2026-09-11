/**
 * P5 — the pure algebra beneath `blameWidget.ts`'s own `vscode`-facing controller, the same split
 * `reviewMarking.ts`/`reviewRanges.ts` already establish for a different feature: no `vscode`
 * import, importable and testable with plain `bun test`.
 */
import { blameAge } from './blameAge.ts';

/** The sentinel `porcelain.UncommittedBlameSHA`/`blame.line`'s own wire result use for a line
 *  whose content isn't in any commit yet (an unstaged, on-disk edit) — mirrored here as the
 *  literal string both the contract's own doc comment and the Go side already carry. */
export const UNCOMMITTED_BLAME_SHA = '0000000000000000000000000000000000000000';

export type BlameDisplayState =
  | { readonly kind: 'none' }
  | { readonly kind: 'dirty' }
  | { readonly kind: 'uncommitted' }
  | {
      readonly kind: 'resolved';
      readonly repoId: string;
      readonly sha: string;
      readonly author: string;
      readonly authorTimeSeconds: number;
      readonly summary: string;
    };

/** The pure decision this phase adds to `updateStatusBar`'s own render: given a document's dirty
 *  state and (once resolved) a `blame.line` result, which of the four display states applies. */
export function selectBlameDisplayState(
  input:
    | { readonly kind: 'dirty' }
    | { readonly kind: 'none' }
    | {
        readonly kind: 'result';
        readonly repoId: string;
        readonly sha: string;
        readonly author: string;
        readonly authorTimeSeconds: number;
        readonly summary: string;
      },
): BlameDisplayState {
  switch (input.kind) {
    case 'dirty':
      return { kind: 'dirty' };
    case 'none':
      return { kind: 'none' };
    case 'result':
      if (input.sha === UNCOMMITTED_BLAME_SHA) return { kind: 'uncommitted' };
      return {
        kind: 'resolved',
        repoId: input.repoId,
        sha: input.sha,
        author: input.author,
        authorTimeSeconds: input.authorTimeSeconds,
        summary: input.summary,
      };
  }
}

/** `<author>, <age>` — the status-bar text's own trailing segment once a line resolves. */
export function blameStatusText(
  state: Extract<BlameDisplayState, { kind: 'resolved' }>,
  nowMs?: number,
): string {
  return `${state.author}, ${blameAge(state.authorTimeSeconds, nowMs)}`;
}
