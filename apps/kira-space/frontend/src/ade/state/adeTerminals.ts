import { cleanupTabRuntime } from '@workbench/state/tabRuntime';
import { defineStore } from 'pinia';
import { reactive, watch } from 'vue';
import { useTerminalsStore } from '../../state/terminals';
import { useAdeSessions } from '../queries';

// P129 Part 6 §0.19: reaps this window's own stopped ade terminals. Part 6 is the first to mount an
// xterm for an ade terminal (`AdeAgentsTab.vue`'s own `TerminalHostView`); nothing else in `ade/`
// ever calls `closeTerminalSession`/`cleanupTabRuntime`, so every stopped session would otherwise
// keep its `byTabId` entry, drain queue and xterm instance for the app's life. One Pinia store, one
// concern: ade-launched terminals in this window.
export const useAdeTerminalsStore = defineStore('adeTerminals', () => {
  const terminalsStore = useTerminalsStore();
  const sessionsQuery = useAdeSessions();
  const tracked = reactive(new Set<string>());

  /** Called from `adeActions.buildLaunchDeps().openTerminalSession` — every terminal id this window
   *  itself opens for an ade session. */
  function track(terminalId: string): void {
    tracked.add(terminalId);
  }

  // A stopped session reports `terminalId: ''` (wire.ts), so it never matches a tracked id here —
  // "no running session's terminalId" alone is the reap signal; the local status check below only
  // guards against reaping one still `starting` a moment before its first sessions-list refetch.
  watch(
    () => {
      const sessions = sessionsQuery.data.value?.sessions ?? [];
      const running = new Set(
        sessions.filter((s) => s.state === 'running').map((s) => s.terminalId),
      );
      return { running, tracked: [...tracked] };
    },
    ({ running, tracked: ids }) => {
      for (const id of ids) {
        if (running.has(id)) continue;
        const local = terminalsStore.terminalSession(id);
        if (local && local.status !== 'exited' && local.status !== 'failed') continue;
        terminalsStore.closeTerminalSession(id);
        cleanupTabRuntime(id);
        tracked.delete(id);
      }
    },
  );

  return { track };
});
