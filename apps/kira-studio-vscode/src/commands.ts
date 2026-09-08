/**
 * G10 D17/D18/D19 — the command-palette audit's one table. Data only: imports types from
 * `@kira/git-ipc` and nothing else, never `vscode` — that is what lets `commands.test.ts` import
 * this file with a plain `bun test`, no extension host required.
 *
 * `MUTATING_COMMANDS` is `Record<MutatingAction, MutatingEntry>` — the same mapped-type totality
 * trick `validate.ts`'s own `EVENT_KEY_MAP` documents at length: a *missing* key is a compile
 * error, so the day `contract.ts` grows a twentieth `OpRequest` kind, this file stops compiling
 * until someone decides what its palette command is. `commands.test.ts` is the other half: it
 * cross-checks this table against `package.json#contributes.commands` (both directions) and
 * against Go's own actually-served op kinds (`gitsession/ops.go`'s `opTable`,
 * `gitsession/remote.go`'s `RunRemote` switch), so a phase that serves a kind here without also
 * registering its command — or the reverse — fails a test rather than shipping a silent gap.
 *
 * `extension.ts`'s `activate()` registers every command straight from `MUTATING_COMMANDS` and
 * `OTHER_COMMANDS` (D19) — there is no second, hand-maintained list of `registerCommand` calls for
 * the two to drift apart from.
 */
import type { OpRequest, RemoteOpParams, UiActionKind } from '@kira/git-ipc';

/** `apps/kira-studio-vscode/package.json#contributes.commands`'s shared category for every
 *  `kiraVersion.*` command — asserted by `commands.test.ts`. */
export const CATEGORY = 'Kira Version';

/** The full set of "an operation that mutates the repository" kinds this extension could ever
 *  register a palette command for: every `OpRequest`/`RemoteOpParams` kind (`op.run`/`remote.run`
 *  cover nineteen and five respectively), plus `undo` (`undo.run`) and `cancel` (`remote.cancel`)
 *  — neither of which is itself an `OpRequest`/`RemoteOpParams` kind, but both mutate state exactly
 *  the way the rest of this union does. */
export type MutatingAction = OpRequest['kind'] | RemoteOpParams['kind'] | 'undo' | 'cancel';

export interface PaletteCommand {
  readonly command: string;
  readonly title: string;
  readonly action: UiActionKind;
}

/** A kind not yet served by any phase's `opTable`/`RunRemote` switch carries the phase that owns
 *  it instead of a command (D18) — G16 owns reset/cherryPick and tagPush/tagDeleteRemote, since
 *  both are push operations that belong with the reset/cherry-pick sweep rather than the stash one.
 *  (Chapter phase insertions moved these off their original G13/G14 labels, which this phase — the
 *  real G13 — now owns outright; F13 is why the labels moved rather than staying wrong.) G17 lands
 *  the five stash kinds' own real commands, so `'G15'` is dropped from this union — it is
 *  unreachable now that every entry that used it is real. Move an entry if a later phase's own plan
 *  takes it differently — this comment, not a fixed assignment, is the source of truth. */
export type MutatingEntry = PaletteCommand | { readonly pending: 'G16' };

/** D17's seventeen served commands plus G17's five stash commands plus D18's four remaining
 *  `pending` placeholders — twenty-six entries in total, one per `MutatingAction` member. See the
 *  plan's own D17 table for the "what it reaches" column; every `PaletteCommand.action` here is
 *  dispatched by `packages/git-ui/src/App.vue`'s `runUiAction`. */
export const MUTATING_COMMANDS: Record<MutatingAction, MutatingEntry> = {
  checkout: { command: 'kiraVersion.checkout', title: 'Checkout…', action: 'openBranchPicker' },
  branchCreate: {
    command: 'kiraVersion.createBranch',
    title: 'Create Branch…',
    action: 'createBranch',
  },
  branchDelete: {
    command: 'kiraVersion.deleteBranch',
    title: 'Delete Branch…',
    action: 'openBranchPicker',
  },
  branchRename: {
    command: 'kiraVersion.renameBranch',
    title: 'Rename Branch…',
    action: 'openBranchPicker',
  },
  tagCreate: { command: 'kiraVersion.createTag', title: 'Create Tag…', action: 'createTag' },
  tagDelete: {
    command: 'kiraVersion.deleteTag',
    title: 'Delete Tag…',
    action: 'openBranchPicker',
  },
  tagPush: { pending: 'G16' },
  tagDeleteRemote: { pending: 'G16' },
  revert: {
    command: 'kiraVersion.revertCommit',
    title: 'Revert Commit…',
    action: 'revertSelected',
  },
  opContinue: {
    command: 'kiraVersion.continueOperation',
    title: 'Continue Operation',
    action: 'continueOperation',
  },
  opAbort: {
    command: 'kiraVersion.abortOperation',
    title: 'Abort Operation',
    action: 'abortOperation',
  },
  opSkip: { command: 'kiraVersion.skipCommit', title: 'Skip Commit', action: 'skipCommit' },
  // G17 D9: stashPush opens the create dialog directly (its own new UiActionKind member,
  // 'stashChanges'); the other four reuse 'openBranchPicker' — the same surface that already
  // contains `StashList.vue`'s own row-level Apply/Pop/Drop/Branch actions (F8), so no new UI is
  // built here, only new palette entry points into what already exists.
  stashPush: {
    command: 'kiraVersion.stashChanges',
    title: 'Stash Changes…',
    action: 'stashChanges',
  },
  stashApply: {
    command: 'kiraVersion.applyStash',
    title: 'Apply Stash…',
    action: 'openBranchPicker',
  },
  stashPop: {
    command: 'kiraVersion.popStash',
    title: 'Pop Stash…',
    action: 'openBranchPicker',
  },
  stashDrop: {
    command: 'kiraVersion.dropStash',
    title: 'Drop Stash…',
    action: 'openBranchPicker',
  },
  stashBranch: {
    command: 'kiraVersion.createBranchFromStash',
    title: 'Create Branch from Stash…',
    action: 'openBranchPicker',
  },
  reset: { pending: 'G16' },
  cherryPick: { pending: 'G16' },
  fetch: { command: 'kiraVersion.fetch', title: 'Fetch', action: 'fetch' },
  pull: { command: 'kiraVersion.pull', title: 'Pull', action: 'pull' },
  push: { command: 'kiraVersion.push', title: 'Push', action: 'push' },
  forcePush: { command: 'kiraVersion.forcePush', title: 'Force Push…', action: 'forcePush' },
  deleteRemoteBranch: {
    command: 'kiraVersion.deleteRemoteBranch',
    title: 'Delete Remote Branch…',
    action: 'openBranchPicker',
  },
  undo: { command: 'kiraVersion.undo', title: 'Undo Last Operation', action: 'undo' },
  cancel: {
    command: 'kiraVersion.cancelRemoteOperation',
    title: 'Cancel Remote Operation',
    action: 'cancelRemoteOperation',
  },
};

