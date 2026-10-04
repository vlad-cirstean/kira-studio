import { ACTIVITY_LABEL, type ActivityKind, activityKind, shortId } from '../activity';
import type { BranchAction } from '../board/actions';
import type { BranchGraph } from '../board/branchGraph';
import type { ArchiveRisk, Branch, Session, Task } from '../wire';

// Pure templates and view model of the Claude dialog (mockup `dlg`, SPEC2 sections 5, 6, 9, 10).
// No Vue, no clock; `AdeClaudeDialog.vue` wraps `composeDialog` in a computed. The stage and start
// templates mirror the server defaults (`composeStageMessage`, `composeStartMessage`): an unedited
// message is sent as `''` and the server composes it, so these only show what it will say.

export type DialogKind = 'rebase' | 'queue' | 'merge' | 'stage' | 'start' | 'archive';

export interface DialogTarget {
  branchId: string;
  /** A session record id, or `'new'` for a fresh launch. */
  choice: string;
}

export interface DialogSpec {
  kind: DialogKind;
  title: string;
  /** rebase / queue: the stack root being rebased; merge / start: the branch. */
  branchId?: string;
  /** rebase / queue: the branch id to rebase onto, `'main'` for the repo's main. */
  onto?: string;
  /** rebase / queue: the stack the busy check covers. */
  stack?: string[];
  /** merge: the integration branch. */
  target?: string;
  /** stage / archive: the task. */
  taskId?: string;
  /** archive: only the branches at risk. */
  risk?: ArchiveRisk;
  targets: DialogTarget[];
}

export interface DialogState {
  /** `null` = the unedited template. */
  msg: string | null;
  push: boolean;
  override: boolean;
}

export interface DialogCtx {
  graph: BranchGraph;
  /** Sessions with TUI activity merged in. */
  sessions: readonly Session[];
  worktreeBasePath: string;
  repoState: (codeRepoId: string) => { mainName: string; remote: string };
  repo: (codeRepoId: string) => { nick: string; name: string; root: string };
  taskTitle: (taskId: string) => string;
  /** First step of the task's current agent stage that is not done, `''` otherwise. */
  openStep: (taskId: string) => string;
}

export interface DialogChip {
  value: string;
  label: string;
  on: boolean;
}

export interface DialogView {
  title: string;
  message: string;
  edited: boolean;
  /** A blank message disables Send. */
  sendDisabled: boolean;
  blocked: boolean;
  busy: { text: string; kind: ActivityKind }[];
  busyShown: boolean;
  busyTitle: string;
  overrideLabel: string;
  overridden: boolean;
  /** A running background run on the stack: blocks with no override. */
  headless: string;
  canPush: boolean;
  pushOn: boolean;
  pushLabel: string;
  isArchive: boolean;
  riskText: string;
  targets: {
    repo: string;
    repoId: string;
    branch: string;
    branchId: string;
    options: DialogChip[];
  }[];
  sendLabel: string;
}

// ---- lookups

function branchOf(ctx: DialogCtx, id: string): Branch | undefined {
  return ctx.graph.byBranch.get(id);
}

function taskOf(ctx: DialogCtx, id: string): Task | undefined {
  return ctx.graph.byTask.get(id);
}

function lastSegment(name: string): string {
  return name.split('/').at(-1) || name;
}

/** The server's worktree directory segment: `/` in a repo name becomes `-`. */
function repoSegment(name: string): string {
  return name.replaceAll('/', '-');
}

function baseDir(ctx: DialogCtx): string {
  return ctx.worktreeBasePath.replace(/\/+$/, '');
}

/** The branch's worktree, else where the server would create it. */
export function wtOf(ctx: DialogCtx, b: Branch): string {
  if (b.worktree) return b.worktree;
  const repo = ctx.repo(b.codeRepoId);
  return `${baseDir(ctx)}/${repoSegment(repo.name)}/${lastSegment(b.name)}`;
}

