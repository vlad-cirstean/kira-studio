// P60a §2.1/D2 (Kira Studio's own editor/monaco.ts): the engine-generic half of what
// `views/repo/monaco.ts` (C5/C6) built — `loadMonaco`/`MonacoModule`/the theme definition.
//
// P103 Part 1: `monacoEntry.ts`/`monacoTheme.ts` (and the monarch grammars beneath them) — this
// file's own header used to record why they were duplicated rather than shared (no package
// boundary between the two frontends existed yet) — hoisted to `@workbench/editor/*`. This file's
// own dynamic imports below point there now. `MonacoModule`/`KIRA_EDITOR_THEME` moved with
// `monacoTheme.ts` — re-exported here unchanged so `views/repo/monaco.ts` and every other consumer
// in this app keeps importing them from here. `cssVar` moved too but had no consumer outside
// monacoTheme.ts itself in either app, so it isn't re-exported here.
export type { MonacoModule } from '@workbench/editor/monacoTheme';
export { KIRA_EDITOR_THEME } from '@workbench/editor/monacoTheme';

import type { MonacoModule } from '@workbench/editor/monacoTheme';

// D2 (from format.ts's own precedent): memoised so only the first editor surface in a session ever
// pays the import cost — a session that opens neither an editor nor a repo file never downloads
// this chunk at all.
let monacoModule: Promise<MonacoModule> | undefined;

// D7's own "one worker" guard: label 'editorWorkerService' gets the real worker (it backs
// IEditorWorkerService — the diff editor widget computes its diff there); anything else throws
// loudly at first use rather than silently shipping a second worker, in case a future import ever
// pulls a language service back in.
function wireWorker(mod: MonacoModule): void {
  self.MonacoEnvironment = {
    getWorker(_moduleId: string, label: string): Worker {
      if (label === 'editorWorkerService') return new mod.EditorWorker();
      throw new Error(`kira: unexpected Monaco worker label ${label}`);
    },
  };
}

// P60a §4.4/dogfooding: `fixedOverflowWidgets: true` alone does NOT reparent a hover/suggest
// widget to `document.body` — verified against the pinned 0.56.0's own `view.js` (`appendChild`
// under `this.domNode`, i.e. the editor's own root, whenever no `overflowWidgetsDomNode` is given).
// `position: fixed` still escapes an ancestor's `overflow: hidden` *visually*, but a widget stays a
// literal DOM descendant of `MonacoHost`'s own root — which the api-ui-consistency spec's own
// `el.closest('.request-pane') === null` (etc.) checks require to be false. One body-level
// container, shared by every `MonacoHost` instance (matching how VS Code itself wires this), is
// what actually reparents — created lazily, once, memoised the same way `loadMonaco()` is.
let overflowContainer: HTMLElement | undefined;

/** The one shared `overflowWidgetsDomNode` every `MonacoHost.vue` instance passes — every hover/
 *  suggest widget from every editor on the page ends up here, under `document.body`, regardless of
 *  which pane created it. */
export function overflowWidgetsContainer(): HTMLElement {
  if (!overflowContainer) {
    overflowContainer = document.createElement('div');
    // D5 (P67c §3.1): every `--vscode-*` custom property Monaco defines is scoped to
    // `.monaco-editor, .monaco-diff-editor, .monaco-component` (standaloneThemeService.js's own
    // `_registerRegularEditorContainer`) — a plain `document.body` child carries none of them, so a
    // widget reparented here (suggest/hover/parameter-hints) lost its whole palette: transparent
    // background, unstyled text. Upstream's own convention is to put `monaco-editor` on exactly the
    // node handed to `overflowWidgetsDomNode`
    // (`multiDiffEditorWidgetImpl.js`'s `h('div.monaco-editor@overflowWidgetsDomNode', {})`), so this
    // does the same rather than inventing a fourth scope. The app-owned class stays first for
    // `MonacoHost.vue`'s own `:global(.kira-editor-overflow-widgets …)` rules, which key off it, not
    // `monaco-editor`.
    overflowContainer.className = 'kira-editor-overflow-widgets monaco-editor';
    document.body.appendChild(overflowContainer);
  }
  return overflowContainer;
}

/** Loads monaco-editor's chunk exactly once, wires the worker and defines the theme on first
 *  load — every subsequent call reuses the same resolved module. */
export function loadMonaco(): Promise<MonacoModule> {
  if (!monacoModule) {
    monacoModule = import('@workbench/editor/monacoEntry')
      .then(async (mod) => {
        wireWorker(mod);
        const { defineKiraTheme } = await import('@workbench/editor/monacoTheme');
        defineKiraTheme(mod);
        return mod;
      })
      .catch((err) => {
        // A rejected memoised promise would otherwise stay rejected for the rest of the page's
        // life — every MonacoHost that mounts afterwards awaits the same broken promise forever,
        // stuck on its own pending state with no way to recover short of a full reload. Forgetting
        // it here means the *next* call retries the import fresh instead.
        monacoModule = undefined;
        throw err;
      });
  }
  return monacoModule;
}
