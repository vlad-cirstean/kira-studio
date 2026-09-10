/**
 * `docs/plans/P6.md` W14: `RowContextMenu.vue`'s pure half. What is present, what is absent, and
 * what is present-but-disabled-with-a-reason is exactly the thing a later phase edits (§10's
 * exit table grows this same menu at P9/P10), so it lives as one testable table
 * (`buildRowMenu`/`buildRefMenu`) rather than template `v-if` conditionals.
 */
import { canRunOp, describeInProgress } from '@kira/git-core';
import type {
  DecorationRef,
  InProgressOperation,
  OpRequest,
  RefKind,
  StashEntry,
} from '@kira/git-ipc';
// G19 D3b: MenuItem/MenuSection now live in @kira/kira-ui — the shapes are identical by
// construction, just re-exported from here so every existing importer of `./rowMenuModel.ts`
// keeps working unchanged.
import type { MenuItem, MenuSection } from '@kira/kira-ui';
import { applyMenuLabel, originLabel } from './stashListModel.ts';

export type { MenuItem, MenuSection };

function gatedItem(
  id: string,
  label: string,
  opKind: OpRequest['kind'],
  inProgress: InProgressOperation | null,
  icon?: string,
  danger?: boolean,
): MenuItem {
  const allowed = canRunOp(inProgress, opKind);
  return {
    id,
    label,
    disabled: !allowed,
    disabledReason: allowed || inProgress === null ? undefined : describeInProgress(inProgress),
    icon,
    danger,
  };
}

function plainItem(id: string, label: string, icon?: string): MenuItem {
  return { id, label, disabled: false, disabledReason: undefined, icon };
}

export interface CommitMenuContext {
  readonly sha: string;
  readonly decorations: readonly DecorationRef[];
  readonly inProgress: InProgressOperation | null;
  readonly clipboardEnabled: boolean;
}

/**
 * §6.4's per-commit menu, against the phase's own table: checkout (detached, gated same as the
 * picker's own checkout — §7.11 is scoped to the op kind, not to where it was invoked from),
 * create branch/tag here (never gated — git does not refuse either mid-op), revert this commit
 * (gated). `docs/plans/P10.md` W15 fills in the two items P6's own comment here used to call
 * "open question 2/absent-by-plan": reset and cherry-pick, both gated the same way, placed after
 * revert. Copy sha/copy message reuse P5's `clipboardActions.ts` and are absent (not disabled)
 * when the host has no clipboard port, matching `FileTree.vue`'s own
 * `actions.capabilities.clipboard` gate.
 */
export function buildRowMenu(ctx: CommitMenuContext): MenuSection[] {
  const mutating: MenuItem[] = [
    gatedItem(
      'checkoutDetached',
      'Checkout this commit (detached HEAD)',
      'checkout',
      ctx.inProgress,
      'codicon-check',
    ),
    plainItem('createBranchHere', 'Create branch here…', 'codicon-git-branch'),
    plainItem('createTagHere', 'Create tag here…', 'codicon-tag'),
    gatedItem(
      'revertThisCommit',
      'Revert this commit…',
      'revert',
      ctx.inProgress,
      'codicon-history',
      true,
    ),
    gatedItem(
      'resetToThisCommit',
      'Reset to this commit…',
      'reset',
      ctx.inProgress,
      'codicon-debug-step-back',
      true,
    ),
    gatedItem(
      'cherryPickThisCommit',
      'Cherry-pick this commit…',
      'cherryPick',
      ctx.inProgress,
      'codicon-git-commit',
    ),
  ];
  const sections: MenuSection[] = [{ items: mutating }];
  if (ctx.clipboardEnabled) {
    sections.push({
      items: [
        plainItem('copySha', 'Copy SHA', 'codicon-copy'),
        plainItem('copyMessage', 'Copy commit message', 'codicon-copy'),
      ],
    });
  }
  return sections;
}

