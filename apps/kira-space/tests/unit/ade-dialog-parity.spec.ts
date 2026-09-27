import { describe, expect, test } from 'bun:test';
import type { AgentActivity } from '@shared/domain/agent';
import {
  archiveSpec,
  composeDialog,
  type DialogCtx,
  type DialogSpec,
  type DialogState,
  moveSpec,
  rebaseAllSpec,
  rebaseSpec,
  resumeSpec,
  specForQueueAction,
  startSpec,
} from '../../frontend/src/ade/dialogCompose';
import {
  loadNeutralizedComponent,
  type MockupComponent,
  runMockupDialog,
} from './support/mockupOracle';
import {
  isoFromOffset,
  type MockupToWireResult,
  mockupToWire,
  toDialogContext,
} from './support/mockupToWire';

// P129 Part 4 §3.1 — the mockup itself (`support/mockupOracle.ts`'s `runMockupDialog`), run
// unmodified via `node:vm`, is the oracle for `dialogCompose.ts`'s own openers/`composeDialog`.
// Every scenario is enumerated from the mockup's own view (never a hard-coded id) so a mockup
// fixture change can't silently hollow a family out — each family asserts its own non-empty count.
//
// A scenario compares two independent halves built from the SAME (repo, statePatch) configuration,
// applied to two separately-constructed `Component` instances (one via `mockupToWire`/
// `toDialogContext` for the real port, one via `runMockupDialog` for the oracle) — deterministic
// fixture data (`repoData()` has no randomness) makes both instances structurally identical, so
// matching by the mockup's own row/block "name" key (Part 3's own identity-not-position rule) works
// across the two instances exactly as it does within one.

type Repo = 'web-app' | 'api' | 'mobile';
const REPOS: Repo[] = ['web-app', 'api', 'mobile'];

const DEFAULT_STATE: DialogState = { msg: null, push: false, override: false, branchName: '' };

function stubEvent(): { preventDefault: () => void; stopPropagation: () => void } {
  return { preventDefault: () => {}, stopPropagation: () => {} };
}

function buildScenario(
  repo: Repo,
  selectedId?: string,
): { wire: MockupToWireResult; ctx: DialogCtx } {
  const comp = loadNeutralizedComponent();
  comp.state.repo = repo;
  comp.state.lastRepo = repo;
  const wire = mockupToWire(comp, repo);
  const ctx = toDialogContext(wire, repo, selectedId);
  return { wire, ctx };
}

function keyOf(item: { branch: string; title: string }): string {
  return item.branch || item.title;
}

// A block's own `rows[0]` isn't necessarily its "mine" lead — a review ancestor can sort ahead of it
// in the same stack's rows (e.g. `li/search-schema` ahead of `feat/search-index`) — so this matches
// any row in the block, not just the first.
function findBlockByKey(view: MockupComponent, key: string): MockupComponent {
  const blocks = view.bands.flatMap((b: MockupComponent) => b.blocks);
  const found = blocks.find((b: MockupComponent) =>
    b.rows.some((r: MockupComponent) => r.name === key),
  );
  if (!found) throw new Error(`mockup: no block for row name ${JSON.stringify(key)}`);
  return found;
}

function findRowByKey(view: MockupComponent, key: string): MockupComponent {
  for (const block of view.bands.flatMap((b: MockupComponent) => b.blocks)) {
    const row = block.rows.find((r: MockupComponent) => r.name === key);
    if (row) return row;
  }
  throw new Error(`mockup: no row for name ${JSON.stringify(key)}`);
}

// ---- projections (only what §3.1 lists) ----------------------------------------------------------

// `targets` is deliberately excluded here (spec level): the mockup's own opener omits `D.targets`
// for a resume/non-draft-start dialog (line 1642/887) and only computes the `agentTargets` fallback
// lazily inside `renderVals()` (line 1739); `dialogCompose.ts`'s own openers compute that same
// fallback up front instead (its own doc comment, `resumeSpec`) — an intentional, disclosed shape
// difference at the spec level that the VIEW-level `dlg.targets` comparison below (identical either
// way, since both read the same running-session fallback) already covers in full.
function projectMockupSpec(d: MockupComponent) {
  return {
    kind: d.kind,
    roots: d.roots,
    onto: d.onto,
    ids: d.ids,
    draft: !!d.draft,
    base: d.base,
    resume: d.resume,
    askWt: !!d.askWt,
    wt: d.wt,
    noSame: !!d.noSame,
  };
}