function runningTui(ctx: DialogCtx, branchId: string): Session[] {
  return ctx.sessions.filter(
    (s) => s.branchId === branchId && s.mode === 'tui' && s.state === 'running',
  );
}

function ontoName(ctx: DialogCtx, b: Branch, onto: string): string {
  return onto === 'main'
    ? ctx.repoState(b.codeRepoId).mainName || 'main'
    : (branchOf(ctx, onto)?.name ?? onto);
}

function ontoRef(ctx: DialogCtx, b: Branch, onto: string): string {
  if (onto === 'main') {
    const st = ctx.repoState(b.codeRepoId);
    return `${st.remote || 'origin'}/${st.mainName || 'main'}`;
  }
  const o = branchOf(ctx, onto);
  return o?.kind === 'review'
    ? `${ctx.repoState(b.codeRepoId).remote || 'origin'}/${o.name}`
    : (o?.name ?? onto);
}

/** The root plus every created branch of mine stacked on it, depth first. */
export function stackOf(ctx: DialogCtx, rootId: string): string[] {
  const out = [rootId];
  const down = (id: string): void => {
    for (const c of ctx.graph.kids.get(id) ?? []) {
      const kid = branchOf(ctx, c);
      if (kid && kid.kind === 'mine' && kid.name !== '') {
        out.push(c);
        down(c);
      }
    }
  };
  down(rootId);
  return out;
}

function targetsFor(ctx: DialogCtx, ids: readonly string[]): DialogTarget[] {
  return ids.map((branchId) => ({
    branchId,
    choice: runningTui(ctx, branchId)[0]?.id ?? 'new',
  }));
}

// ---- openers

export function rebaseSpec(
  ctx: DialogCtx,
  rootId: string,
  onto: string,
  title: string,
): DialogSpec {
  const kind = branchOf(ctx, onto)?.kind === 'review' ? 'queue' : 'rebase';
  return {
    kind,
    title,
    branchId: rootId,
    onto,
    stack: stackOf(ctx, rootId),
    targets: targetsFor(ctx, [rootId]),
  };
}

/** The dialog behind a branch cell's `Rebase` / `Queue after` button. A queue-after or a rebase
 *  onto the repo's main acts on the stack root; a rebase onto a branch acts on the branch itself. */
export function specForBranchAction(
  ctx: DialogCtx,
  branchId: string,
  action: BranchAction,
): DialogSpec | null {
  if (action.kind === 'queueAfter' && action.target) {
    const name = branchOf(ctx, action.target)?.name ?? '';
    return rebaseSpec(ctx, ctx.graph.rootOf(branchId), action.target, `Queue after ${name}`);
  }
  if (action.kind !== 'rebase') return null;
  if (!action.target)
    return rebaseSpec(ctx, ctx.graph.rootOf(branchId), 'main', 'Rebase onto main');
  const name = branchOf(ctx, action.target)?.name ?? '';
  return rebaseSpec(ctx, branchId, action.target, `Rebase onto ${name}`);
}

export function mergeSpec(ctx: DialogCtx, branchId: string, target: string): DialogSpec {
  const stale =
    branchOf(ctx, branchId)?.integration.find((i) => i.target === target)?.status === 'stale';
  return {
    kind: 'merge',
    title: `${stale ? 'Re-merge' : 'Merge'} into ${target}`,
    branchId,
    target,
    targets: targetsFor(ctx, [branchId]),
  };
}

export function stageSpec(ctx: DialogCtx, taskId: string): DialogSpec {
  const name = taskOf(ctx, taskId)?.currentStage?.name ?? 'Stage';
  return { kind: 'stage', title: `${name} · interactive Claude Code`, taskId, targets: [] };
}

export function startSpec(branchId: string): DialogSpec {
  return { kind: 'start', title: 'Start Claude Code (interactive)', branchId, targets: [] };
}