/**
 * `docs/plans/P7.md` W13 — the review view's own per-commit menu: copy sha and copy message
 * *only* (§6.8's "Read-only" — a review row offers no checkout/branch/tag/revert, and is never
 * gated on `canRunOp`, since none of these items are operations git could refuse mid-op). Kept
 * separate from `buildRowMenu` rather than that function gated down to nothing by a flag, so a
 * reader never has to check "which of these does the review row actually get" against a table of
 * conditions — there is no table, there is a second, smaller function. Absent (not disabled, same
 * convention `buildRowMenu` already uses) when the host has no clipboard port.
 */
export function buildReviewRowMenu(clipboardEnabled: boolean): MenuSection[] {
  if (!clipboardEnabled) return [];
  return [
    {
      items: [
        plainItem('copySha', 'Copy SHA', 'codicon-copy'),
        plainItem('copyMessage', 'Copy commit message', 'codicon-copy'),
      ],
    },
  ];
}

/**
 * `docs/plans/G19.md` D7: `FileTree.vue`'s right-click "Copy path" menu — one item, deliberately
 * not the two-affordance duplication `ReviewCommitRow.vue` used to carry (removed by this same
 * decision) — built directly against `@kira/kira-ui`'s own `MenuItem` type from the start,
 * matching every other menu-building function in this file. G21 D11: this is now the one copy-
 * path affordance in every tree, not only the review-styled ones it started out scoped to.
 */
export function buildFileRowMenu(clipboardEnabled: boolean): MenuSection[] {
  if (!clipboardEnabled) return [];
  return [{ items: [plainItem('copyPath', 'Copy path', 'codicon-copy')] }];
}

export interface RefMenuContext {
  readonly kind: RefKind;
  readonly shortName: string;
  readonly isHead: boolean;
  /** Set (a remote name) when a lightweight/annotated tag also exists on that remote — the delete
   *  entry's own asymmetry warning (§7.9: deleting locally does not delete on the remote) is
   *  worded differently depending on whether this is even reachable for this tag. */
  readonly knownRemotes: readonly string[];
  readonly inProgress: InProgressOperation | null;
  /** G26 D-4.14: this branch's own stack membership — `undefined` when the caller has no stack
   *  view mounted at all (a tag/remoteBranch row, or a host with no `StackState`), matching
   *  `buildRowMenu`'s own "absent, not disabled" convention for a capability that simply is not
   *  there. Meaningless for `kind !== 'branch'` (a tag/remote-tracking ref is never a stack
   *  member) and ignored for those. */
  readonly stack?: {
    /** This branch has a recorded stack parent (D1) — gates "Remove from stack"/"Restack this
     *  stack"/"Go to parent branch". */
    readonly hasParent: boolean;
    /** Some other branch records this one as ITS parent — gates "Go to child branch". */
    readonly hasChild: boolean;
  };
}

/**
 * §6.6's "every mutating action is available from a context menu on the row it applies to", read
 * literally for a ref: the row a branch/tag operation applies to is the ref itself (the picker's
 * own row, or — once wired — the graph's own ref badge), not the commit it happens to point at.
 * Branch: checkout/rename/delete. Tag: checkout/delete/push/delete-on-remote (the last two only
 * where a remote is actually known — P6 has no `remotes.list` endpoint of its own, so
 * `knownRemotes` is derived from the already-loaded `remoteBranches` list rather than a second
 * round trip; see `remoteNamesFrom` below).
 */
