import type { Component } from 'vue';

// P1 D6/C6: mode content comes from a registry, mirroring D4's tab-kind registry — hoisted here at
// P128 §2.3 so both apps' own module registries (each app's own `workbench/modes.ts`) share one
// shape instead of two hand-kept-identical ones. `newTab` is optional: a module with nothing to
// open (Studio's own Studio/Api modules) simply leaves the tab strip's own "+" slot empty
// (WorkbenchShellBase's own #new-tab), rather than every shell branching on
// `modeStore.active === '<id>'` to decide whether to show one (P128 §0's own "per-module branches"
// resolution).
//
// P129 Part 3 §0.12: a discriminated union, not one shape with an optional `layout` — a module
// that fills the whole content area (Kira Space's own `ade`) has no panel/start/newTab at all, so a
// single interface would leave those three either wrongly required or wrongly optional for every
// module. `PanelModeDef` is the only variant Kira Studio's own `MODES` can hold today (its
// `ModeRegistry<AppMode, PanelModeDef>` below says so at the type level); `FullModeDef` stays
// unexported since nothing outside this file needs to name it directly — a module picks it by
// setting `layout: 'full'` and reading `ModeDef`/`ModeRegistry`'s own default second parameter.
export interface PanelModeDef {
  label: string;
  icon: string;
  layout?: 'panel';
  /** Mounted in the left-panel slot (WorkbenchShell.vue) — a whole self-contained panel that wraps
   *  PanelShell itself, the same way ProjectPanel.vue already does (D6). */
  panel: Component;
  /** MainView.vue's fallback when this mode has no active tab. */
  start: Component;
  /** The tab strip's own "+" for this mode, when it has one — TabStripNewButton.vue wrapped around
   *  whatever menu/action this module's own "+" opens (P128 §2.4/§2.6). */
  newTab?: Component;
  /** `false` hides the tab strip row for a module with no tabs of its own (Docker). */
  tabStrip?: false;
}

/** A module that owns the whole content area itself — no left panel, no tab strip, no tabs of its
 *  own (§0.13's `tabStripVisible`/`project-visible` gating on the shell side is what actually hides
 *  those rows; this variant just has nothing to hand them). Kira Space's own `ade` mode (P129 Part
 *  3) is the first of these. */
interface FullModeDef {
  label: string;
  icon: string;
  layout: 'full';
  /** Rendered in the shell's own `#main` slot in place of the tab-scoped `MainView`. */
  view: Component;
}

export type ModeDef = PanelModeDef | FullModeDef;

export type ModeRegistry<M extends string, D extends ModeDef = ModeDef> = Record<M, D>;