export function archiveSpec(ctx: DialogCtx, risk: ArchiveRisk): DialogSpec {
  const atRisk = risk.branches.filter((r) => r.dirty.length > 0 || r.unmerged > 0);
  return {
    kind: 'archive',
    title: 'Archive: work would be lost',
    taskId: risk.taskId,
    risk: { ...risk, branches: atRisk },
    targets: targetsFor(
      ctx,
      atRisk.map((r) => r.branchId),
    ),
  };
}

// ---- templates

const ASK = 'If anything is unclear, ask me before changing anything.';

function rebaseMessage(ctx: DialogCtx, spec: DialogSpec, push: boolean): string {
  const b = branchOf(ctx, spec.branchId ?? '') as Branch;
  const onto = spec.onto ?? 'main';
  const o = onto === 'main' ? undefined : branchOf(ctx, onto);
  const remote = ctx.repoState(b.codeRepoId).remote || 'origin';
  const chain: [string, string][] = [];
  const down = (id: string): void => {
    for (const c of ctx.graph.kids.get(id) ?? []) {
      const kid = branchOf(ctx, c);
      if (kid && kid.kind === 'mine' && kid.name !== '') {
        chain.push([c, id]);
        down(c);
      }
    }
  };
  down(b.id);
  const lines = [
    `Rebase ${b.name} (repo ${ctx.repo(b.codeRepoId).nick}) onto ${ontoName(ctx, b, onto)}${chain.length ? ', then restack the branches built on it:' : '.'}`,
    `1. In ${wtOf(ctx, b)}: git fetch ${remote} && git rebase ${ontoRef(ctx, b, onto)}`,
  ];
  chain.forEach(([child, parent], i) => {
    lines.push(
      `${i + 2}. In ${wtOf(ctx, branchOf(ctx, child) as Branch)}: git rebase ${branchOf(ctx, parent)?.name ?? parent}`,
    );
  });
  if (o?.kind === 'review') lines.push(`Do not modify ${o.name}.`);
  lines.push(
    `Resolve any conflicts. ${push ? 'Then push each rebased branch with: git push --force-with-lease' : 'Do not push.'}`,
  );
  lines.push(ASK);
  return lines.join('\n');
}

/** Worktree of the integration branch `T`, kept apart from the branch's own. */
export function mergeWorktree(ctx: DialogCtx, b: Branch, target: string): string {
  return `${baseDir(ctx)}/${repoSegment(ctx.repo(b.codeRepoId).name)}/_${target}`;
}

function mergeMessage(ctx: DialogCtx, spec: DialogSpec, push: boolean): string {
  const b = branchOf(ctx, spec.branchId ?? '') as Branch;
  const target = spec.target ?? '';
  const remote = ctx.repoState(b.codeRepoId).remote || 'origin';
  const twt = mergeWorktree(ctx, b, target);
  return [
    `Merge ${b.name} into ${target} (repo ${ctx.repo(b.codeRepoId).nick}).`,
    `1. git fetch ${remote}`,
    `2. Use the ${target} worktree at ${twt} (create it if missing: git worktree add ${twt} ${remote}/${target} -B ${target})`,
    `3. In ${twt}: git merge ${b.name}`,
    `Resolve any conflicts. ${push ? `Then push: git push ${remote} ${target}` : 'Do not push.'}`,
    ASK,
  ].join('\n');
}

function archiveMessage(ctx: DialogCtx, spec: DialogSpec): string {
  const lines = [
    `Task "${ctx.taskTitle(spec.taskId ?? '')}" is being archived and its worktrees will be deleted.`,
  ];
  for (const r of spec.risk?.branches ?? []) {
    const b = branchOf(ctx, r.branchId);
    if (!b) continue;
    lines.push(
      `- ${ctx.repo(b.codeRepoId).nick} · ${b.name} · ${r.worktree || wtOf(ctx, b)}` +
        (r.dirty.length ? ` · uncommitted: ${r.dirty.map((d) => d.path).join(', ')}` : '') +
        (r.unmerged ? ` · commits not merged into main: ${r.unmerged}` : ''),
    );
  }
  lines.push('Before they are deleted: ');
  return lines.join('\n');
}