function projectOurSpec(spec: DialogSpec) {
  return {
    kind: spec.kind,
    roots: spec.roots,
    onto: spec.onto,
    ids: spec.ids,
    draft: !!spec.draft,
    base: spec.base,
    resume: spec.resume,
    askWt: !!spec.askWt,
    wt: spec.wt,
    noSame: !!spec.noSame,
  };
}

/** `chipStyle(on)` (mockup line 1659) borders `#d97757` when on, `#3a3e48` otherwise — the only way
 *  to read "on" back off the mockup's own inline style string (§3.1's own note). */
function chipOn(style: string): boolean {
  return style.includes('#d97757');
}

function projectMockupView(dlg: MockupComponent) {
  return {
    title: dlg.title,
    message: dlg.message,
    edited: dlg.edited,
    blocked: dlg.blocked,
    busyShown: dlg.busyShown,
    overridden: dlg.overridden,
    busyTitle: dlg.busyTitle,
    overrideLabel: dlg.overrideLabel,
    busy: dlg.busy.map((b: MockupComponent) => ({ text: b.text })),
    sendLabel: dlg.sendLabel,
    isDraft: dlg.isDraft,
    canPush: dlg.canPush,
    pushOn: dlg.pushOn,
    isArchive: dlg.isArchive,
    riskText: dlg.riskText,
    targets: dlg.targets.map((t: MockupComponent) => ({
      title: t.title,
      branch: t.branch,
      options: t.options.map((o: MockupComponent) => ({ label: o.label, on: chipOn(o.style) })),
    })),
    askWt: dlg.askWt,
    wtOptions: dlg.wtOptions.map((w: MockupComponent) => ({ label: w.label, on: chipOn(w.style) })),
  };
}

function projectOurView(view: ReturnType<typeof composeDialog>) {
  return {
    title: view.title,
    message: view.message,
    edited: view.edited,
    blocked: view.blocked,
    busyShown: view.busyShown,
    overridden: view.overridden,
    busyTitle: view.busyTitle,
    overrideLabel: view.overrideLabel,
    busy: view.busy.map((b) => ({ text: b.text })),
    sendLabel: view.sendLabel,
    isDraft: view.isDraft,
    canPush: view.canPush,
    pushOn: view.pushOn,
    isArchive: view.isArchive,
    riskText: view.riskText,
    targets: view.targets.map((t) => ({
      title: t.title,
      branch: t.branch,
      options: t.options.map((o) => ({ label: o.label, on: o.on })),
    })),
    askWt: view.askWt,
    wtOptions: view.wtOptions.map((w) => ({ label: w.label, on: w.on })),
  };
}

/** One scenario's own full comparison: spec fields, then the rendered view over the default
 *  (unedited, push off, no override) state. */
function compareOne(
  ctx: DialogCtx,
  activity: ReadonlyMap<string, AgentActivity>,
  ourSpec: DialogSpec,
  mSpec: MockupComponent,
  mView: MockupComponent,
): void {
  expect(projectOurSpec(ourSpec)).toEqual(projectMockupSpec(mSpec));
  const ourView = composeDialog(ctx, ourSpec, DEFAULT_STATE, activity);
  expect(projectOurView(ourView)).toEqual(projectMockupView(mView));
}

// -------------------------------------------------------------------------------------------------
// Family 1: block-level Rebase / Queue after actions
// -------------------------------------------------------------------------------------------------

