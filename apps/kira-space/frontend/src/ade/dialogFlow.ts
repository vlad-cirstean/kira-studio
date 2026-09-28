import {
  archiveSpec,
  type DialogCtx,
  type DialogSpec,
  type DialogState,
  type DialogTarget,
  messageForRoot,
  resolvedChoice,
  templateFor,
} from './dialogCompose';
import { type DeliverTarget, deliver, type LaunchDeps } from './launch';
import type { TurnOutcome, TurnWatch } from './turnWatch';

// P129 Part 4 §0.12/§2.1: the Send button's own per-kind delivery — deps injected (mutations,
// `adeTurns`, `adeUi`/`adeActions` writers) so this stays testable with fake deps, no Vue.

/** §0.16's own risk shape (`archiveSpec`'s own `risk` param, minus `blocked` — that field only
 *  matters to `requestArchive`/`onArchiveTurn` below, never to the dialog itself). Kept local
 *  rather than importing `wire.ts`'s `AdeArchiveRisk` — this file never needs its `AdeDirty[]`
 *  shape, only the path strings the templates and the dialog actually read. */
interface ArchiveRisk {
  dirty: string[];
  unmerged: number;
  worktree: string;
  blocked?: string;
}

export interface SendDialogDeps {
  ctx: DialogCtx;
  launch: LaunchDeps;
  turns: { watch: (terminalId: string, opts: { requireSubmit: boolean }) => TurnWatch };
  setQueuedAfter: (args: { codeRepoId: string; item: string; after: string }) => Promise<void>;
  updateNewWork: (args: {
    codeRepoId: string;
    id: string;
    patch: { branchName?: string };
  }) => Promise<void>;
  /** Repo-scoped `rebasing` set writers (`adeActions`'s own `Map<repo, Set<root>>`, one repo's
   *  slice bound in by the store's own thin wrapper). */
  rebasing: { add: (root: string) => void; remove: (root: string) => void };
  dropRoots: (sentIds: string[]) => void;
  /** In-dialog failure (Send, launch, UpdateNewWork, Just delete, §0.17) — shown while the dialog
   *  stays open. Distinct from `setActionError`, which is a *background* failure surfacing after
   *  the dialog already closed. */
  setError: (message: string) => void;
  closeDialog: () => void;
  /** §0.16: archive-only deps. One deps object covers every entry point in this file
   *  (`sendDialog`, `requestArchive`, `justDeleteArchive`) — most of these go unused outside the
   *  archive kind, but building one object keeps the store's own wiring in one place. */
  archive: (args: { item: string; discard: boolean }) => Promise<void>;
  fetchArchiveRisk: (item: string) => Promise<ArchiveRisk>;
  openDialog: (spec: DialogSpec) => void;
  setPendingArchive: (item: string, terminalId: string) => void;
  clearPendingArchive: (item: string) => void;
  setActionError: (message: string) => void;
}

/** §0.16 step 2: `AdeArchiveRisk.blocked`'s own kind (`gitpreflight.WorktreeRemoveBlocker.Kind`) to
 *  a short reason; an unrecognized kind falls back to itself verbatim (plan's own "raw kind as
 *  fallback"). */
const BLOCKED_REASON: Record<string, string> = {
  notAWorktree: 'not a worktree',
  mainWorktree: 'the main worktree',
  currentWorktree: 'the worktree Space itself is open in',
  openInAnotherWindow: 'open in another window',
  locked: 'locked',
};

