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
 *  it instead of a command (D18) — F9's corrected numbering: G13 owns the five stash kinds, G14
 *  owns reset/cherryPick and (moved here from G7's own "whichever of G12/G13 takes them" note)
 *  tagPush/tagDeleteRemote, since both are push operations that belong with the reset/cherry-pick
 *  sweep rather than the stash one. Move an entry if a later phase's own plan takes it differently
 *  — this comment, not a fixed assignment, is the source of truth. */
export type MutatingEntry = PaletteCommand | { readonly pending: 'G13' | 'G14' };

/** D17's seventeen served commands plus D18's nine `pending` placeholders — twenty-six entries in
 *  total, one per `MutatingAction` member. See the plan's own D17 table for the "what it reaches"
 *  column; every `PaletteCommand.action` here is dispatched by `packages/git-ui/src/App.vue`'s
 *  `runUiAction`. */
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
  tagPush: { pending: 'G14' },
  tagDeleteRemote: { pending: 'G14' },
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
  stashPush: { pending: 'G13' },
  stashApply: { pending: 'G13' },
  stashPop: { pending: 'G13' },
  stashDrop: { pending: 'G13' },
  stashBranch: { pending: 'G13' },
  reset: { pending: 'G14' },
  cherryPick: { pending: 'G14' },
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
