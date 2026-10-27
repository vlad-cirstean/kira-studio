import type { ScriptRun, ScriptRunState } from '@shared/domain/scriptRuns';
import type { ScriptRunTabState, TerminalTabState } from '@shared/domain/tabs';
import { useAutomationsModule } from './module';
import { scriptRunState, terminalRunState } from './runs/runStates';

/** One tab per key: the script and the ADE task and branch it runs for ('' when none). */
export interface ScriptTabKey {
  scriptId: string;
  taskId: string;
  branchId: string;
}

export interface ScriptTabLike {
  id: string;
  kind: string;
  state: unknown;
}

export function keyOf(run: Pick<ScriptRun, 'scriptId' | 'taskId' | 'branchId'>): ScriptTabKey {
  return { scriptId: run.scriptId, taskId: run.taskId, branchId: run.branchId };
}

function sameKey(a: ScriptTabKey, b: ScriptTabKey): boolean {
  return a.scriptId === b.scriptId && a.taskId === b.taskId && a.branchId === b.branchId;
}

function tabKey(tab: ScriptTabLike): ScriptTabKey | null {
  if (tab.kind === 'terminal') {
    const s = tab.state as TerminalTabState;
    return s.launchKind === 'script' && s.scriptId !== ''
      ? { scriptId: s.scriptId, taskId: s.taskId, branchId: s.branchId }
      : null;
  }
  if (tab.kind === 'script-run') {
    const s = tab.state as ScriptRunTabState;
    return s.scriptId === ''
      ? null
      : { scriptId: s.scriptId, taskId: s.taskId, branchId: s.branchId };
  }
  return null;
}

const LIVE_RUN: readonly ScriptRunState[] = ['running', 'waiting'];

/** Live: a terminal whose session has not ended and whose run is not over; a run still running or waiting. */
export function isLiveTab(
  tab: ScriptTabLike,
  terminalStatus: (tabId: string) => string | undefined,
): boolean {
  if (tab.kind === 'terminal') {
    const status = terminalStatus(tab.id);
    if (status === 'exited' || status === 'failed') return false;
    const run = terminalRunState(tab.id);
    return run === undefined || LIVE_RUN.includes(run);
  }
  const state = scriptRunState((tab.state as ScriptRunTabState).runId);
  return state !== undefined && LIVE_RUN.includes(state);
}

/** Where a run of `key` goes: the live tab to focus, else the finished one to replace. */
export function pickKeyTab(
  tabs: readonly ScriptTabLike[],
  key: ScriptTabKey,
  live: (tab: ScriptTabLike) => boolean,
): { focus?: string; replace?: string } {
  const mine = tabs.filter((t) => {
    const k = tabKey(t);
    return k !== null && sameKey(k, key);
  });
  return { focus: mine.find(live)?.id, replace: mine.find((t) => !live(t))?.id };
}

/** Placement for opening a script run's tab, outside a component (agent reveal). */
export function placeRunTab(
  tabs: readonly ScriptTabLike[],
  state: ScriptRunTabState,
  live: (tab: ScriptTabLike) => boolean,
): { activate?: string; replace?: string } {
  const same = tabs.find(
    (t) => t.kind === 'script-run' && (t.state as ScriptRunTabState).runId === state.runId,
  );
  if (same) return { activate: same.id };
  return { replace: pickKeyTab(tabs, state, live).replace };
}

export interface ScriptTabs {
  /** Focuses the live tab of `key`; false when none is live. */
  focusLive(key: ScriptTabKey): boolean;
  isLive(key: ScriptTabKey): boolean;
  replaceTarget(key: ScriptTabKey): string | undefined;
  /** Opens a run's tab: the tab already showing it, else replacing the key's finished tab. */
  openRun(target: ScriptTabKey & { runId: string; label: string }): void;
}

export function useScriptTabs(): ScriptTabs {
  const ctx = useAutomationsModule();
  const live = (tab: ScriptTabLike): boolean =>
    isLiveTab(tab, (id) => ctx.host.terminalSession(id)?.status);

  function isLive(key: ScriptTabKey): boolean {
    return pickKeyTab(ctx.tabs.list(), key, live).focus !== undefined;
  }

  return {
    isLive,
    focusLive(key) {
      const { focus } = pickKeyTab(ctx.tabs.list(), key, live);
      if (focus === undefined) return false;
      ctx.showAutomations();
      ctx.tabs.activate(focus);
      return true;
    },
    replaceTarget: (key) => pickKeyTab(ctx.tabs.list(), key, live).replace,
    openRun(target) {
      const state: ScriptRunTabState = target;
      const { activate, replace } = placeRunTab(ctx.tabs.list(), state, live);
      if (activate !== undefined) ctx.tabs.activate(activate);
      else ctx.openRunTab(state, replace);
    },
  };
}