function blockedMessage(kind: string): string {
  return BLOCKED_REASON[kind] ?? kind;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The message actually delivered for a single-target kind (`start`/`move`/`archive`) — the
 *  mockup's own unedited template, or the user's edited text (`composeDialog`'s own `message`
 *  field, recomputed here since the flow layer never receives a `DialogView`). */
function deliveredMessage(ctx: DialogCtx, spec: DialogSpec, state: DialogState): string {
  return state.msg !== null ? state.msg : templateFor(ctx, spec, state);
}

function branchWorktree(ctx: DialogCtx, itemId: string): string | undefined {
  return ctx.snapshot.branches.find((b) => b.id === itemId)?.worktree || undefined;
}

/** §0.14: a resolved target choice (a running session's own id, or `'new'`) to a `DeliverTarget` —
 *  `'new'` launches on the item's own branch (or `newWorkId`, for a draft), cwd `AdeBranch.worktree`
 *  or the repo root. */
function buildDeliverTarget(
  ctx: DialogCtx,
  itemId: string,
  choice: string,
  message: string,
): DeliverTarget {
  if (choice !== 'new') {
    const session = ctx.sessions.find((s) => s.id === choice);
    return { kind: 'send', sessionId: choice, terminalId: session?.terminalId ?? '', message };
  }
  const isDraft = ctx.snapshot.newWork.some((w) => w.id === itemId);
  return {
    kind: 'launch',
    codeRepoId: ctx.snapshot.codeRepoId,
    branch: isDraft ? '' : itemId,
    newWorkId: isDraft ? itemId : '',
    cwd: branchWorktree(ctx, itemId) ?? ctx.repoRoot,
    resume: '',
    message,
  };
}

function targetFor(spec: DialogSpec, itemId: string): DialogTarget | undefined {
  return spec.targets.find((t) => t.item === itemId);
}

/** §0.12 bullet 2, §0.13, §0.15: mark every root busy upfront, then deliver sequentially — each
 *  root's own message (`messageForRoot`'s multi-root split) to its resolved target, `SetQueuedAfter`
 *  on a non-main `onto` right after that root's own successful delivery (the user's intent, not
 *  gated on the agent's own Stop), and the turn watched in the *background*: the loop moves to the
 *  next root without waiting for `.done`, which only ever clears that one root from `rebasing`. A
 *  delivery failure stops the loop: the failed and every remaining root drop out of `rebasing` (an
 *  already-sent root stays — it is genuinely still in flight), the error surfaces in the still-open
 *  dialog, and `dropRoots` trims the spec to just the roots not yet sent, so a retry resends only
 *  those. */
async function sendRebaseOrQueue(
  deps: SendDialogDeps,
  spec: DialogSpec,
  state: DialogState,
): Promise<void> {
  const roots = spec.roots ?? [];
  for (const root of roots) deps.rebasing.add(root);

  const onto = spec.onto ?? 'main';
  const sentIds: string[] = [];
  for (const root of roots) {
    const tg = targetFor(spec, root);
    const choice = tg ? resolvedChoice(deps.ctx, tg) : 'new';
    const message = messageForRoot(deps.ctx, spec, root, state);
    const target = buildDeliverTarget(deps.ctx, root, choice, message);
    let watch: TurnWatch | null = null;
    try {
      await deliver(deps.launch, target, (terminalId, requireSubmit) => {
        watch = deps.turns.watch(terminalId, { requireSubmit });
      });
      sentIds.push(root);
      if (onto !== 'main') {
        await deps.setQueuedAfter({
          codeRepoId: deps.ctx.snapshot.codeRepoId,
          item: root,
          after: onto,
        });
      }
      void (watch as TurnWatch | null)?.done.then(() => deps.rebasing.remove(root));
    } catch (err) {
      // `deliver`'s own `onArmed` fires before the failure-prone call (`Send`, or the
      // status-check after `openTerminalSession`), so a watch can already be armed for the very
      // delivery that just failed — cancel it, or its `.done` never resolves and leaks forever.
      // The cast defeats TS narrowing `watch` to `never`: it can't see the closure above (passed
      // to `deliver`) as the thing that assigns it.
      (watch as TurnWatch | null)?.cancel();
      for (const r of roots) if (!sentIds.includes(r)) deps.rebasing.remove(r);
      deps.dropRoots(sentIds);
      deps.setError(errMessage(err));
      return;
    }
  }
  deps.closeDialog();
}

/** §0.12 `start` — draft, resume and existing each pick their own delivery target; none of the
 *  three watches its own turn (no busy/pending state gates on a `start` completing, unlike
 *  rebase/queue and archive). */
async function sendStart(
  deps: SendDialogDeps,
  spec: DialogSpec,
  state: DialogState,
): Promise<void> {
  const message = deliveredMessage(deps.ctx, spec, state);
  try {
    if (spec.draft) {
      const branchName = state.branchName.trim();
      const itemId = spec.branch as string;
      if (branchName) {
        await deps.updateNewWork({
          codeRepoId: deps.ctx.snapshot.codeRepoId,
          id: itemId,
          patch: { branchName },
        });
      }
      await deliver(
        deps.launch,
        {
          kind: 'launch',
          codeRepoId: deps.ctx.snapshot.codeRepoId,
          branch: '',
          newWorkId: itemId,
          cwd: deps.ctx.repoRoot,
          resume: '',
          message,
        },
        () => {},
      );
    } else if (spec.resume) {
      // §0.2: the record `spec.resume` names, not the Claude session id — `Tracker.Prepare` looks
      // `Resume` up as the `ade_sessions` record id. A session no longer in `ctx.sessions` (deleted,
      // or a stale dialog left open across a sessions refresh) throws here rather than delivering a
      // launch the relaxed `Validate` would otherwise accept with an empty branch/newWorkId/cwd.
      const session = deps.ctx.sessions.find((s) => s.id === spec.resume);
      if (!session) throw new Error('Session not found');
      await deliver(
        deps.launch,
        {
          kind: 'launch',
          codeRepoId: deps.ctx.snapshot.codeRepoId,
          branch: session.branch,
          newWorkId: session.newWorkId,
          cwd: session.cwd,
          resume: session.id,
          message,
        },
        () => {},
      );
    } else {
      const itemId = spec.branch as string;
      const tg = targetFor(spec, itemId);
      const choice = tg ? resolvedChoice(deps.ctx, tg) : 'new';
      await deliver(deps.launch, buildDeliverTarget(deps.ctx, itemId, choice, message), () => {});
    }
    deps.closeDialog();
  } catch (err) {
    deps.setError(errMessage(err));
  }
}

/** §0.14: the caller's own `SetPlan` (`spec.applyPlan`, Part 5's) runs first, awaited, then delivery
 *  to the lead's own resolved target, both before close (mockup order: plan write before close;
 *  ours adds the real delivery Part 5's static demo never needed). `SetPlan` is idempotent, so this
 *  order means a delivery failure's own retry re-applies the same plan and delivers exactly once —
 *  the reverse order would re-deliver on a plan-write retry instead. */
async function sendMove(deps: SendDialogDeps, spec: DialogSpec, state: DialogState): Promise<void> {
  const message = deliveredMessage(deps.ctx, spec, state);
  const leadId = (spec.ids ?? [])[0];
  if (leadId === undefined) {
    deps.closeDialog();
    return;
  }
  try {
    await spec.applyPlan?.();
    const tg = targetFor(spec, leadId);
    const choice = tg ? resolvedChoice(deps.ctx, tg) : 'new';
    await deliver(deps.launch, buildDeliverTarget(deps.ctx, leadId, choice, message), () => {});
    deps.closeDialog();
  } catch (err) {
    deps.setError(errMessage(err));
  }
}

/** §0.16 "Send to Claude, then archive" background half — runs once the watched turn settles,
 *  after the dialog has already closed. `'ended'` (session ended before any `Stop`) surfaces
 *  directly; nothing to retry against. `'stop'` attempts the real archive; a failure re-fetches
 *  risk rather than branching on Archive's own error code or message: measured against the current
 *  Go implementation, the dirty-worktree rejection (`checkWorktreeRemovable`) is a plain error
 *  routed to `E_INTERNAL`, the same code every other `Archive` failure gets — there is no
 *  `E_INVALID`/`atRisk` signal on the wire to match against (the plan's own assumption doesn't
 *  hold here). So: still-at-risk after the failed attempt means "Claude left changes" (reopen with
 *  fresh risk, same target choice); no risk left means a genuine other failure (`actionError`). */
async function onArchiveTurn(
  deps: SendDialogDeps,
  item: string,
  outcome: TurnOutcome,
  choice: string,
): Promise<void> {
  deps.clearPendingArchive(item);
  if (outcome === 'ended') {
    deps.setActionError("Claude's session ended before archiving; archive again when ready");
    return;
  }
  try {
    await deps.archive({ item, discard: false });
  } catch (err) {
    let risk: ArchiveRisk;
    try {
      risk = await deps.fetchArchiveRisk(item);
    } catch {
      deps.setActionError(errMessage(err));
      return;
    }
    if (risk.dirty.length > 0 || risk.unmerged > 0) {
      const spec = archiveSpec(deps.ctx, item, risk);
      const tg = spec.targets.find((t) => t.item === item);
      if (tg) tg.choice = choice;
      deps.openDialog(spec);
      return;
    }
    deps.setActionError(errMessage(err));
  }
}

/** §0.16 "Send to Claude, then archive" — the archive dialog's own Send button. Delivers to the
 *  resolved target, closes, and watches the turn in the background (`onArchiveTurn`, not awaited
 *  here) — mirrors `sendRebaseOrQueue`'s own fire-and-forget `.done.then(...)`. */
async function sendArchive(
  deps: SendDialogDeps,
  spec: DialogSpec,
  state: DialogState,
): Promise<void> {
  const message = deliveredMessage(deps.ctx, spec, state);
  const itemId = spec.branch as string;
  const tg = targetFor(spec, itemId);
  const choice = tg ? resolvedChoice(deps.ctx, tg) : 'new';
  const target = buildDeliverTarget(deps.ctx, itemId, choice, message);
  let watch: TurnWatch | null = null;
  try {
    await deliver(deps.launch, target, (terminalId, requireSubmit) => {
      watch = deps.turns.watch(terminalId, { requireSubmit });
      deps.setPendingArchive(itemId, terminalId);
    });
    deps.closeDialog();
    void (watch as TurnWatch | null)?.done.then((outcome: TurnOutcome) =>
      onArchiveTurn(deps, itemId, outcome, choice),
    );
  } catch (err) {
    // Same leak risk as `sendRebaseOrQueue`'s own catch, plus the same narrowing cast — `onArmed`
    // may have already recorded a pending archive and armed a watch for the delivery that just
    // failed.
    (watch as TurnWatch | null)?.cancel();
    deps.clearPendingArchive(itemId);
    deps.setError(errMessage(err));
  }
}

/** §0.16 steps 1-4: the initial "Archive" click, before any dialog exists yet — so a failure here
 *  (the risk fetch itself, a blocked reason, or a direct no-risk archive) has no open dialog to
 *  show it in and goes straight to `actionError`. Nothing at risk archives directly (mockup's own
 *  `requestArchive`); otherwise opens the at-risk dialog with the fetched risk. */
export async function requestArchive(deps: SendDialogDeps, item: string): Promise<void> {
  let risk: ArchiveRisk;
  try {
    risk = await deps.fetchArchiveRisk(item);
  } catch (err) {
    deps.setActionError(errMessage(err));
    return;
  }
  if (risk.blocked) {
    deps.setActionError(`Can't archive: ${blockedMessage(risk.blocked)}`);
    return;
  }
  if (risk.dirty.length === 0 && risk.unmerged === 0) {
    try {
      await deps.archive({ item, discard: false });
    } catch (err) {
      deps.setActionError(errMessage(err));
    }
    return;
  }
  deps.openDialog(archiveSpec(deps.ctx, item, risk));
}

/** §0.16 "Just delete" footer button — an in-dialog failure (§0.17: this one shows inside the
 *  still-open dialog, not `actionError` — the user is still looking right at it). */
export async function justDeleteArchive(deps: SendDialogDeps, item: string): Promise<void> {
  try {
    await deps.archive({ item, discard: true });
    deps.closeDialog();
  } catch (err) {
    deps.setError(errMessage(err));
  }
}

/** The dialog's own Send button — dispatches on `spec.kind`. */
export async function sendDialog(
  deps: SendDialogDeps,
  spec: DialogSpec,
  state: DialogState,
): Promise<void> {
  if (spec.kind === 'rebase' || spec.kind === 'queue') return sendRebaseOrQueue(deps, spec, state);
  if (spec.kind === 'move') return sendMove(deps, spec, state);
  if (spec.kind === 'start') return sendStart(deps, spec, state);
  return sendArchive(deps, spec, state);
}
