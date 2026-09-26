import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import { type ComputedRef, computed, type InjectionKey, inject } from 'vue';
import type { TerminalLaunch } from '../state/createTerminalTabs';
import type { TerminalHostDeps } from './terminalHost';

// P128 §2.4: the shared terminal module's own injected context — TerminalPanel.vue/
// TerminalStart.vue/TerminalNewTab.vue read this instead of an app-specific store, so the same
// three components mount in both apps. `openTerminalTab` binds the app's own module workspace
// ('terminal' in both) itself, so shared code never names a workspace key.

/** Studio's own custom-scripts panel (P85) — optional, since Kira Space has no scripts store of
 *  its own (§0's seam resolution). Every Quick-commands element in TerminalPanel.vue sits behind
 *  `ctx.scripts` being set. */
export interface TerminalScriptsSeam {
  records(): readonly CustomScript[];
  create(fields: CustomScriptFields): Promise<unknown>;
  remove(id: string): Promise<void>;
  openEditor(): void;
}

export interface TerminalModuleContext {
  defaultCwd(): string;
  openTerminalTab(opts: { cwd: string; launch?: TerminalLaunch }): void;
  host: TerminalHostDeps;
  scripts?: TerminalScriptsSeam;
}

export const terminalModuleKey: InjectionKey<TerminalModuleContext> = Symbol('terminalModule');

export function useTerminalModule(): TerminalModuleContext {
  const ctx = inject(terminalModuleKey);
  if (!ctx) throw new Error('useTerminalModule: no TerminalModuleContext provided');
  return ctx;
}

/** The one `cwd === ''` guard TerminalStart.vue and the tab strip's own "+" menu both used —
 *  disabled while the resolved default cwd (§7.2) isn't known yet. */
export function useNewTerminal(): { canOpen: ComputedRef<boolean>; open(): void } {
  const ctx = useTerminalModule();
  const canOpen = computed(() => ctx.defaultCwd() !== '');
  function open(): void {
    if (!canOpen.value) return;
    ctx.openTerminalTab({ cwd: ctx.defaultCwd() });
  }
  return { canOpen, open };
}
