import {
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
// `adeTurns`, `adeUi`/`adeActions` writers) so this stays testable with fake deps, no Vue. Archive's
// own send path (`Send to Claude, then archive`, §0.16) lands in this file's own next commit
// (`requestArchive`/`onArchiveTurn`) — Part 4's shipped UI opens no archive dialog (§0.8), so
// `sendDialog`'s archive branch here is unreached until that commit wires it in.

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
  setError: (message: string) => void;
  closeDialog: () => void;
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
    try {
      let watch: TurnWatch | null = null;
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
      const session = deps.ctx.sessions.find((s) => s.id === spec.resume);
      await deliver(
        deps.launch,
        {
          kind: 'launch',
          codeRepoId: deps.ctx.snapshot.codeRepoId,
          branch: '',
          newWorkId: '',
          cwd: session?.cwd ?? deps.ctx.repoRoot,
          resume: session?.claudeSessionId ?? '',
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

/** §0.12 `move` — deliver to the lead's own resolved target, then the caller's own `SetPlan`
 *  (`spec.afterSend`, Part 5's), both before close (mockup order: plan write before close;
 *  ours adds the real delivery Part 5's static demo never needed). */
async function sendMove(deps: SendDialogDeps, spec: DialogSpec, state: DialogState): Promise<void> {
  const message = deliveredMessage(deps.ctx, spec, state);
  const leadId = (spec.ids ?? [])[0];
  if (leadId === undefined) {
    deps.closeDialog();
    return;
  }
  try {
    const tg = targetFor(spec, leadId);
    const choice = tg ? resolvedChoice(deps.ctx, tg) : 'new';
    await deliver(deps.launch, buildDeliverTarget(deps.ctx, leadId, choice, message), () => {});
    spec.afterSend?.();
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
  throw new Error("sendDialog: 'archive' send path lands in this file's own §0.16 commit");
}

export type { TurnOutcome };
