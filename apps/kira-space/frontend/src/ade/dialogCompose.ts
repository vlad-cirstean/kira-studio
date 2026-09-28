import type { AgentActivity } from '@shared/domain/agent';
import { ACTIVITY_LABEL, type ActivityKind, activityKind, sessionLabel } from './activity';
import { dayLong, type QueueView } from './useQueue';
import type { AdeBranch, AdeRepoSnapshot, AdeSession } from './wire';

// P129 Part 4 §0.1/§2.1: a pure port of `docs/v2.0/design/mockup.html`'s own dialog logic —
// `openDialog`'s openers (lines 1063-1092, 1131-1140, 1153-1162, 1370-1397, 1620-1642, 887) and the
// `dlg` view-model (`renderVals()` lines 1655-1753) — no Vue import, no clock read. The component
// wraps `composeDialog` in `computed()`. Every mockup literal maps to a real fact per §0.3's own
// table (`remote`, `main.name`/`main.ref`, `AdeBranch.worktree`/`branch`, `claudeSessionId`,
// `dayLong`) — with those values, output is byte-identical, cross-checked by
// `tests/unit/ade-dialog-parity.spec.ts` running the mockup itself as an oracle.

export interface DialogTarget {
  /** The queue item id (a branch's own id, or a new-work draft's id) this target delivers to. */
  item: string;
  /** An `ade_sessions` record id, or `'new'` for a fresh launch (mockup `agentTargets`). */
  choice: string;
}

type DialogKind = 'rebase' | 'queue' | 'move' | 'start' | 'archive';

/** The mockup's own `state.dialog` (`D`) shape — one flat object reused across kinds, several
 *  fields meaning different things per kind (`ids` is the rebase/queue busy-check stack, or the
 *  move's own branches-to-move, exactly as the mockup reuses its own `D.ids`). */
export interface DialogSpec {
  kind: DialogKind;
  title: string;
  roots?: string[];
  onto?: string;
  ids?: string[];
  targets: DialogTarget[];
  before?: string | null;
  /** ISO `YYYY-MM-DD`, or `null` for Later (§0.6) — never a raw day offset. */
  day?: string | null;
  /** §0.14: the Move dialog's own plan write, awaited before delivery (`sendMove`) — `SetPlan` is
   *  absolute (idempotent), so a delivery-retry after a successful `applyPlan` never re-applies a
   *  stale plan. */
  applyPlan?: () => Promise<void>;
  draft?: boolean;
  /** The draft's base branch name (already resolved to a git name, or `'main'`). */
  base?: string;
  /** The target item id for `start`/`archive`/`resume` (mockup `D.branch`). */
  branch?: string;
  /** An existing session's own id, for a resume dialog. */
  resume?: string;
  askWt?: boolean;
  noSame?: boolean;
  wt?: 'same' | 'new';
  risk?: { dirty: string[]; unmerged: number; worktree: string };
}

interface DialogChip {
  value: string;
  label: string;
  on: boolean;
}

interface DialogTargetView {
  title: string;
  branch: string;
  options: DialogChip[];
}

export interface DialogView {
  title: string;
  blocked: boolean;
  busyShown: boolean;
  overridden: boolean;
  overrideLabel: string;
  busyTitle: string;
  busy: { text: string; kind: ActivityKind }[];
  message: string;
  edited: boolean;
  /** §0.14 step 12: a blank (trimmed) message disables Send — real-delivery guard the mockup
   *  itself has no reason to enforce (its own `sendDialog` never inspects the message). */
  sendDisabled: boolean;
  isDraft: boolean;
  canPush: boolean;
  pushOn: boolean;
  sendLabel: string;
  isArchive: boolean;
  riskText: string;
  targets: DialogTargetView[];
  askWt: boolean;
  wtOptions: DialogChip[];
}

export interface DialogState {
  msg: string | null;
  push: boolean;
  override: boolean;
  branchName: string;
}

