import { describe, expect, test } from 'bun:test';
import {
  canRunOp,
  classifyInProgress,
  describeInProgress,
  type InProgressOperation,
  type InProgressStateFiles,
} from './operation.ts';

function stateFiles(partial: Partial<InProgressStateFiles>): InProgressStateFiles {
  return {
    mergeHead: undefined,
    cherryPickHead: undefined,
    revertHead: undefined,
    bisectLog: false,
    rebaseMergeDir: false,
    rebaseApplyDir: false,
    rebaseApplyApplying: false,
    rebaseHeadName: undefined,
    rebaseOnto: undefined,
    sequencerDir: false,
    sequencerTodoKind: undefined,
    ...partial,
  };
}

describe('classifyInProgress — precedence table (§7.11)', () => {
  test('no state files, no unmerged paths ⇒ null (nothing in progress)', () => {
    expect(classifyInProgress({ stateFiles: stateFiles({}), unmergedPaths: [] })).toBeNull();
  });

  // G26 D12 inverts this test (renamed from its G5 original, which asserted "cannot continue" —
  // that "§9 report-only posture" held only while nothing in the app could START a rebase;
  // stack.restack now does).
  test('rebase-merge dir present ⇒ rebase, can continue, can abort, can skip (G26 D12)', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({
        rebaseMergeDir: true,
        rebaseHeadName: 'refs/heads/side',
        rebaseOnto: 'deadbeef',
      }),
      unmergedPaths: ['a.txt'],
    });
    expect(op).toEqual({
      kind: 'rebase',
      otherSha: 'deadbeef',
      headName: 'refs/heads/side',
      conflictedPaths: ['a.txt'],
      canContinue: true,
      canAbort: true,
      isSequence: false,
      unmergedCount: 1,
      canSkip: true,
    });
  });

  test('rebase-apply dir present ⇒ rebase (am-based rebase), can continue (G26 D12)', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({ rebaseApplyDir: true }),
      unmergedPaths: [],
    });
    expect(op?.kind).toBe('rebase');
    expect(op?.canContinue).toBe(true);
  });

  // F3: a `git am` in progress shares rebase-apply/ with an apply-backend rebase, distinguished
  // only by the "applying" marker file -- without this, every Can* flag was wrongly true and
  // every offered action (`rebase --continue`/`--abort`/`--skip`) fails outright.
  test('rebase-apply dir with "applying" marker ⇒ am, report-only (F3)', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({
        rebaseApplyDir: true,
        rebaseApplyApplying: true,
        rebaseHeadName: 'refs/heads/side',
        rebaseOnto: 'deadbeef',
      }),
      unmergedPaths: ['a.txt'],
    });
    expect(op).toEqual({
      kind: 'rebase',
      otherSha: 'deadbeef',
      headName: 'refs/heads/side',
      conflictedPaths: ['a.txt'],
      canContinue: false,
      canAbort: false,
      isSequence: false,
      unmergedCount: 1,
      canSkip: false,
    });
  });

  test('MERGE_HEAD present ⇒ merge, can continue and abort', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({ mergeHead: 'cafebabe' }),
      unmergedPaths: ['b.txt'],
    });
    expect(op).toEqual({
      kind: 'merge',
      otherSha: 'cafebabe',
      headName: undefined,
      conflictedPaths: ['b.txt'],
      canContinue: true,
      canAbort: true,
      isSequence: false,
      unmergedCount: 1,
      canSkip: false,
    });
  });

  test('CHERRY_PICK_HEAD present ⇒ cherryPick', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({ cherryPickHead: 'c0ffee' }),
      unmergedPaths: [],
    });
    expect(op).toEqual({
      kind: 'cherryPick',
      otherSha: 'c0ffee',
      headName: undefined,
      conflictedPaths: [],
      canContinue: true,
      canAbort: true,
      isSequence: false,
      unmergedCount: 0,
      canSkip: true,
    });
  });

  test('REVERT_HEAD present ⇒ revert', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({ revertHead: 'f00dcafe' }),
      unmergedPaths: [],
    });
    expect(op).toEqual({
      kind: 'revert',
      otherSha: 'f00dcafe',
      headName: undefined,
      conflictedPaths: [],
      canContinue: true,
      canAbort: true,
      isSequence: false,
      unmergedCount: 0,
      canSkip: true,
    });
  });

  test('BISECT_LOG present ⇒ bisect, cannot continue, can abort', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({ bisectLog: true }),
      unmergedPaths: [],
    });
    expect(op).toEqual({
      kind: 'bisect',
      otherSha: undefined,
      headName: undefined,
      conflictedPaths: [],
      canContinue: false,
      canAbort: true,
      isSequence: false,
      unmergedCount: 0,
      canSkip: false,
    });
  });

  // F2: a paused multi-commit revert/cherry-pick whose current commit was finished with a plain
  // `git commit` (instead of `--continue`) clears *_HEAD but leaves sequencer/ (and its todo)
  // behind -- git's own state machine is still mid-run, so this must not fall through to
  // unmergedOnly (or null, with no unmerged paths left either).
  test('sequencer dir with no *_HEAD file, todo says revert ⇒ revert, not unmergedOnly (F2)', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({ sequencerDir: true, sequencerTodoKind: 'revert' }),
      unmergedPaths: [],
    });
    expect(op).toEqual({
      kind: 'revert',
      otherSha: undefined,
      headName: undefined,
      conflictedPaths: [],
      canContinue: true,
      canAbort: true,
      isSequence: true,
      unmergedCount: 0,
      canSkip: true,
    });
  });

  test('sequencer dir with no *_HEAD file, todo says pick ⇒ cherryPick (F2)', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({ sequencerDir: true, sequencerTodoKind: 'cherryPick' }),
      unmergedPaths: [],
    });
    expect(op?.kind).toBe('cherryPick');
    expect(op?.isSequence).toBe(true);
  });

  test('sequencer dir alone, todo unreadable/unrecognised ⇒ falls through to null (unchanged)', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({ sequencerDir: true, sequencerTodoKind: undefined }),
      unmergedPaths: [],
    });
    expect(op).toBeNull();
  });

  test('unmerged paths with none of the six state files ⇒ unmergedOnly, cannot continue or abort', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({}),
      unmergedPaths: ['c.txt', 'd.txt'],
    });
    expect(op).toEqual({
      kind: 'unmergedOnly',
      otherSha: undefined,
      headName: undefined,
      conflictedPaths: ['c.txt', 'd.txt'],
      canContinue: false,
      canAbort: false,
      isSequence: false,
      unmergedCount: 2,
      canSkip: false,
    });
  });

  test('shadowing: rebase state files present alongside cherry-pick-shaped sequencer state ⇒ still rebase', () => {
    // A rebase --onto stopped on a conflict leaves rebase-merge/ present; if the sequencer dir
    // and even a stray CHERRY_PICK_HEAD-like signal were also present, rebase must still win —
    // it is checked first in the precedence table, unconditionally.
    const op = classifyInProgress({
      stateFiles: stateFiles({
        rebaseMergeDir: true,
        rebaseHeadName: 'refs/heads/topic',
        rebaseOnto: 'abc123',
        sequencerDir: true,
        cherryPickHead: 'shouldnotwin',
      }),
      unmergedPaths: [],
    });
    expect(op?.kind).toBe('rebase');
    expect(op?.isSequence).toBe(true);
  });

  test('shadowing: merge/cherryPick/revert all present at once ⇒ merge wins (table order)', () => {
    const op = classifyInProgress({
      stateFiles: stateFiles({
        mergeHead: 'merge-sha',
        cherryPickHead: 'cherry-sha',
        revertHead: 'revert-sha',
      }),
      unmergedPaths: [],
    });
    expect(op?.kind).toBe('merge');
  });

  test('fallthrough: unmergedOnly only applies when none of the five state-file kinds matched', () => {
    // Bare unmerged paths with a bisect log present must classify as bisect, not unmergedOnly —
    // bisect is checked before the fallback.
    const op = classifyInProgress({
      stateFiles: stateFiles({ bisectLog: true }),
      unmergedPaths: ['e.txt'],
    });
    expect(op?.kind).toBe('bisect');
    expect(op?.unmergedCount).toBe(1);
  });
});