export interface OtherCommand {
  readonly command: string;
  readonly title: string;
}

/** The four commands that predate this phase, plus `refresh` (F15/D17's own "plus one non-mutating
 *  addition") — none is a `MutatingAction`, so none belongs in the table above, but `activate()`
 *  still registers all five from data (D19), not a second hand-written list. `refresh` still
 *  reaches the webview through `runUiAction('refresh')`, wired explicitly in extension.ts, since it
 *  isn't one of the contract's mutating kinds. */
export const OTHER_COMMANDS: readonly OtherCommand[] = [
  { command: 'kiraVersion.showConnectionStatus', title: 'Show Connection Status' },
  { command: 'kiraVersion.openRepository', title: 'Open Repository' },
  { command: 'kiraVersion.focusGraph', title: 'Open Git Graph' },
  { command: 'kiraVersion.reviewBranch', title: 'Review Branch Changes' },
  { command: 'kiraVersion.refresh', title: 'Refresh' },
  // G11 D17: this phase's own palette command (SPEC's "each responsible for registering its own
  // palette command when it lands") — routed to the REVIEW webview's own runUiAction, not the
  // graph's, since toggling a reviewed file only makes sense in the review sidebar's Files pane.
  { command: 'kiraVersion.toggleFileReviewed', title: 'Toggle File Reviewed' },
  // G13 D19: the palette route into D9's comment controller — the active editor must be a review
  // branch-side document, or it explains itself rather than doing nothing.
  { command: 'kiraVersion.addReviewComment', title: 'Add Review Comment' },
  // G13 D19: the palette's own route to the Comments pane's copy-for-AI action (G11 D17's exact
  // pattern, `runUiAction('copyReviewComments')`).
  { command: 'kiraVersion.copyReviewComments', title: 'Copy Review Comments' },
  // G13 D9/D19: menu-only (comments/commentThread/context, comments/comment/title) — hidden from
  // the palette (`"when": "false"` in package.json) but still declared here and in the manifest,
  // because commands.test.ts cross-checks both directions (F12) and otherCommandHandlers is total.
  { command: 'kiraVersion.submitReviewComment', title: 'Submit Review Comment' },
  { command: 'kiraVersion.deleteReviewComment', title: 'Delete Review Comment' },
  // G14 D9: the review diff editor's own toolbar, item 7 — reuses G4's existing line-mapped
  // "go to file" capability (`diffToolbar.ts`'s `goToFileFromDiffCommand`). `editor/title`-only in
  // the manifest (F11), same "declared here so commands.test.ts's cross-check covers it" reason
  // as the comment-menu-only pair above.
  { command: 'kiraVersion.goToFileFromDiff', title: 'Go to File' },
  // G14 D10: the review diff editor's own toolbar, item 8 — reveals and selects a commit in the
  // graph webview (`diffToolbar.ts`'s `openCommitInGraphCommand`).
  { command: 'kiraVersion.openCommitInGraph', title: 'Open Commit in Graph' },
  // G15 D2: range/hunk-level review marking's own two commands — the selection-based toolbar/
  // context-menu route, and the explicit-target route the gutter hover's command link and the
  // CodeLens both use (`reviewMarking.ts`'s `markSelectionReviewedCommand`/
  // `markSelectionUnreviewedCommand`).
  { command: 'kiraVersion.markSelectionReviewed', title: 'Mark Selection Reviewed' },
  { command: 'kiraVersion.markSelectionUnreviewed', title: 'Mark Selection Unreviewed' },
];

export type OtherCommandId = (typeof OTHER_COMMANDS)[number]['command'];

export function isPaletteCommand(entry: MutatingEntry): entry is PaletteCommand {
  return 'command' in entry;
}

/** Every command this extension contributes, mutating or not — what `package.json#contributes.
 *  commands` must equal (`commands.test.ts`'s own cross-check, both directions). */
export const ALL_COMMANDS: readonly { command: string; title: string }[] = [
  ...Object.values(MUTATING_COMMANDS).filter(isPaletteCommand),
  ...OTHER_COMMANDS,
];