/** One pass, so a value holding a placeholder is not expanded again. */
function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(task|jira|repo|branch|worktree)\}/g, (_, k: string) => vars[k] ?? '');
}

function jiraLine(t: Task | undefined): string {
  return t?.jira ? `- Jira: ${t.jira.key} ${t.jira.url}` : '';
}

function repoLine(ctx: DialogCtx, b: Branch): string {
  const repo = ctx.repo(b.codeRepoId);
  return b.kind === 'mine' && b.name !== ''
    ? `- Repo: ${repo.nick} · Branch: ${b.name} · Worktree: ${wtOf(ctx, b)}`
    : `- Repo: ${repo.nick} (read only, in ${repo.root})`;
}

function stageMessage(ctx: DialogCtx, spec: DialogSpec): string {
  const taskId = spec.taskId ?? '';
  const t = taskOf(ctx, taskId);
  const title = ctx.taskTitle(taskId);
  const stage = t?.currentStage;
  const branches = (t?.branchIds ?? []).flatMap((id) => branchOf(ctx, id) ?? []);
  const lines = [`${stage?.name ?? 'Stage'}: ${title}`];
  const jira = jiraLine(t);
  if (jira) lines.push(jira);
  const own = branches.filter((b) => b.kind === 'mine' && b.name !== '');
  for (const b of branches) lines.push(repoLine(ctx, b));
  if (t?.notes) lines.push(`- Notes: ${t.notes}`);
  if (stage?.prompt) {
    lines.push(
      substitute(stage.prompt, {
        task: title,
        jira: t?.jira?.key ?? '',
        repo: own.map((b) => ctx.repo(b.codeRepoId).nick).join(', '),
        branch: own.map((b) => b.name).join(', '),
        worktree: own.map((b) => wtOf(ctx, b)).join(', '),
      }),
    );
  }
  return lines.join('\n');
}

function startMessage(ctx: DialogCtx, spec: DialogSpec): string {
  const b = branchOf(ctx, spec.branchId ?? '') as Branch;
  const t = taskOf(ctx, b.taskId);
  const lines = [`Task: ${ctx.taskTitle(b.taskId)}`];
  const jira = jiraLine(t);
  if (jira) lines.push(jira);
  lines.push(repoLine(ctx, b));
  const step = ctx.openStep(b.taskId);
  if (step) lines.push(`Step: ${step}`);
  return lines.join('\n');
}

export function templateFor(ctx: DialogCtx, spec: DialogSpec, state: DialogState): string {
  switch (spec.kind) {
    case 'rebase':
    case 'queue':
      return rebaseMessage(ctx, spec, state.push);
    case 'merge':
      return mergeMessage(ctx, spec, state.push);
    case 'archive':
      return archiveMessage(ctx, spec);
    case 'stage':
      return stageMessage(ctx, spec);
    default:
      return startMessage(ctx, spec);
  }
}

// ---- view

/** The delivery target actually used: a stored session choice that is no longer running falls back
 *  to the first running one, else a new session. The display and the delivery share this. */
export function resolvedChoice(ctx: DialogCtx, tg: DialogTarget): string {
  const running = runningTui(ctx, tg.branchId);
  if (!running.length) return 'new';
  return running.some((s) => s.id === tg.choice) ? tg.choice : (running[0] as Session).id;
}