describe('canRunOp — the gate (§7.11)', () => {
  test('nothing in progress: every op kind is allowed', () => {
    expect(canRunOp(null, 'checkout')).toBe(true);
    expect(canRunOp(null, 'revert')).toBe(true);
    expect(canRunOp(null, 'branchCreate')).toBe(true);
    expect(canRunOp(null, 'tagDelete')).toBe(true);
  });

  const inProgress: InProgressOperation = {
    kind: 'merge',
    otherSha: 'sha',
    headName: undefined,
    conflictedPaths: ['a'],
    canContinue: true,
    canAbort: true,
    isSequence: false,
    unmergedCount: 1,
    canSkip: false,
  };

  test('in progress: checkout is gated', () => {
    expect(canRunOp(inProgress, 'checkout')).toBe(false);
  });

  test('in progress: revert is gated', () => {
    expect(canRunOp(inProgress, 'revert')).toBe(false);
  });

  test('in progress: branch/tag creation and deletion are NOT gated (git allows them)', () => {
    expect(canRunOp(inProgress, 'branchCreate')).toBe(true);
    expect(canRunOp(inProgress, 'branchDelete')).toBe(true);
    expect(canRunOp(inProgress, 'branchRename')).toBe(true);
    expect(canRunOp(inProgress, 'tagCreate')).toBe(true);
    expect(canRunOp(inProgress, 'tagDelete')).toBe(true);
    expect(canRunOp(inProgress, 'tagPush')).toBe(true);
    expect(canRunOp(inProgress, 'tagDeleteRemote')).toBe(true);
  });

  test('in progress: opContinue/opAbort are not gated', () => {
    expect(canRunOp(inProgress, 'opContinue')).toBe(true);
    expect(canRunOp(inProgress, 'opAbort')).toBe(true);
  });

  // P10 probe 3: git does not refuse `reset --mixed`/`--hard` mid-merge on its own — it silently
  // abandons the sequencer state — so `reset` must be gated here even though no earlier phase's
  // op needed host-side enforcement to match git's own refusal.
  test('in progress: reset and cherryPick are gated (probe 3)', () => {
    expect(canRunOp(inProgress, 'reset')).toBe(false);
    expect(canRunOp(inProgress, 'cherryPick')).toBe(false);
  });

  // `opSkip` is only ever offered *from within* the gated state itself (`canSkip`), never a way
  // to bypass it — so it is deliberately NOT in GATED_OP_KINDS.
  test('in progress: opSkip is not gated', () => {
    expect(canRunOp(inProgress, 'opSkip')).toBe(true);
  });
});