/** Everything a composer/opener needs, built once per repo render (`AdeRepoView`'s own
 *  `useDialogContext`). `repoRoot` is `codeRepoRecord(id).root` — the git module's own default
 *  worktree base when `snapshot.worktreeBasePath` is empty (§0.3). */
export interface DialogCtx {
  view: QueueView;
  snapshot: AdeRepoSnapshot;
  /** This repo's own sessions (raw wire shape — running-session lookups need `id`/`state`/
   *  `claudeSessionId`, which `QueueItem` doesn't carry). */
  sessions: readonly AdeSession[];
  today: string;
  repoRoot: string;
}

// -------------------------------------------------------------------------------------------------
// Shared lookups
// -------------------------------------------------------------------------------------------------

interface ViewItemLike {
  id: string;
  kind: 'mine' | 'review' | 'parked' | 'dependency';
  draft: boolean;
  title: string;
  /** `''` for a draft with no branch yet (mockup's own `name: started || ''`, line 800) — the
   *  branch-name source of truth for every id, real branch or draft alike. */
  branch: string;
}

function itemsById(ctx: DialogCtx): Map<string, ViewItemLike> {
  return new Map(ctx.view.items.map((i) => [i.id, i as ViewItemLike]));
}

function branchOf(ctx: DialogCtx, id: string): AdeBranch | undefined {
  return ctx.snapshot.branches.find((b) => b.id === id);
}

/** A draft's own `''` (mockup: unstarted `name`) beats falling back to the raw id — `moveLines`'s
 *  `before` sibling can itself be a not-yet-started draft (§3.1 discovery). P129 Part 7 §0.11: an
 *  archived item is gone from `view.items` entirely, so the matching `snapshot.history` entry is
 *  the next fallback, before the raw id — an archived branch's dialog target block then still names
 *  the real branch, not its own opaque item id. */
function branchNameOf(ctx: DialogCtx, id: string): string {
  const item = itemsById(ctx).get(id);
  if (item) return item.branch;
  const hist = ctx.snapshot.history.find((h) => h.item === id);
  return hist ? hist.branch : id;
}

function titleOfItem(ctx: DialogCtx, id: string): string {
  const item = itemsById(ctx).get(id);
  if (item) return item.title;
  const hist = ctx.snapshot.history.find((h) => h.item === id);
  return hist ? hist.title : id;
}

function lastSegment(name: string): string {
  const parts = name.split('/');
  return (parts.length ? parts[parts.length - 1] : name) as string;
}

/** `snapshot.worktreeBasePath` trimmed of trailing `/`, else the repo root (§0.3). */
function worktreeDir(ctx: DialogCtx): string {
  const raw = ctx.snapshot.worktreeBasePath || ctx.repoRoot;
  return raw.replace(/\/+$/, '');
}

/** Mockup `slug` (line 792): lowercase, non-alphanumeric runs to `-`, one leading/trailing `-`
 *  stripped, capped at 40 chars, `'new-work'` when that leaves nothing. */
function slugify(text: string): string {
  const base = text || 'new-work';
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return slug || 'new-work';
}

/** Mockup `suggest` (line 800): a not-yet-started draft's own display branch name, before the user
 *  types a real one — Jira key (lowercased) prefixed onto the title, else the title alone, else the
 *  bare key, else `'New work'`. Only ever read as a *display* fallback (`wtOf`'s own draft case) —
 *  never persisted, never what `Start` actually creates (`startDraftLines`' own `bn` input, §0.13). */
function suggestedBranch(ctx: DialogCtx, itemId: string): string {
  const draft = ctx.snapshot.newWork.find((w) => w.id === itemId);
  if (!draft) return '';
  const key = draft.jira.key;
  const title = draft.title || key || 'New work';
  return `feat/${slugify(key ? `${key.toLowerCase()}-${title}` : title)}`;
}

