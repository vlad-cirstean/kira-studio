// C5 §9.1/§9.3: the lazy bootstrap this app's whole Monaco surface goes through — one worker
// wiring, one theme, one model cache. `RepoFileView.vue` (S12) is the only caller.
type MonacoModule = typeof import('./monacoEntry');

// D2 (from format.ts's own precedent): memoised so only the first repo file tab ever pays the
// import cost — every studio/api session never downloads this chunk at all.
let monacoModule: Promise<MonacoModule> | undefined;

// D7's own "one worker" guard: label 'editorWorkerService' gets the real worker (it backs
// IEditorWorkerService — C6's diff-editor widget computes its diff there); anything else throws
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
// is correct and there is only one theme to define — the plan's own "two themes, re-applied on an
// appearance change" describes a light/dark distinction this app does not have; recorded here
// rather than building a second theme and a change listener for a setting that doesn't exist.
const REPO_THEME_NAME = 'kira-repo';

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function defineTheme(mod: MonacoModule): void {
  mod.editor.defineTheme(REPO_THEME_NAME, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': cssVar('--kira-bg', '#1f1f1f'),
      'editor.foreground': cssVar('--kira-fg', '#cccccc'),
      'editorWidget.background': cssVar('--kira-bg-elevated', '#202020'),
      'editorWidget.border': cssVar('--kira-border-strong', '#313131'),
      'editor.selectionBackground': cssVar('--kira-select', '#04395e'),
      'editor.lineHighlightBackground': cssVar('--kira-hover', '#2a2d2e'),
      'editorLineNumber.foreground': cssVar('--kira-fg-muted', '#9d9d9d'),
      focusBorder: cssVar('--kira-focus', '#0078d4'),
    },
  });
}

/** Loads monaco-editor's chunk exactly once, wires the worker and defines the theme on first
 *  load — every subsequent call reuses the same resolved module. */
export function loadMonaco(): Promise<MonacoModule> {
  if (!monacoModule) {
    monacoModule = import('./monacoEntry').then((mod) => {
      wireWorker(mod);
      defineTheme(mod);
      return mod;
    });
  }
  return monacoModule;
}

export { REPO_THEME_NAME };

// §9.3: one model per open file tab, keyed by a stable `kira-repo://<repoId>/<path>` URI —
// disposed through the tab kind's existing dropResources hook (closeTab already blind-calls it for
// every registered kind), so model disposal needs no new lifecycle.
const modelCache = new Map<string, import('monaco-editor').editor.ITextModel>();

export function repoFileUri(repoId: string, path: string): string {
  return `kira-repo://${repoId}/${path}`;
}

export function getOrCreateModel(
  mod: MonacoModule,
  uri: string,
  text: string,
  language: string,
): import('monaco-editor').editor.ITextModel {
  const existing = modelCache.get(uri);
  if (existing && !existing.isDisposed()) return existing;
  const model = mod.editor.createModel(text, language, mod.Uri.parse(uri));
  modelCache.set(uri, model);
  return model;
}

export function disposeModel(uri: string): void {
  const model = modelCache.get(uri);
  if (!model) return;
  modelCache.delete(uri);
  if (!model.isDisposed()) model.dispose();
}