describe('ade-dialog-parity — family 1: block actions (§3.1.1)', () => {
  let total = 0;
  for (const repo of REPOS) {
    test(`${repo}: every block Rebase/Queue-after action`, () => {
      const { wire, ctx } = buildScenario(repo);
      const cases = ctx.view.segments
        .filter(
          (seg) => seg.action && (seg.action.kind === 'rebase' || seg.action.kind === 'queueAfter'),
        )
        .map((seg) => {
          const member = ctx.view.items.find(
            (it) => it.id === (seg.members[0] as { id: string }).id,
          );
          return { seg, key: keyOf(member as { branch: string; title: string }) };
        });
      for (const { seg, key } of cases) {
        const ourSpec = specForQueueAction(
          ctx,
          seg.action as { kind: 'queueAfter' | 'rebase'; targetIds: string[] },
        );
        const { spec, view } = runMockupDialog({
          repo,
          open: (_comp, v) => {
            findBlockByKey(v, key).actionRun();
          },
        });
        compareOne(ctx, wire.activity, ourSpec, spec, view);
        total++;
      }
    });
  }
  test('non-empty', () => {
    expect(total).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Family 2: selected-panel Rebase onto X / Queue after X
// -------------------------------------------------------------------------------------------------

describe('ade-dialog-parity — family 2: selected-panel rebase/queue actions (§3.1.2)', () => {
  let total = 0;
  for (const repo of REPOS) {
    test(`${repo}: every sel.actions[] Rebase onto/Queue after`, () => {
      const { wire, ctx } = buildScenario(repo);
      for (const item of ctx.view.items) {
        const probe = loadNeutralizedComponent();
        probe.state.repo = repo;
        probe.state.lastRepo = repo;
        probe.state.selected = { ...probe.state.selected, [repo]: item.id };
        const v0 = probe.renderVals();
        const matches: number[] = (v0.sel.actions as MockupComponent[])
          .map((a: MockupComponent, i: number) => ({ a, i }))
          .filter(({ a }: { a: MockupComponent }) => /^Rebase onto |^Queue after /.test(a.label))
          .map(({ i }: { i: number }) => i);
        for (const i of matches) {
          const { spec, view } = runMockupDialog({
            repo,
            statePatch: { selected: { [repo]: item.id } },
            open: (_comp, v) => {
              (v.sel.actions[i] as MockupComponent).run();
            },
          });
          const ourSpec = rebaseSpec(ctx, spec.roots, spec.onto, spec.title);
          compareOne(ctx, wire.activity, ourSpec, spec, view);
          total++;
        }
      }
    });
  }
  test('non-empty', () => {
    expect(total).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Family 3: Rebase all onto main
// -------------------------------------------------------------------------------------------------

describe('ade-dialog-parity — family 3: Rebase all onto main (§3.1.3)', () => {
  let total = 0;
  for (const repo of REPOS) {
    test(`${repo}: Rebase all onto main, when offered`, () => {
      const { wire, ctx } = buildScenario(repo);
      const probe = loadNeutralizedComponent();
      probe.state.repo = repo;
      probe.state.lastRepo = repo;
      const v0 = probe.renderVals();
      if (!v0.mainCanRebase) return;
      const ourSpec = rebaseAllSpec(ctx);
      const { spec, view } = runMockupDialog({
        repo,
        open: (_comp, v) => {
          v.rebaseAll();
        },
      });
      compareOne(ctx, wire.activity, ourSpec, spec, view);
      total++;
    });
  }
  test('non-empty', () => {
    expect(total).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Family 4: every ▶ Start (non-draft and draft)
// -------------------------------------------------------------------------------------------------

describe('ade-dialog-parity — family 4: Start (§3.1.4)', () => {
  let total = 0;
  for (const repo of REPOS) {
    test(`${repo}: every row's own canStart`, () => {
      const { wire, ctx } = buildScenario(repo);
      const probe = loadNeutralizedComponent();
      probe.state.repo = repo;
      probe.state.lastRepo = repo;
      const v0 = probe.renderVals();
      const startable = v0.bands
        .flatMap((b: MockupComponent) => b.blocks)
        .flatMap((b: MockupComponent) => b.rows)
        .filter((r: MockupComponent) => r.canStart);
      for (const row of startable) {
        const item = ctx.view.items.find((it) => keyOf(it) === row.name);
        expect(item, `no port item for ${row.name}`).toBeDefined();
        const ourSpec = startSpec(ctx, (item as { id: string }).id);
        const { spec, view } = runMockupDialog({
          repo,
          open: (_comp, v) => {
            findRowByKey(v, row.name).start();
          },
        });
        compareOne(ctx, wire.activity, ourSpec, spec, view);
        total++;
      }
    });
  }
  test('non-empty', () => {
    expect(total).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Family 5: every stopped-list resume
// -------------------------------------------------------------------------------------------------

describe('ade-dialog-parity — family 5: stopped-list resume (§3.1.5)', () => {
  let total = 0;
  for (const repo of REPOS) {
    test(`${repo}: every sel.stopped[].resume`, () => {
      const { wire, ctx } = buildScenario(repo);
      for (const item of ctx.view.items) {
        const probe = loadNeutralizedComponent();
        probe.state.repo = repo;
        probe.state.lastRepo = repo;
        probe.state.selected = { ...probe.state.selected, [repo]: item.id };
        const v0 = probe.renderVals();
        const stoppedIds: string[] = (v0.sel.stopped as MockupComponent[]).map(
          (x: MockupComponent) => x.sid,
        );
        for (let i = 0; i < stoppedIds.length; i++) {
          const { spec, view } = runMockupDialog({
            repo,
            statePatch: { selected: { [repo]: item.id } },
            open: (_comp, v) => {
              (v.sel.stopped[i] as MockupComponent).resume();
            },
          });
          const ourSpec = resumeSpec(ctx, item.id, spec.resume as string);
          compareOne(ctx, wire.activity, ourSpec, spec, view);
          total++;
        }
      }
    });
  }
  test('non-empty', () => {
    expect(total).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Family 6: All agents' non-running row run
// -------------------------------------------------------------------------------------------------

describe('ade-dialog-parity — family 6: All agents resume (§3.1.6)', () => {
  let total = 0;
  for (const repo of REPOS) {
    test(`${repo}: every stopped All-agents row`, () => {
      const { wire, ctx } = buildScenario(repo);
      const probe = loadNeutralizedComponent();
      probe.state.repo = repo;
      probe.state.lastRepo = repo;
      probe.state.allFilter = 'stopped';
      const v0 = probe.renderVals();
      const rows: MockupComponent[] = (v0.allView.groups as MockupComponent[])
        .filter((g: MockupComponent) => g.repo === repo)
        .flatMap((g: MockupComponent) => g.rows);
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as MockupComponent;
        const { spec, view } = runMockupDialog({
          repo,
          statePatch: { allFilter: 'stopped' },
          open: (_comp, v) => {
            const r = (v.allView.groups as MockupComponent[])
              .filter((g: MockupComponent) => g.repo === repo)
              .flatMap((g: MockupComponent) => g.rows)[i];
            r.run();
          },
        });
        const item = ctx.view.items.find((it) => keyOf(it) === (row.branch || row.title));
        expect(item, `no port item for row ${row.branch || row.title}`).toBeDefined();
        const ourSpec = resumeSpec(ctx, (item as { id: string }).id, spec.resume as string, {
          askWt: !!spec.askWt,
          wt: spec.wt,
          noSame: !!spec.noSame,
          title: spec.title,
        });
        compareOne(ctx, wire.activity, ourSpec, spec, view);
        total++;
      }
    });
  }
  test('non-empty', () => {
    expect(total).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Family 7: every Archive whose atRisk is non-null
// -------------------------------------------------------------------------------------------------

function riskFor(
  ctx: DialogCtx,
  id: string,
): { dirty: string[]; unmerged: number; worktree: string } {
  const b = ctx.snapshot.branches.find((x) => x.id === id);
  if (!b) throw new Error(`riskFor: no branch ${id}`);
  return {
    dirty: b.dirty.map((d) => d.path),
    unmerged: b.merged ? 0 : b.ahead,
    worktree: b.worktree,
  };
}

describe('ade-dialog-parity — family 7: archive at risk (§3.1.7)', () => {
  let total = 0;
  for (const repo of REPOS) {
    test(`${repo}: every row whose archive opens a dialog`, () => {
      const { wire, ctx } = buildScenario(repo);
      const probe = loadNeutralizedComponent();
      probe.state.repo = repo;
      probe.state.lastRepo = repo;
      const v0 = probe.renderVals();
      const rows = v0.bands
        .flatMap((b: MockupComponent) => b.blocks)
        .flatMap((b: MockupComponent) => b.rows);
      for (const row of rows) {
        const { spec, view } = runMockupDialog({
          repo,
          open: (_comp, v) => {
            findRowByKey(v, row.name).archive();
          },
        });
        if (!spec) continue; // atRisk was null — archived directly, no dialog (mockup requestArchive)
        const item = ctx.view.items.find((it) => keyOf(it) === row.name);
        expect(item, `no port item for ${row.name}`).toBeDefined();
        const id = (item as { id: string }).id;
        const ourSpec = archiveSpec(ctx, id, riskFor(ctx, id));
        compareOne(ctx, wire.activity, ourSpec, spec, view);
        total++;
      }
    });
  }
  test('non-empty', () => {
    expect(total).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// Family 8: move (drag/drop)
// -------------------------------------------------------------------------------------------------

describe('ade-dialog-parity — family 8: move (§3.1.8)', () => {
  let total = 0;
  for (const repo of REPOS) {
    test(`${repo}: every mine lead dropped on every other lead's block and on every day band`, () => {
      const { wire, ctx } = buildScenario(repo);
      const leads = ctx.view.segments
        .filter((seg) => seg.lead && !seg.parked)
        .map((seg) => ({ leadId: seg.lead as string, day: seg.day }));

      for (const { leadId } of leads) {
        // ---- drop on every OTHER lead's block --------------------------------------------------
        for (const target of leads) {
          if (target.leadId === leadId) continue;
          const targetItem = ctx.view.items.find((it) => it.id === target.leadId);
          const targetKey = keyOf(targetItem as { branch: string; title: string });

          const probe = loadNeutralizedComponent();
          probe.state.repo = repo;
          probe.state.lastRepo = repo;
          probe.dragIds = [leadId];
          const v0 = probe.renderVals();
          const before = probe.state.dialog;
          findBlockByKey(v0, targetKey).dropOn(stubEvent());
          if (probe.state.dialog === before) continue; // guarded: no dialog opened, skip (§3.1.8)

          const { spec, view } = runMockupDialog({
            repo,
            open: (comp, v) => {
              comp.dragIds = [leadId];
              findBlockByKey(v, targetKey).dropOn(stubEvent());
            },
          });
          const ourSpec = moveSpec(
            ctx,
            spec.ids as string[],
            spec.before as string | null,
            spec.day === null ? null : isoFromOffset(spec.day as number),
          );
          compareOne(ctx, wire.activity, ourSpec, spec, view);
          total++;
        }

        // ---- drop on every day band -------------------------------------------------------------
        const probeBands = loadNeutralizedComponent();
        probeBands.state.repo = repo;
        probeBands.state.lastRepo = repo;
        const vBands = probeBands.renderVals();
        for (const band of vBands.bands as MockupComponent[]) {
          probeBands.dragIds = [leadId];
          const before = probeBands.state.dialog;
          band.drop(stubEvent());
          const opened = probeBands.state.dialog !== before;
          probeBands.state.dialog = before; // reset for the next band's own probe
          if (!opened) continue;

          const { spec, view } = runMockupDialog({
            repo,
            open: (comp, v) => {
              comp.dragIds = [leadId];
              const b = (v.bands as MockupComponent[]).find(
                (x: MockupComponent) => x.domId === band.domId,
              );
              (b as MockupComponent).drop(stubEvent());
            },
          });
          const ourSpec = moveSpec(
            ctx,
            spec.ids as string[],
            spec.before as string | null,
            spec.day === null ? null : isoFromOffset(spec.day as number),
          );
          compareOne(ctx, wire.activity, ourSpec, spec, view);
          total++;
        }
      }
    });
  }
  test('non-empty', () => {
    expect(total).toBeGreaterThan(0);
  });
});

// -------------------------------------------------------------------------------------------------
// State variants (§3.1's own paragraph): push on, edited+reset, override, target choice switch —
// exercised over one Rebase-all scenario with two injected running sessions on its first root
// (the fixture has no naturally multi-running-session item).
// -------------------------------------------------------------------------------------------------

describe('ade-dialog-parity — state variants (§3.1)', () => {
  test('push on / edited+reset / override / target choice switch (Rebase all onto main)', () => {
    const repo: Repo = 'web-app';
    const probeComp = loadNeutralizedComponent();
    probeComp.state.repo = repo;
    probeComp.state.lastRepo = repo;
    const wire = mockupToWire(probeComp, repo);
    const probeCtx = toDialogContext(wire, repo);
    const root = probeCtx.view.behindRoots[0] as string;
    expect(root).toBeDefined();
    // `AdeSession.branch` is the git branch NAME (`useQueue.ts`'s own `s.branch === b.branch` join,
    // §0.9's own fix) — never the item id.
    const rootBranchName = wire.snapshot.branches.find((b) => b.id === root)?.branch as string;
    expect(rootBranchName).toBeDefined();

    const terminalWorking = `${root}:aaaa`;
    const terminalIdle = `${root}:bbbb`;
    wire.sessions.push(
      {
        id: terminalWorking,
        claudeSessionId: 'aaaa',
        codeRepoId: repo,
        branch: rootBranchName,
        newWorkId: '',
        cwd: '',
        state: 'running',
        terminalId: terminalWorking,
        startedAt: 0,
        lastActiveAt: 0,
      },
      {
        id: terminalIdle,
        claudeSessionId: 'bbbb',
        codeRepoId: repo,
        branch: rootBranchName,
        newWorkId: '',
        cwd: '',
        state: 'running',
        terminalId: terminalIdle,
        startedAt: 0,
        lastActiveAt: 0,
      },
    );
    wire.activity.set(terminalWorking, {
      phase: 'working',
      runningTools: [],
      toolName: null,
      message: null,
      sessionId: null,
      wakeArmed: false,
      at: 0,
    });
    wire.activity.set(terminalIdle, {
      phase: 'idle',
      runningTools: [],
      toolName: null,
      message: null,
      sessionId: null,
      wakeArmed: false,
      at: 0,
    });
    const ctx = toDialogContext(wire, repo);
    const ourSpec = rebaseAllSpec(ctx);

    const newSessionsPatch = {
      newSessions: {
        [root]: [
          { id: 'aaaa', state: 'running', last: 'now', act: 'working' },
          { id: 'bbbb', state: 'running', last: 'now', act: 'idle' },
        ],
      },
    };
    const { comp, spec, view } = runMockupDialog({
      repo,
      statePatch: newSessionsPatch,
      open: (_comp, v) => {
        v.rebaseAll();
      },
    });
    compareOne(ctx, wire.activity, ourSpec, spec, view);

    const ourDefault = composeDialog(ctx, ourSpec, DEFAULT_STATE, wire.activity);
    expect(ourDefault.busyShown).toBe(true); // sanity: the injection actually produced a busy row

    // ---- push on --------------------------------------------------------------------------------
    comp.setState({ dialogPush: true });
    const pushOn = composeDialog(ctx, ourSpec, { ...DEFAULT_STATE, push: true }, wire.activity);
    expect(projectOurView(pushOn)).toEqual(projectMockupView(comp.renderVals().dialog));

    // ---- edited, then reset -----------------------------------------------------------------------
    const editedText = 'A hand-typed replacement message.';
    comp.setState({ dialogPush: false, dialogMsg: editedText });
    const edited = composeDialog(
      ctx,
      ourSpec,
      { ...DEFAULT_STATE, msg: editedText },
      wire.activity,
    );
    expect(projectOurView(edited)).toEqual(projectMockupView(comp.renderVals().dialog));
    expect(edited.message).toBe(editedText);

    comp.setState({ dialogMsg: null });
    const reset = composeDialog(ctx, ourSpec, DEFAULT_STATE, wire.activity);
    expect(projectOurView(reset)).toEqual(projectMockupView(comp.renderVals().dialog));

    // ---- override -----------------------------------------------------------------------------
    comp.setState({ dialogOverride: true });
    const overridden = composeDialog(
      ctx,
      ourSpec,
      { ...DEFAULT_STATE, override: true },
      wire.activity,
    );
    expect(projectOurView(overridden)).toEqual(projectMockupView(comp.renderVals().dialog));
    expect(overridden.overridden).toBe(true);
    expect(overridden.sendLabel).toBe('Send anyway');
    comp.setState({ dialogOverride: false });

    // ---- target choice switch (root's own target has two running sessions) -------------------
    const target0 = ourSpec.targets[0] as { item: string; choice: string };
    expect(target0.item).toBe(root);
    const secondChoice = terminalIdle === target0.choice ? terminalWorking : terminalIdle;
    const switched: DialogSpec = {
      ...ourSpec,
      targets: [{ item: target0.item, choice: secondChoice }],
    };
    const mSwitched = {
      ...spec,
      targets: [{ branch: target0.item, choice: 'bbbb' === target0.choice ? 'aaaa' : 'bbbb' }],
    };
    comp.setState({ dialog: mSwitched });
    const switchedView = composeDialog(ctx, switched, DEFAULT_STATE, wire.activity);
    expect(projectOurView(switchedView)).toEqual(projectMockupView(comp.renderVals().dialog));
  });

  test('start new work: dialogBranch (§3.1, over 4)', () => {
    const repo: Repo = 'web-app';
    const { wire, ctx } = buildScenario(repo);
    const draft = ctx.view.items.find((it) => it.draft);
    expect(draft).toBeDefined();
    const id = (draft as { id: string }).id;
    const ourSpec = startSpec(ctx, id);
    expect(ourSpec.draft).toBe(true);

    const { comp, spec, view } = runMockupDialog({
      repo,
      open: (_comp, v) => {
        findRowByKey(v, keyOf(draft as { branch: string; title: string })).start();
      },
    });
    compareOne(ctx, wire.activity, ourSpec, spec, view);

    const branchName = 'feat/x-y';
    comp.setState({ dialogBranch: branchName });
    const withName = composeDialog(ctx, ourSpec, { ...DEFAULT_STATE, branchName }, wire.activity);
    expect(projectOurView(withName)).toEqual(projectMockupView(comp.renderVals().dialog));
    expect(withName.message).toContain(branchName);
  });
});