/** Mockup `wtOf` (line 1661): real `AdeBranch.worktree` wins when set (rule test §3.2.4); a draft
 *  with no branch yet falls back to its own suggested name (`suggestedBranch`) so display text still
 *  names a worktree, matching every mockup call site's own `b.name || b.suggest`. */
export function wtOf(ctx: DialogCtx, id: string): string {
  const b = branchOf(ctx, id);
  if (b?.worktree) return b.worktree;
  const dir = worktreeDir(ctx);
  const name = b?.branch || suggestedBranch(ctx, id);
  return name ? `${dir}/${lastSegment(name)}` : `${dir}/`;
}

/** `AdeSession.branch` is the git branch NAME (Part 3's own `buildItems` join, `useQueue.ts`
 *  `s.branch === b.branch`) — never the item id; a draft has no branch, so it only ever joins via
 *  `newWorkId`. */
function sessionsForItem(ctx: DialogCtx, id: string): AdeSession[] {
  const bName = branchOf(ctx, id)?.branch;
  return ctx.sessions.filter(
    (s) =>
      (bName !== undefined && s.branch !== '' && s.branch === bName) ||
      (s.newWorkId !== '' && s.newWorkId === id),
  );
}

function runningSessionsForItem(ctx: DialogCtx, id: string): AdeSession[] {
  return sessionsForItem(ctx, id).filter((s) => s.state === 'running');
}

/** Mockup `onto` ref resolution (line 1666): `main` reads the short `main.ref` (§0.5); a review
 *  branch is remote-qualified when there's a remote, else bare (§0.3 no-remote rule). */
function ontoRefFor(ctx: DialogCtx, onto: string): string {
  if (onto === 'main') return ctx.snapshot.main?.ref ?? 'main';
  const item = itemsById(ctx).get(onto);
  const branch = branchNameOf(ctx, onto);
  if (item?.kind === 'review' && ctx.snapshot.remote) return `${ctx.snapshot.remote}/${branch}`;
  return branch;
}

// -------------------------------------------------------------------------------------------------
// §0.7: openers
// -------------------------------------------------------------------------------------------------

/** Mockup `stackIds` (line 1063): the root plus every `mine`, non-draft descendant, depth-first in
 *  `kids` order. */
function stackIds(ctx: DialogCtx, rootId: string): string[] {
  const byId = itemsById(ctx);
  const kids = ctx.view.kids;
  const out = [rootId];
  const down = (x: string): void => {
    for (const c of kids[x] ?? []) {
      const item = byId.get(c);
      if (item && item.kind === 'mine' && !item.draft) {
        out.push(c);
        down(c);
      }
    }
  };
  down(rootId);
  return out;
}

/** Mockup `agentTargets` (line 1069): the session record id, for `Send`, or `'new'`. */
function agentTargets(ctx: DialogCtx, ids: readonly string[]): DialogTarget[] {
  return ids.map((id) => {
    const running = runningSessionsForItem(ctx, id);
    return { item: id, choice: running.length ? (running[0] as AdeSession).id : 'new' };
  });
}

/** Mockup `rebaseDialog` (line 1064). */
export function rebaseSpec(
  ctx: DialogCtx,
  roots: readonly string[],
  onto: string,
  title: string,
): DialogSpec {
  const ontoItem = onto !== 'main' ? itemsById(ctx).get(onto) : undefined;
  const kind: DialogKind = onto !== 'main' && ontoItem?.kind === 'review' ? 'queue' : 'rebase';
  let ids: string[] = [];
  for (const r of roots) ids = ids.concat(stackIds(ctx, r));
  return { kind, title, roots: [...roots], onto, ids, targets: agentTargets(ctx, roots) };
}

/** Part 3's `QueueAction` (`rebase`/`queueAfter`) to `rebaseSpec`, matching each block action's own
 *  title rule (mockup lines 1153, 1161-1162). `action.targetIds` is `[root]` (onto main), `[root,
 *  onto]` (rebase's own `after` fix, §0.9), or `[stackRoot, with]` (`queueAfter`'s conflict). */
