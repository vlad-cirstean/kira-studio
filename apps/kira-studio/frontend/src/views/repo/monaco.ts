// C5 §9.1/§9.3: the lazy bootstrap this app's whole Monaco surface goes through — one worker
// wiring, one theme, one model cache. RepoFileView.vue/RepoDiffView.vue (C6 §8.1) call loadMonaco;
// navigation.ts (C6 §8.2) is the other consumer of the resolved module type.
export type MonacoModule = typeof import('./monacoEntry');

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
function expandHexShorthand(color: string): string {
  const m = /^#([0-9a-fA-F]{3,4})$/.exec(color);
  if (!m) return color;
  return `#${m[1]
    .split('')
    .map((c) => c + c)
    .join('')}`;
}

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return expandHexShorthand(value || fallback);
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

// §9.3/C6 D6: one model per open file tab, keyed by a stable `kira-repo://<repoId>/<path>` URI —
// disposed through the tab kind's existing dropResources hook (closeTab already blind-calls it for
// every registered kind), so model disposal needs no new lifecycle.
const modelCache = new Map<string, import('monaco-editor').editor.ITextModel>();

// C6 D6: built with `Uri.from`, not string interpolation — the editor opener (navigation.ts) has
// to recover (repoId, path) from a Uri the *other* direction, and a path containing a space, '#',
// '?' or '%' does not survive a plain template-literal round trip. `Uri.from` escapes correctly
// and `uri.authority`/`uri.path` give the decoded values straight back.
export function repoFileUriObject(
  mod: MonacoModule,
  repoId: string,
  path: string,
): import('monaco-editor').Uri {
  return mod.Uri.from({ scheme: 'kira-repo', authority: repoId, path: `/${path}` });
}

export function repoFileUri(mod: MonacoModule, repoId: string, path: string): string {
  return repoFileUriObject(mod, repoId, path).toString();
}

// C6 §8.3: the diff editor's own two sides share one scheme with the file viewer (so navigation's
// one selector covers both) but need distinct model identities — `query` tells them apart without
// a second scheme.
export function repoDiffUris(
  mod: MonacoModule,
  repoId: string,
  path: string,
): { head: import('monaco-editor').Uri; worktree: import('monaco-editor').Uri } {
  return {
    head: mod.Uri.from({
      scheme: 'kira-repo',
      authority: repoId,
      path: `/${path}`,
      query: 'side=head',
    }),
    worktree: mod.Uri.from({
      scheme: 'kira-repo',
      authority: repoId,
      path: `/${path}`,
      query: 'side=worktree',
    }),
  };
}

// C10 §6.1: a commit diff's own two sides — keyed by revision, not by "head"/"worktree", since two
// different commits' diffs of the same path must never collide on one cached model (getOrCreateModel
// returns whatever is already cached at a URI, ignoring the text it was just handed on a cache
// hit). `left`/`right` are the tab's own revision-pair fields (repoDiffTabStateSchema, S8) —
// already the exact strings a commit sha, or (for a root commit) the well-known empty-tree sha.
export function repoRevisionDiffUris(
  mod: MonacoModule,
  repoId: string,
  path: string,
  left: string,
  right: string,
): { left: import('monaco-editor').Uri; right: import('monaco-editor').Uri } {
  return {
    left: mod.Uri.from({
      scheme: 'kira-repo',
      authority: repoId,
      path: `/${path}`,
      query: `rev=${left}`,
    }),
    right: mod.Uri.from({
      scheme: 'kira-repo',
      authority: repoId,
      path: `/${path}`,
      query: `rev=${right}`,
    }),
  };
}

// C6 D7: navigability is a WeakMap keyed by the model object, not a URI-shape check — the diff
// editor's HEAD side is deliberately never recorded here (its content is a different revision than
// the index describes, so answering a definition there would be a lie); the diff's worktree side
// and every plain file-tab model are, since both are byte-identical to what the index parsed.
const repoLocations = new WeakMap<
  import('monaco-editor').editor.ITextModel,
  { repoId: string; path: string }
>();

export function repoLocationOf(
  model: import('monaco-editor').editor.ITextModel,
): { repoId: string; path: string } | undefined {
  return repoLocations.get(model);
}

export function getOrCreateModel(
  mod: MonacoModule,
  uri: string,
  text: string,
  language: string,
  location?: { repoId: string; path: string },
): import('monaco-editor').editor.ITextModel {
  const existing = modelCache.get(uri);
  if (existing && !existing.isDisposed()) return existing;
  const model = mod.editor.createModel(text, language, mod.Uri.parse(uri));
  modelCache.set(uri, model);
  if (location) repoLocations.set(model, location);
  return model;
}

export function disposeModel(uri: string): void {
  const model = modelCache.get(uri);
  if (!model) return;
  modelCache.delete(uri);
  if (!model.isDisposed()) model.dispose();
}
