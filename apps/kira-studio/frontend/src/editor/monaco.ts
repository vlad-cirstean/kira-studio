// P60a §2.1/D2: the engine-generic half of what `views/repo/monaco.ts` (C5/C6) built —
// `loadMonaco`/`MonacoModule`/the theme definition — moved here so every editor surface in the app
// (not only the repo workspace) shares the one memoised bootstrap. `views/repo/monaco.ts` re-exports
// everything below unchanged, so RepoFileView.vue/RepoDiffView.vue/navigation.ts need no edit.
export type MonacoModule = typeof import('../views/repo/monacoEntry');

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

// §9.3: read once from getComputedStyle against tokens.css — this app has one fixed (dark) visual
// design with no light/dark toggle today (its own tokens.css literally maps each value to VS
// Code's own theme keys, e.g. "--kira-bg: #1f1f1f; /* editor.background */"), so `base: 'vs-dark'`
// is correct and there is only one theme to define.
export const KIRA_EDITOR_THEME = 'kira-editor';
// P60a §2.1: kept as an alias for one phase — every repo-view import site still spells the old
// name; P60b drops this.
export const REPO_THEME_NAME = KIRA_EDITOR_THEME;

// C6 dogfooding finding (§13.5's own live-verification pass, real WebKit — the engine the packaged
// app's WKWebView actually embeds, matching playwright.config.ts's own choice of `webkit` for
// UI-fidelity projects): WebKit's `getComputedStyle` canonicalises a custom property's own color
// value to its shortest hex form — tokens.css's `--kira-fg: #cccccc` comes back as `#ccc` — and
// Monaco's `defineTheme` validates every color strictly, throwing on the 3-digit shorthand
// ("Illegal value for token color: #ccc") and aborting `loadMonaco()` entirely, silently: no error
// surface, no editor, just an empty container (not merely a missing worker, C5's own described
// failure mode). Chromium does not canonicalise the same property, which is why this went
// unnoticed until a real WebKit run. Expanding a 3/4-digit shorthand to its 6/8-digit form here is
// the fix — Monaco's own validator accepts either as long as it's full-length.
export function expandHexShorthand(color: string): string {
  const m = /^#([0-9a-fA-F]{3,4})$/.exec(color);
  if (!m) return color;
  return `#${m[1]
    .split('')
    .map((c) => c + c)
    .join('')}`;
}

export function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return expandHexShorthand(value || fallback);
}

/** Loads monaco-editor's chunk exactly once, wires the worker and defines the theme on first
 *  load — every subsequent call reuses the same resolved module. */
export function loadMonaco(): Promise<MonacoModule> {
  if (!monacoModule) {
    monacoModule = import('../views/repo/monacoEntry').then(async (mod) => {
      wireWorker(mod);
      const { defineKiraTheme } = await import('./monacoTheme');
      defineKiraTheme(mod);
      return mod;
    });
  }
  return monacoModule;
}