export function buildRefMenu(ctx: RefMenuContext): MenuSection[] {
  if (ctx.kind === 'tag') {
    const items: MenuItem[] = [
      gatedItem('checkoutRef', 'Checkout', 'checkout', ctx.inProgress, 'codicon-check'),
      gatedItem('deleteRef', 'Delete tag', 'tagDelete', ctx.inProgress, 'codicon-trash', true),
    ];
    for (const remote of ctx.knownRemotes) {
      items.push(plainItem(`pushRef:${remote}`, `Push to ${remote}`, 'codicon-cloud'));
      items.push({
        id: `deleteRemoteRef:${remote}`,
        label: `Delete on ${remote}`,
        disabled: false,
        disabledReason: undefined,
        icon: 'codicon-trash',
        danger: true,
      });
    }
    return [{ items }];
  }
  // branch or remoteBranch — a remote-tracking ref itself is read-only here (its only action is
  // the checkout the picker's row already offers); rename/delete apply to a local branch only.
  // `docs/plans/P7.md` W14: "Review branch changes" is offered for both — it is a read, never
  // gated on `canRunOp` (§7.11's in-progress gate is about operations git would refuse), and is
  // absent for a tag entirely (a tag is a point, not a line of development — `<base>..<tag>` is
  // not the question §6.8 answers).
  if (ctx.kind === 'remoteBranch') {
    return [
      {
        items: [
          gatedItem('checkoutRef', 'Checkout', 'checkout', ctx.inProgress, 'codicon-check'),
          plainItem('reviewBranch', 'Review branch changes', 'codicon-diff-multiple'),
        ],
      },
    ];
  }
  const items: MenuItem[] = [
    gatedItem('checkoutRef', 'Checkout', 'checkout', ctx.inProgress, 'codicon-check'),
    plainItem('renameRef', 'Rename branch…', 'codicon-edit'),
    plainItem('reviewBranch', 'Review branch changes', 'codicon-diff-multiple'),
  ];
  // git refuses to delete the branch you are currently on — not one of §7.11's gated op kinds
  // (the gate is scoped to what an in-progress *operation* blocks), so this is its own, simpler
  // disablement with its own reason.
  items.push(
    ctx.isHead
      ? {
          id: 'deleteRef',
          label: 'Delete branch',
          disabled: true,
          disabledReason: 'This is the current branch.',
          icon: 'codicon-trash',
          danger: true,
        }
      : gatedItem(
          'deleteRef',
          'Delete branch',
          'branchDelete',
          ctx.inProgress,
          'codicon-trash',
          true,
        ),
  );
  const sections: MenuSection[] = [{ items }];
  // G26 D-4.14: a second section, present only when the caller actually has a stack view mounted
  // (`ctx.stack !== undefined`) — never gated on `canRunOp` (stackSet/restack are config/rebase
  // writes, not one of §7.11's in-progress-blocked kinds), matching "Review branch changes"'
  // own un-gated posture just above.
  if (ctx.stack !== undefined) {
    const stackItems: MenuItem[] = [
      plainItem(
        'stackSetParent',
        ctx.stack.hasParent ? 'Change stack parent…' : 'Set stack parent…',
        'codicon-list-tree',
      ),
    ];
    if (ctx.stack.hasParent) {
      stackItems.push(plainItem('stackRemove', 'Remove from stack', 'codicon-close'));
      stackItems.push(plainItem('stackRestack', 'Restack this stack', 'codicon-sync'));
      stackItems.push(plainItem('stackGoToParent', 'Go to parent branch', 'codicon-arrow-up'));
    }
    if (ctx.stack.hasChild) {
      stackItems.push(plainItem('stackGoToChild', 'Go to child branch', 'codicon-arrow-down'));
    }
    sections.push({ items: stackItems });
  }
  return sections;
}