function busyFor(ctx: DialogCtx, spec: DialogSpec): DialogView['busy'] {
  if (spec.kind !== 'rebase' && spec.kind !== 'queue') return [];
  const out: DialogView['busy'] = [];
  for (const id of spec.stack ?? []) {
    const b = branchOf(ctx, id);
    if (!b) continue;
    for (const s of runningTui(ctx, id)) {
      const kind = activityKind(s);
      if (kind === 'working' || kind === 'waiting') {
        out.push({
          text: `${ctx.repo(b.codeRepoId).nick} · ${b.name} · claude ${shortId(s.id)} · ${ACTIVITY_LABEL[kind]}`,
          kind,
        });
      }
    }
  }
  return out;
}

function headlessFor(ctx: DialogCtx, spec: DialogSpec): string {
  if (spec.kind !== 'rebase' && spec.kind !== 'queue') return '';
  for (const id of spec.stack ?? []) {
    if (
      ctx.sessions.some((s) => s.branchId === id && s.mode === 'headless' && s.state === 'running')
    ) {
      return `A background run is active on ${branchOf(ctx, id)?.name ?? id}. Stop it in Sessions, or wait.`;
    }
  }
  return '';
}

function riskText(ctx: DialogCtx, spec: DialogSpec): string {
  if (spec.kind !== 'archive') return '';
  return (spec.risk?.branches ?? [])
    .map((r) => {
      const b = branchOf(ctx, r.branchId);
      const facts = [
        r.dirty.length ? `${r.dirty.length} uncommitted` : '',
        r.unmerged ? `${r.unmerged} unmerged commits` : '',
      ].filter(Boolean);
      return `${b ? ctx.repo(b.codeRepoId).nick : r.branchId}: ${facts.join(', ')}`;
    })
    .join(' · ');
}

function sendLabel(spec: DialogSpec, overridden: boolean): string {
  if (overridden) return 'Send anyway';
  switch (spec.kind) {
    case 'stage':
      return 'Open session';
    case 'start':
      return 'Start';
    case 'archive':
      return 'Send to Claude, then archive';
    default:
      return 'Send to Claude';
  }
}

export function composeDialog(ctx: DialogCtx, spec: DialogSpec, state: DialogState): DialogView {
  const template = templateFor(ctx, spec, state);
  const message = state.msg ?? template;
  const busy = busyFor(ctx, spec);
  const headless = headlessFor(ctx, spec);
  const overridden = busy.length > 0 && state.override;
  const targets: DialogView['targets'] = spec.targets.map((tg) => {
    const b = branchOf(ctx, tg.branchId);
    const running = runningTui(ctx, tg.branchId);
    const chosen = resolvedChoice(ctx, tg);
    const opts = running.length
      ? running.map((s) => ({ value: s.id, label: `claude ${shortId(s.id)}` }))
      : [{ value: 'new', label: 'new session' }];
    return {
      repo: b ? ctx.repo(b.codeRepoId).nick : '',
      repoId: b?.codeRepoId ?? '',
      branch: b?.name ?? tg.branchId,
      branchId: tg.branchId,
      options: opts.map((o) => ({
        value: o.value,
        label: o.label + (running.length === 1 ? ' (only agent)' : ''),
        on: chosen === o.value,
      })),
    };
  });
  return {
    title: spec.title,
    message,
    edited: state.msg !== null,
    sendDisabled: message.trim().length === 0,
    blocked: headless !== '' || (busy.length > 0 && !state.override),
    busy,
    busyShown: busy.length > 0,
    busyTitle: state.override
      ? 'Override on: this will be sent even though these agents are busy.'
      : "Agents are busy on branches this would rewrite. Wait until they're idle or need input.",
    overrideLabel: state.override ? 'Undo override' : 'Override…',
    overridden,
    headless,
    canPush: spec.kind === 'rebase' || spec.kind === 'queue' || spec.kind === 'merge',
    pushOn: state.push,
    pushLabel:
      spec.kind === 'merge' ? `Also push ${spec.target}` : 'Also force-push after rebasing',
    isArchive: spec.kind === 'archive',
    riskText: riskText(ctx, spec),
    targets,
    sendLabel: sendLabel(spec, overridden),
  };
}
