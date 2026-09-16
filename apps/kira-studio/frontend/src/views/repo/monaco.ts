// C5 §9.1/§9.3: the sole contact point with `monaco-editor` for the repo workspace's own
// URI/model-cache machinery. P60a §2.1/D2 moved the engine-generic bootstrap (`loadMonaco`,
// `MonacoModule`, the theme definition) into `editor/monaco.ts`, shared by every editor surface in
// the app — re-exported here unchanged so this file's own consumers (RepoFileView.vue,
// RepoDiffView.vue, navigation.ts) need no edit.
export { loadMonaco, type MonacoModule, REPO_THEME_NAME } from '../../editor/monaco';

import type { MonacoModule } from '../../editor/monaco';

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

// P74 §7.3: a repo-file tab pinned to a revision (`repoFileTabStateSchema.rev`) — keyed by `rev`
// exactly as repoRevisionDiffUris keys its own two sides below, so a historical read of `path`
// never collides with the live worktree model already cached at repoFileUri's own URI.
export function repoRevisionFileUri(
  mod: MonacoModule,
  repoId: string,
  path: string,
  rev: string,
): string {
  return mod.Uri.from({
    scheme: 'kira-repo',
    authority: repoId,
    path: `/${path}`,
    query: `rev=${rev}`,
  }).toString();
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

// P78 §1.4: the new kira-repo ITextModelService's own reverse mapping — repoLocationOf above reads
// an already-created model's own WeakMap entry; this reads straight off the Uri Monaco's own
// peek/hover machinery hands the service before any model for it exists. A query string (a
// revision pin, a diff side) is rejected exactly like repoLocations already excludes the diff's
// own HEAD side (C6 D7) and a revision-pinned tab (P76 §2) — neither is byte-identical to what the
// index parsed.
export function repoLocationFromUri(
  uri: import('monaco-editor').Uri,
): { repoId: string; path: string } | undefined {
  if (uri.scheme !== 'kira-repo' || uri.query !== '') return undefined;
  return { repoId: uri.authority, path: uri.path.slice(1) };
}

export function getOrCreateModel(
  mod: MonacoModule,
  uri: string,
  text: string,
  language: string,
  location?: { repoId: string; path: string },
): import('monaco-editor').editor.ITextModel {
  const existing = modelCache.get(uri);
  if (existing && !existing.isDisposed()) {
    // P79 review fix (Functional, MEDIUM): a cache hit used to hand back whatever content the
    // model already held, silently ignoring the fresh text the caller just read — harmless before
    // P78 (a model only ever existed while a tab owned it, so any open always meant a fresh model),
    // but a tab-less preview model (textModels.ts) can now outlive an external change (a `git
    // pull`) with nothing to invalidate it: opening the file as a real tab afterward would read the
    // new bytes from disk and then get the stale preview-era model back. setValue only touches the
    // model when content actually differs, so the common case (nothing changed) is a cheap compare.
    if (existing.getValue() !== text) existing.setValue(text);
    return existing;
  }
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
