import { restoreAfterEach } from '@workbench/testing/unit/restoreAfterEach';
import { setActivePinia } from 'pinia';
import { pinia } from '../../../frontend/src/state/pinia';

/** Shared pinia/bridge/store bootstrap for the console-*.spec.ts run()/stop() race tests (P12
 *  rounds 1-2) — each spec drives ConsoleViewStore end to end against real store wiring. Pass
 *  `control: true` for the specs that also stub the control bridge (opsCancel). */
export async function bootstrapConsole(opts: { control?: boolean } = {}) {
  setActivePinia(pinia);

  const { data } = await import('../../../frontend/src/bridge/data');
  restoreAfterEach(data);

  let control: typeof import('../../../frontend/src/bridge/control').control | undefined;
  if (opts.control) {
    const mod = await import('../../../frontend/src/bridge/control');
    restoreAfterEach(mod.control);
    control = mod.control;
  }

  const { useConnectionsStore } = await import('../../../frontend/src/state/connections');
  const connectionsStore = useConnectionsStore();
  const { useTabsStore } = await import('../../../frontend/src/state/tabs');
  const tabsStore = useTabsStore();
  const { useConsoleViewStore } = await import('../../../frontend/src/views/console/state');
  const consoleViewStore = useConsoleViewStore();

  return { data, control, connectionsStore, tabsStore, consoleViewStore };
}