export function specForQueueAction(
  ctx: DialogCtx,
  action: { kind: 'queueAfter' | 'rebase'; targetIds: readonly string[] },
): DialogSpec {
  if (action.kind === 'queueAfter') {
    const [root, withId] = action.targetIds as [string, string];
    return rebaseSpec(ctx, [root], withId, `Queue after ${branchNameOf(ctx, withId)}`);
  }
  if (action.targetIds.length > 1) {
    const [root, ontoId] = action.targetIds as [string, string];
    return rebaseSpec(ctx, [root], ontoId, `Rebase onto ${branchNameOf(ctx, ontoId)}`);
  }
  const [root] = action.targetIds as [string];
  return rebaseSpec(ctx, [root], 'main', 'Rebase onto main');
}

/** Mockup `rebaseAll` (line 1778): every behind, mine, non-parked, non-continuation root. */
export function rebaseAllSpec(ctx: DialogCtx): DialogSpec {
  return rebaseSpec(ctx, ctx.view.behindRoots, 'main', 'Rebase all onto main');
}

/** Mockup `startDialog` (line 1070): a draft creates a branch from its parent (or `main`); an
 *  existing branch starts a session on it. */
export function startSpec(ctx: DialogCtx, itemId: string): DialogSpec {
  const item = itemsById(ctx).get(itemId);
  if (item?.draft) {
    const parent = ctx.view.parentOf[itemId];
    const base = parent ? branchNameOf(ctx, parent) : 'main';
    return {
      kind: 'start',
      title: 'Start new work',
      draft: true,
      branch: itemId,
      base,
      targets: [],
    };
  }
  return {
    kind: 'start',
    title: 'Start Claude Code',
    branch: itemId,
    targets: agentTargets(ctx, [itemId]),
  };
}

/** Mockup's Stopped-list `resume` (line 1642) and All agents' non-running `run` (line 887) — both
 *  omit `D.targets`, so the mockup itself falls back to `agentTargets([D.branch])` (line 1739); we
 *  compute that same fallback up front instead of deferring it. */
export function resumeSpec(
  ctx: DialogCtx,
  itemId: string,
  sessionId: string,
  opts?: { askWt?: boolean; wt?: 'same' | 'new'; noSame?: boolean; title?: string },
): DialogSpec {
  return {
    kind: 'start',
    title: opts?.title ?? 'Resume Claude Code',
    branch: itemId,
    resume: sessionId,
    askWt: opts?.askWt ?? false,
    wt: opts?.wt,
    noSame: opts?.noSame ?? false,
    targets: agentTargets(ctx, [itemId]),
  };
}

/** Mockup `moveDialog` (line 1132) — the "parked-only moves apply directly" and "never before its
 *  parent" guards are the caller's own drop-handling logic (Part 5), not this opener's. */
export function moveSpec(
  ctx: DialogCtx,
  ids: readonly string[],
  before: string | null,
  day: string | null,
  applyPlan?: () => Promise<void>,
): DialogSpec {
  const lead = ids[0] as string;
  return {
    kind: 'move',
    title: 'Move work',
    ids: [...ids],
    before,
    day,
    targets: agentTargets(ctx, [lead]),
    applyPlan,
  };
}

/** Mockup `requestArchive` (line 1088) — the "nothing at risk archives directly, no dialog" branch
 *  is the caller's own (`dialogFlow.ts`'s `requestArchive`, §0.16); this opener only builds the
 *  at-risk dialog's own spec. */
export function archiveSpec(
  ctx: DialogCtx,
  item: string,
  risk: { dirty: string[]; unmerged: number; worktree: string },
): DialogSpec {
  return {
    kind: 'archive',
    title: 'Archive: work would be lost',
    branch: item,
    risk,
    targets: agentTargets(ctx, [item]),
  };
}

