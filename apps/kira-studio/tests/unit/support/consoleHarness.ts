import { beforeEach } from 'bun:test';
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

  // P108 Part 12 F12: createTabsStore's saveIfChanged now serialises every save through one
  // persistent chain (enqueueSave) instead of firing an independent, uninspected promise per call —
  // correct for real IPC, which always eventually settles, but every console-*.spec.ts here shares
  // ONE tabsStore singleton across the whole tests/unit run (Pinia + this module's own shared
  // `pinia`), and opening a console tab below fires a real, un-mocked control.tabsSave whose generic
  // Call() stub (wailsRuntime.ts) deliberately never settles for a call nobody here awaits. Before
  // this fix, that was harmless — an independent, forgotten promise. Now it would permanently wedge
  // the shared chain, starving every later spec's own tabsSave assertions for the rest of the run.
  // restoreAfterEach snapshots control BEFORE this file ever touches tabsSave, so its real
  // implementation (whatever an earlier file already left it as) comes back after every test here —
  // never leaking this harness's own stub into bridge-unwrap.spec.ts's generic "every control method
  // rejects" sweep, the exact hazard restoreAfterEach's own comment already documents for this
  // singleton. beforeEach re-applies the benign stub before each test in this file, since
  // bootstrapConsole itself only runs once per file, not once per test.
  const controlMod = await import('../../../frontend/src/bridge/control');
  restoreAfterEach(controlMod.control);
  beforeEach(() => {
    (controlMod.control as unknown as { tabsSave: () => Promise<void> }).tabsSave = () =>
      Promise.resolve();
  });

  let control: typeof import('../../../frontend/src/bridge/control').control | undefined;
  if (opts.control) {
    control = controlMod.control;
  }

  const { useConnectionsStore } = await import('../../../frontend/src/state/connections');
  const connectionsStore = useConnectionsStore();
  const { useTabsStore } = await import('../../../frontend/src/state/tabs');
  const tabsStore = useTabsStore();
  const { useConsoleViewStore } = await import('../../../frontend/src/views/console/state');
  const consoleViewStore = useConsoleViewStore();

  return { data, control, connectionsStore, tabsStore, consoleViewStore };
}