describe('classifyInProgress — canSkip (P10 probe 6, G26 D12)', () => {
  test('cherryPick, revert and rebase can skip; every other kind cannot', () => {
    expect(
      classifyInProgress({
        stateFiles: stateFiles({ cherryPickHead: 'c0ffee' }),
        unmergedPaths: [],
      })?.canSkip,
    ).toBe(true);
    expect(
      classifyInProgress({ stateFiles: stateFiles({ revertHead: 'f00d' }), unmergedPaths: [] })
        ?.canSkip,
    ).toBe(true);
    expect(
      classifyInProgress({ stateFiles: stateFiles({ mergeHead: 'm' }), unmergedPaths: [] })
        ?.canSkip,
    ).toBe(false);
    // G26 D12 inverts this line: rebase now offers Skip too (git's own conflict hint names
    // `git rebase --skip` verbatim).
    expect(
      classifyInProgress({
        stateFiles: stateFiles({ rebaseMergeDir: true }),
        unmergedPaths: [],
      })?.canSkip,
    ).toBe(true);
    expect(
      classifyInProgress({ stateFiles: stateFiles({ bisectLog: true }), unmergedPaths: [] })
        ?.canSkip,
    ).toBe(false);
    expect(classifyInProgress({ stateFiles: stateFiles({}), unmergedPaths: ['x'] })?.canSkip).toBe(
      false,
    );
  });
});

describe('describeInProgress', () => {
  function op(
    partial: Partial<InProgressOperation> & Pick<InProgressOperation, 'kind'>,
  ): InProgressOperation {
    return {
      otherSha: undefined,
      headName: undefined,
      conflictedPaths: [],
      canContinue: false,
      canAbort: true,
      isSequence: false,
      unmergedCount: 0,
      canSkip: false,
      ...partial,
    };
  }

  test('merge: label plus truncated sha', () => {
    expect(describeInProgress(op({ kind: 'merge', otherSha: '0123456789abcdef' }))).toBe(
      'Merging `0123456`',
    );
  });

  test('cherryPick: label plus truncated sha', () => {
    expect(describeInProgress(op({ kind: 'cherryPick', otherSha: 'fedcba9876543210' }))).toBe(
      'Cherry-picking `fedcba9`',
    );
  });

  test('revert: label plus truncated sha', () => {
    expect(describeInProgress(op({ kind: 'revert', otherSha: 'aaaaaaaaaaaa' }))).toBe(
      'Reverting `aaaaaaa`',
    );
  });

  test('bisect: label, no sha to show', () => {
    expect(describeInProgress(op({ kind: 'bisect' }))).toBe('Bisecting');
  });

  test('rebase: strips the refs/heads/ prefix from headName', () => {
    expect(
      describeInProgress(op({ kind: 'rebase', headName: 'refs/heads/feature', otherSha: 'sha' })),
    ).toBe('Rebasing feature');
  });

  test("rebase: falls back to bare 'Rebasing' when headName is undefined", () => {
    expect(describeInProgress(op({ kind: 'rebase', headName: undefined }))).toBe('Rebasing');
  });

  test('unmergedOnly: fixed sentence, ignores any otherSha', () => {
    expect(describeInProgress(op({ kind: 'unmergedOnly' }))).toBe('Unresolved conflict');
  });

  test('a kind with no otherSha omits the trailing sha entirely (no dangling backticks)', () => {
    expect(describeInProgress(op({ kind: 'merge', otherSha: undefined }))).toBe('Merging');
  });
});
