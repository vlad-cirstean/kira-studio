import type { ScriptRun } from '@shared/domain/scriptRuns';
import type {
  CustomScript,
  CustomScriptFields,
  ScriptCollection,
  ScriptDir,
} from '@shared/domain/scripts';
import { type ComputedRef, computed, type InjectionKey, inject } from 'vue';
import type { TerminalLaunch } from '../state/createTerminalTabs';
import type { TerminalHostDeps } from '../terminal/terminalHost';

// P128 §2.4: the shared automations module's own injected context — AutomationsPanel.vue/
// AutomationsStart.vue/AutomationsNewTab.vue read this instead of an app-specific store, so the same
// three components mount in both apps. `openTerminalTab` binds the app's own module workspace
// ('terminal' in both) itself, so shared code never names a workspace key.

/** Each app's script store (createCustomScriptsStore.ts), as the panel and its dialog see it. */
export interface ScriptsSeam {
  records(): readonly CustomScript[];
  create(fields: CustomScriptFields): Promise<unknown>;
  update(id: string, fields: CustomScriptFields): Promise<unknown>;
  remove(id: string): Promise<void>;
  collections(): readonly ScriptCollection[];
  createCollection(name: string): Promise<ScriptCollection>;
  renameCollection(id: string, name: string): Promise<void>;
  removeCollection(id: string): Promise<void>;
  /** collectionId null ungroups. */
  move(id: string, collectionId: string | null): Promise<void>;
}

/** The run store's bound calls and push channel (ScriptRunsService), the same in both apps. */
export interface ScriptRunsSeam {
  list(limit?: number): Promise<ScriptRun[]>;
  stop(id: string): Promise<void>;
  /** Where a saved script runs; an empty id answers the app home as `base`, for an unsaved script. */
  resolveDir(scriptId: string): Promise<ScriptDir>;
  onChanged(cb: (run: ScriptRun) => void): () => void;
}

export interface AutomationsModuleContext {
  defaultCwd(): string;
  openTerminalTab(opts: { cwd: string; launch?: TerminalLaunch }): void;
  host: TerminalHostDeps;
  scripts: ScriptsSeam;
  runs: ScriptRunsSeam;
  /** Focuses the Automations module, e.g. from the status bar. */
  showAutomations(): void;
  /** Native folder dialog; null when cancelled. */
  chooseFolder(title: string): Promise<string | null>;
}

export const automationsModuleKey: InjectionKey<AutomationsModuleContext> =
  Symbol('automationsModule');

export function useAutomationsModule(): AutomationsModuleContext {
  const ctx = inject(automationsModuleKey);
  if (!ctx) throw new Error('useAutomationsModule: no AutomationsModuleContext provided');
  return ctx;
}

/** The one `cwd === ''` guard AutomationsStart.vue and the tab strip's own "+" menu both used —
 *  disabled while the resolved default cwd (§7.2) isn't known yet. */
export function useNewTerminal(): { canOpen: ComputedRef<boolean>; open(): void } {
  const ctx = useAutomationsModule();
  const canOpen = computed(() => ctx.defaultCwd() !== '');
  function open(): void {
    if (!canOpen.value) return;
    ctx.openTerminalTab({ cwd: ctx.defaultCwd() });
  }
  return { canOpen, open };
}