// -------------------------------------------------------------------------------------------------
// §0.3/§0.13: templates
// -------------------------------------------------------------------------------------------------

/** One root's own header-plus-steps block (mockup's `roots.forEach` body, lines 1667-1674) — no
 *  leading/trailing blank line; `composeRebaseMessage`/`messageForRoot` join these with the
 *  mockup's own blank-line separator (`if (i) lines.push('')`). */
function rebaseRootBlocks(ctx: DialogCtx, spec: DialogSpec): string[] {
  const onto = spec.onto ?? 'main';
  const ontoRef = ontoRefFor(ctx, onto);
  const ontoBranchName =
    onto === 'main' ? (ctx.snapshot.main?.name ?? 'main') : branchNameOf(ctx, onto);
  const remote = ctx.snapshot.remote;
  return (spec.roots ?? []).map((rid) => {
    const bName = branchNameOf(ctx, rid);
    const chain: [string, string][] = [];
    const down = (x: string): void => {
      for (const c of ctx.view.kids[x] ?? []) {
        const item = itemsById(ctx).get(c);
        if (item && item.kind === 'mine' && !item.draft) {
          chain.push([c, x]);
          down(c);
        }
      }
    };
    down(rid);
    const lines: string[] = [];
    lines.push(
      `Rebase ${bName} onto ${ontoBranchName}${chain.length ? ', then restack the branches built on it:' : '.'}`,
    );
    lines.push(
      remote
        ? `1. In ${wtOf(ctx, rid)}: git fetch ${remote} && git rebase ${ontoRef}`
        : `1. In ${wtOf(ctx, rid)}: git rebase ${ontoRef}`,
    );
    chain.forEach(([childId, parentId], ci) => {
      lines.push(`${ci + 2}. In ${wtOf(ctx, childId)}: git rebase ${branchNameOf(ctx, parentId)}`);
    });
    return lines.join('\n');
  });
}

/** Mockup's rebase/queue message, over every root in `spec.roots` (lines 1664-1677). */
function composeRebaseMessage(ctx: DialogCtx, spec: DialogSpec, push: boolean): string {
  const blocks = rebaseRootBlocks(ctx, spec);
  const onto = spec.onto ?? 'main';
  const ontoItem = onto !== 'main' ? itemsById(ctx).get(onto) : undefined;
  const lines: string[] = [];
  blocks.forEach((block, i) => {
    if (i) lines.push('');
    lines.push(block);
  });
  if (onto !== 'main' && ontoItem?.kind === 'review') {
    lines.push(`Do not modify ${branchNameOf(ctx, onto)}.`);
  }
  const pushLine = push
    ? 'Then push each rebased branch with: git push --force-with-lease'
    : 'Do not push.';
  lines.push(`Resolve any conflicts. ${pushLine}`);
  lines.push('If anything is unclear, ask me before changing anything.');
  return lines.join('\n');
}

/** P129 Part 4 §0.13: the message actually delivered to one root's own target.
 *  - A single-root spec: the dialog's own message, unedited or not (nothing to split).
 *  - Unedited (`state.msg === null`): the mockup's own output for a single-root dialog over just
 *    this root — every delivered text stays a byte-exact template.
 *  - Edited: the edited text with every *other* root's own block stripped, only where that block's
 *    text (plus its one separating blank line) still appears verbatim; an edited-away block can't
 *    be located, so it goes through as-is. */
export function messageForRoot(
  ctx: DialogCtx,
  spec: DialogSpec,
  root: string,
  state: { msg: string | null; push: boolean },
): string {
  const roots = spec.roots ?? [];
  if (roots.length <= 1) {
    return state.msg ?? composeRebaseMessage(ctx, spec, state.push);
  }
  if (state.msg === null) {
    return composeRebaseMessage(ctx, { ...spec, roots: [root] }, state.push);
  }
  const blocks = rebaseRootBlocks(ctx, spec);
  let result = state.msg;
  roots.forEach((rid, j) => {
    if (rid === root) return;
    const block = blocks[j] as string;
    const chunk = j === 0 ? `${block}\n\n` : `\n\n${block}`;
    if (result.includes(chunk)) result = result.replace(chunk, '');
  });
  return result;
}