/**
 * `docs/plans/P9.md` W14: §7.6's per-stash menu — Apply, Pop, Drop, Branch (all gated on
 * `canRunOp`, exactly as every other stack-mutating action is; `stashDrop` reads as un-gated in
 * practice only because `core`'s own `GATED_OP_KINDS` never lists it — see `model/operation.ts`'s
 * own comment) and Show (a read, never gated, mirroring `buildRowMenu`'s copy actions). One
 * section — there is no clipboard-conditional second section here, unlike `buildRowMenu`, since a
 * stash row's sha is already visible via `StashList.vue`/the badge's own title, not a menu item.
 *
 * G28 D5 widens this by two behaviors, both keyed off `entry`/`currentBranch`: the Apply label
 * reads `"Apply here (from <origin>)"` for a cross-branch entry (`applyMenuLabel`), and Pop is
 * OMITTED entirely for one — popping a stash from another branch drops it from the stack on
 * success, which for the "I'll want this back on `main` later" case is a trap; Apply (which keeps
 * the entry, probe P1) is the correct verb across a branch boundary, and the menu says so instead
 * of leaving both and hoping the user picks correctly. G28 D13 also adds "Save to global stash…"
 * — the row-level entry point `StashDialog.vue`'s fourth mode needs to pre-select THIS entry as
 * its source (D10 step 3, "promote an existing entry"), never gated (saving never fails the way a
 * git write can; the source stays untouched either way, D10's own copy-never-drop guarantee).
 */
export function buildStashMenu(
  inProgress: InProgressOperation | null,
  entry: StashEntry,
  currentBranch: string | null | undefined,
): MenuSection[] {
  const crossBranch = originLabel(entry, currentBranch) !== undefined;
  const items: MenuItem[] = [
    gatedItem(
      'stashApply',
      applyMenuLabel(entry, currentBranch),
      'stashApply',
      inProgress,
      'codicon-diff-added',
    ),
  ];
  if (!crossBranch) {
    items.push(gatedItem('stashPop', 'Pop', 'stashPop', inProgress, 'codicon-export'));
  }
  items.push(
    gatedItem('stashDrop', 'Drop', 'stashDrop', inProgress, 'codicon-trash', true),
    gatedItem(
      'stashBranch',
      'Create branch from stash…',
      'stashBranch',
      inProgress,
      'codicon-git-branch',
    ),
    plainItem('stashSaveGlobal', 'Save to global stash…', 'codicon-archive'),
    plainItem('stashShow', 'Show changes', 'codicon-eye'),
  );
  return [{ items }];
}

/**
 * G28 D12/D13: the global bucket's own row menu — Apply here, Create branch from this…, Show
 * changes, Remove from global stash. NO Pop, NO Drop: both are position-addressed by necessity
 * (probe 8) and a global entry has no stack position at all — Apply-plus-Remove is the honest pair
 * for a keep-forever entry. `stashApply`/`stashBranch` reuse the SAME `OpRequest['kind']` gates
 * `buildStashMenu` uses (the op kinds themselves are unchanged for a global entry, D12 — only how
 * the server resolves the source sha differs); `globalStashRemove` is its own gate.
 */
export function buildGlobalStashMenu(
  inProgress: InProgressOperation | null,
  entry: StashEntry,
  currentBranch: string | null | undefined,
): MenuSection[] {
  return [
    {
      items: [
        gatedItem(
          'stashApply',
          applyMenuLabel(entry, currentBranch),
          'stashApply',
          inProgress,
          'codicon-diff-added',
        ),
        gatedItem(
          'stashBranch',
          'Create branch from this…',
          'stashBranch',
          inProgress,
          'codicon-git-branch',
        ),
        plainItem('stashShow', 'Show changes', 'codicon-eye'),
        gatedItem(
          'globalStashRemove',
          'Remove from global stash',
          'globalStashRemove',
          inProgress,
          'codicon-trash',
          true,
        ),
      ],
    },
  ];
}

/** Distinct remote names implied by an already-loaded `remoteBranches` list (`origin/main` →
 *  `origin`) — see `buildRefMenu`'s own doc comment on why this stands in for a `remotes.list`
 *  endpoint P6 does not have. */
export function remoteNamesFrom(remoteBranchNames: readonly string[]): string[] {
  const names = new Set<string>();
  for (const name of remoteBranchNames) {
    const slash = name.indexOf('/');
    if (slash > 0) names.add(name.slice(0, slash));
  }
  return [...names].sort();
}
