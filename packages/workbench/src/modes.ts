import type { Component } from 'vue';

// P1 D6/C6: mode content comes from a registry, mirroring D4's tab-kind registry — hoisted here at
// P128 §2.3 so both apps' own module registries (each app's own `workbench/modes.ts`) share one
// shape instead of two hand-kept-identical ones. `newTab` is optional: a module with nothing to
// open (Studio's own Studio/Api modules; Space's own `ade` placeholder) simply leaves the tab
// strip's own "+" slot empty (WorkbenchShellBase's own #new-tab), rather than every shell branching
// on `modeStore.active === '<id>'` to decide whether to show one (P128 §0's own "per-module
// branches" resolution).
export interface ModeDef {
  label: string;
  icon: string;
  /** Mounted in the left-panel slot (WorkbenchShell.vue) — a whole self-contained panel that wraps
   *  PanelShell itself, the same way ProjectPanel.vue already does (D6). */
  panel: Component;
  /** MainView.vue's fallback when this mode has no active tab. */
  start: Component;
  /** The tab strip's own "+" for this mode, when it has one — TabStripNewButton.vue wrapped around
   *  whatever menu/action this module's own "+" opens (P128 §2.4/§2.6). */
  newTab?: Component;
}

export type ModeRegistry<M extends string> = Record<M, ModeDef>;