function archiveLines(ctx: DialogCtx, spec: DialogSpec): string[] {
  const branch = spec.branch as string;
  const bName = branchNameOf(ctx, branch);
  const risk = spec.risk as { dirty: string[]; unmerged: number; worktree: string };
  const lines: string[] = [
    'This branch is being archived and its worktree will be deleted.',
    `- Branch: ${bName}`,
    `- Worktree: ${risk.worktree || wtOf(ctx, branch)}`,
  ];
  if (risk.dirty.length) lines.push(`- Uncommitted changes: ${risk.dirty.join(', ')}`);
  if (risk.unmerged) lines.push(`- Commits not merged into main: ${risk.unmerged}`);
  lines.push('Before it is deleted: ');
  return lines;
}

function moveLines(ctx: DialogCtx, spec: DialogSpec): string[] {
  const ids = spec.ids ?? [];
  const leadId = ids[0] as string;
  const dayText =
    spec.day === null || spec.day === undefined
      ? 'later, unscheduled'
      : `on ${dayLong(spec.day, ctx.today)}`;
  const beforeText = spec.before ? `, before ${branchNameOf(ctx, spec.before)}` : '';
  return [
    `Planned merge order changed: ${branchNameOf(ctx, leadId)} (${wtOf(ctx, leadId)}) now merges ${dayText}${beforeText}.`,
    'No git changes for now.',
  ];
}

function startDraftLines(ctx: DialogCtx, spec: DialogSpec, branchNameInput: string): string[] {
  const itemId = spec.branch as string;
  const title = titleOfItem(ctx, itemId);
  const newWork = ctx.snapshot.newWork.find((w) => w.id === itemId);
  const remote = ctx.snapshot.remote;
  const bn = branchNameInput.trim();
  const fromB = spec.base === 'main' ? (ctx.snapshot.main?.ref ?? 'main') : (spec.base ?? 'main');
  const lines: string[] = [`Start new work: ${title}`];
  if (bn) {
    const dir = `${worktreeDir(ctx)}/${lastSegment(bn)}`;
    lines.push(
      remote
        ? `- git fetch ${remote}, then create branch ${bn} from ${fromB} in a new worktree at ${dir}`
        : `- Create branch ${bn} from ${fromB} in a new worktree at ${dir}`,
    );
  } else {
    const dir = `${worktreeDir(ctx)}/`;
    lines.push(
      remote
        ? `- git fetch ${remote}, then create a new branch from ${fromB} (pick a short descriptive name) in a new worktree under ${dir}`
        : `- Create a new branch from ${fromB} (pick a short descriptive name) in a new worktree under ${dir}`,
    );
  }
  if (newWork?.jira.key) {
    lines.push(
      newWork.jira.url
        ? `- Jira: ${newWork.jira.key} ${newWork.jira.url}`
        : `- Jira: ${newWork.jira.key}`,
    );
  }
  if (newWork?.notes) lines.push(`- Notes: ${newWork.notes}`);
  return lines;
}

/** P129 Part 7 §0.11: `spec.resume` is the `ade_sessions` record id (§0.2) — the mockup's own `4hex`
 *  id text on a real resume was always the *Claude* session id's own short form, `sessionLabel`'s own
 *  `claudeSessionId.slice(0, 8)`, and the worktree line is a real resume's own recorded cwd, never
 *  `wtOf`'s branch-name guess. Both fall back to `branchNameOf`/`wtOf` only when the session record
 *  itself can no longer be found (stale dialog, sessions list refreshed out from under it). */
function startResumeLines(ctx: DialogCtx, spec: DialogSpec): string[] {
  const itemId = spec.branch as string;
  const session = ctx.sessions.find((s) => s.id === spec.resume);
  const bName = session ? session.branch : branchNameOf(ctx, itemId);
  const idText = session ? session.claudeSessionId.slice(0, 8) : (spec.resume ?? '');
  const wtLine =
    spec.askWt && spec.wt === 'new'
      ? 'create a new worktree for it'
      : session?.cwd || wtOf(ctx, itemId);
  return [`Resume session ${idText}.`, `- Branch: ${bName}`, `- Worktree: ${wtLine}`];
}

function startExistingLines(ctx: DialogCtx, spec: DialogSpec): string[] {
  const itemId = spec.branch as string;
  const sb = branchOf(ctx, itemId);
  const title = titleOfItem(ctx, itemId);
  const lines: string[] = [
    `Work on ${title}.`,
    `- Branch: ${sb?.branch ?? itemId}`,
    `- Worktree: ${wtOf(ctx, itemId)}`,
  ];
  if (sb?.jira.key) {
    lines.push(sb.jira.url ? `- Jira: ${sb.jira.key} ${sb.jira.url}` : `- Jira: ${sb.jira.key}`);
  }
  return lines;
}

// -------------------------------------------------------------------------------------------------
// §0.10-§0.11: composeDialog
// -------------------------------------------------------------------------------------------------

/** The unedited template, per kind (mockup's own `lines` construction, lines 1664-1710). Exported
 *  for `dialogFlow.ts`'s send-path: a start/move dialog's delivered message is always this template
 *  (or the user's edited `msg`) for its one target — reusing this avoids duplicating the per-kind
 *  dispatch `composeDialog` already encodes, and avoids misusing `messageForRoot` (rebase/queue only). */
export function templateFor(ctx: DialogCtx, spec: DialogSpec, state: DialogState): string {
  if (spec.kind === 'rebase' || spec.kind === 'queue')
    return composeRebaseMessage(ctx, spec, state.push);
  if (spec.kind === 'archive') return archiveLines(ctx, spec).join('\n');
  if (spec.kind === 'move') return moveLines(ctx, spec).join('\n');
  if (spec.draft) return startDraftLines(ctx, spec, state.branchName).join('\n');
  if (spec.resume) return startResumeLines(ctx, spec).join('\n');
  return startExistingLines(ctx, spec).join('\n');
}

/** §0.10: every running `working`/`waiting` session on a rebase/queue's own `ids` (or `roots`, when
 *  `ids` is unset — a single-target `queueAfter`/`rebase` spec). */
function busyListFor(
  ctx: DialogCtx,
  spec: DialogSpec,
  activity: ReadonlyMap<string, AgentActivity>,
): { text: string; kind: ActivityKind }[] {
  const busyList: { text: string; kind: ActivityKind }[] = [];
  if (spec.kind !== 'rebase' && spec.kind !== 'queue') return busyList;
  for (const id of spec.ids ?? spec.roots ?? []) {
    const branch = branchOf(ctx, id);
    if (!branch) continue;
    for (const session of runningSessionsForItem(ctx, id)) {
      const kind: ActivityKind = activityKind(session, activity);
      if (kind === 'working' || kind === 'waiting') {
        busyList.push({
          text: `${branch.branch} · ${sessionLabel(session)} · ${ACTIVITY_LABEL[kind]}`,
          kind,
        });
      }
    }
  }
  return busyList;
}

function riskTextFor(spec: DialogSpec): string {
  const risk = spec.risk;
  if (spec.kind !== 'archive' || !risk) return '';
  return [
    risk.dirty.length
      ? `${risk.dirty.length} uncommitted file${risk.dirty.length > 1 ? 's' : ''}`
      : '',
    risk.unmerged
      ? `${risk.unmerged} commit${risk.unmerged > 1 ? 's' : ''} not merged into main`
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function sendLabelFor(spec: DialogSpec, busyCount: number, override: boolean): string {
  if (busyCount && override) return 'Send anyway';
  if (spec.kind === 'start') return 'Start';
  if (spec.kind === 'archive') return 'Send to Claude, then archive';
  return 'Send to Claude';
}

/** §0.11/§0.14: the actual resolved choice for one target — a running session's own id, or `'new'`.
 *  A stored `choice` no longer among the item's current running sessions falls back to the first
 *  running option, else `'new'`. The single source of truth `targetsFor`'s own display reads and
 *  `dialogFlow.ts`'s delivery both defer to, so a display fallback and an actual delivery target
 *  can never disagree. */
export function resolvedChoice(ctx: DialogCtx, tg: DialogTarget): string {
  const running = runningSessionsForItem(ctx, tg.item);
  if (!running.length) return 'new';
  return running.some((s) => s.id === tg.choice) ? tg.choice : (running[0] as AdeSession).id;
}

/** §0.11: `options` recompute live off the item's current running sessions, else a lone `'new
 *  session'`; a stored `choice` no longer among them falls back to the first option
 *  (`resolvedChoice`). */
function targetsFor(ctx: DialogCtx, spec: DialogSpec): DialogTargetView[] {
  const rawTargets = spec.draft
    ? []
    : spec.targets.length
      ? spec.targets
      : agentTargets(ctx, [spec.branch as string]);
  return rawTargets.map((tg) => {
    const running = runningSessionsForItem(ctx, tg.item);
    const opts = running.length
      ? running.map((s) => ({ id: s.id, label: sessionLabel(s) }))
      : [{ id: 'new', label: 'new session' }];
    const chosenId = resolvedChoice(ctx, tg);
    return {
      title: titleOfItem(ctx, tg.item),
      branch: branchNameOf(ctx, tg.item),
      options: opts.map((o) => ({
        value: o.id,
        label: `${o.label}${running.length === 1 ? ' (only agent)' : ''}`,
        on: chosenId === o.id,
      })),
    };
  });
}

/** Mockup line 1753: always computed from `D.noSame`/`D.wt`, independent of `D.askWt` — the UI, not
 *  the data, decides whether to show it (§3.1 discovery — no `askWt` guard here). */
function wtOptionsFor(spec: DialogSpec): DialogChip[] {
  return (
    [
      ['same', 'same worktree'],
      ['new', 'new worktree'],
    ] as const
  )
    .filter(([key]) => !(spec.noSame && key === 'same'))
    .map(([key, label]) => ({ value: key, label, on: spec.wt === key }));
}

export function composeDialog(
  ctx: DialogCtx,
  spec: DialogSpec,
  state: DialogState,
  activity: ReadonlyMap<string, AgentActivity>,
): DialogView {
  const template = templateFor(ctx, spec, state);
  const message = state.msg !== null ? state.msg : template;
  const edited = state.msg !== null;
  const sendDisabled = message.trim().length === 0;

  const busyList = busyListFor(ctx, spec, activity);
  const blocked = busyList.length > 0 && !state.override;
  const overridden = busyList.length > 0 && state.override;
  const overrideLabel = state.override ? 'Undo override' : 'Override…';
  const busyTitle = state.override
    ? 'Override on: this will be sent even though these agents are busy.'
    : "Agents are busy on branches this would rewrite. Wait until they're idle or need input.";

  return {
    title: spec.title,
    blocked,
    busyShown: busyList.length > 0,
    overridden,
    overrideLabel,
    busyTitle,
    busy: busyList,
    message,
    edited,
    sendDisabled,
    isDraft: !!spec.draft,
    canPush: spec.kind === 'rebase' || spec.kind === 'queue',
    pushOn: !!state.push,
    sendLabel: sendLabelFor(spec, busyList.length, state.override),
    isArchive: spec.kind === 'archive',
    riskText: riskTextFor(spec),
    targets: targetsFor(ctx, spec),
    askWt: !!spec.askWt,
    wtOptions: wtOptionsFor(spec),
  };
}
