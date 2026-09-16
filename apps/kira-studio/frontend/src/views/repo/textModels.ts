// P78 §1.4: a `kira-repo`-aware `ITextModelService`, installed once at Monaco bootstrap
// (editor/monaco.ts's loadMonaco, via monacoEntry.ts's StandaloneServices re-export). Standalone
// Monaco's own StandaloneTextModelService rejects any uri with no already-created model ("Model
// not found") — measured (§1.3) as the reason a cross-file go-to-definition target's link
// underline and hover preview never rendered: goToDefinitionAtPosition.js's single-result branch
// reaches addDecoration only through a resolved createModelReference, and a cross-file target has
// no open tab, so no model, so the promise rejects and the decoration is never painted. The click
// itself already worked (Monaco's editor opener needs no model at all), which is why this read as
// "modifier-click does nothing" rather than "no underline."
//
// Reuses monaco.ts's own getOrCreateModel — the one cache keyed by uri string — rather than a
// second model-creation path, so a preview model created here and a tab opened on the same file
// later are the identical model object, never a stale second copy.
import type { Uri } from 'monaco-editor';
import { control } from '../../bridge/control';
import { isTabOwnedUri } from './editors';
import { monacoLanguageFor } from './language';
import type { MonacoModule } from './monaco';
import { disposeModel, getOrCreateModel, repoLocationFromUri } from './monaco';

type ITextModel = import('monaco-editor').editor.ITextModel;
type ModelReference = { object: { textEditorModel: ITextModel }; dispose(): void };

// §1.4's own eviction cap: a preview model is created with no owning tab, so nothing else ever
// disposes it — left unbounded this is a leak across a session's worth of hover/peek previews.
const PREVIEW_MODEL_LIMIT = 40;

// Insertion order doubles as recency: touching a key deletes then re-adds it, moving it to the
// newest end of iteration order, so the least-recently-resolved key is always whatever
// `previewUris.keys().next()` yields. Value is unused (a Set would do, but a Map's delete-then-set
// re-order idiom is the same either way and this reads slightly clearer at the call sites below).
const previewUris = new Map<string, true>();

// P79 review fix (Functional, MEDIUM): `createModelReference`'s returned `dispose()` used to be a
// pure no-op — nothing refcounted a live holder, so `registerPreview`'s eviction could dispose a
// model a still-open peek/references list (find-references, implementations) was still displaying
// mid-browse, since `isTabOwnedUri` only ever protected a *tab*-owned uri. Keyed the same as
// `previewUris`; a uri with no entry here has zero live holders.
const liveRefCounts = new Map<string, number>();

function retainLive(uri: string): void {
  liveRefCounts.set(uri, (liveRefCounts.get(uri) ?? 0) + 1);
}

function releaseLive(uri: string): void {
  const count = liveRefCounts.get(uri) ?? 0;
  if (count <= 1) liveRefCounts.delete(uri);
  else liveRefCounts.set(uri, count - 1);
}

function isLiveReferenced(uri: string): boolean {
  return (liveRefCounts.get(uri) ?? 0) > 0;
}

function touchPreview(uri: string): void {
  previewUris.delete(uri);
  previewUris.set(uri, true);
}

// Rule 2 (cap) plus rule 3's own eviction-time half of "promoted out, never evicted": the entry
// picked as oldest might already be tab-owned (a promotion this registry hasn't been told about
// since nothing calls back on tab-open, §1.4) — dropped from the registry either way, but only
// actually disposed when it still isn't.
//
// P79 review fix: scans oldest-first for the first entry that is safe to act on at all — a live-
// referenced entry (isLiveReferenced) is skipped over entirely (left exactly where it sits in
// recency order, reconsidered on the next call) rather than evicted, so the cap can be briefly
// exceeded while a peek list is open rather than disposing a model still on screen.
function registerPreview(uri: string): void {
  touchPreview(uri);
  if (previewUris.size <= PREVIEW_MODEL_LIMIT) return;
  for (const oldest of previewUris.keys()) {
    if (isLiveReferenced(oldest)) continue;
    previewUris.delete(oldest);
    if (!isTabOwnedUri(oldest)) disposeModel(oldest);
    return;
  }
}

/** A `ModelReference` whose `dispose()` actually decrements `liveRefCounts` exactly once, however
 *  many times it's called — Monaco's own callers (`goToDefinitionAtPosition.js`,
 *  `referencesWidget.js`) treat a resolved reference's `dispose()` as idempotent. */
function referenceTo(model: ITextModel, key: string): ModelReference {
  retainLive(key);
  let released = false;
  return {
    object: { textEditorModel: model },
    dispose(): void {
      if (released) return;
      released = true;
      releaseLive(key);
    },
  };
}

/** The service object itself — a plain object, not a class, since `StandaloneServices.initialize`
 *  only ever calls `createModelReference` on it (checked against the pinned 0.56.0's own callers:
 *  goToDefinitionAtPosition.js, referencesWidget.js, referencesModel.js — none call anything else
 *  on `ITextModelService`). Exported standalone (rather than only through installKiraTextModelService
 *  below) so §11.2's unit tests can exercise it directly with a fake MonacoModule. */
export function createKiraTextModelService(mod: MonacoModule): {
  createModelReference(uri: Uri): Promise<ModelReference>;
} {
  return {
    async createModelReference(uri: Uri): Promise<ModelReference> {
      const key = uri.toString();
      // Rule 3: a tab may have opened this exact uri since it was last resolved as a preview —
      // lazily purged here (the promotion itself has no callback into this registry) rather than
      // left to look, incorrectly, like a candidate for eviction later.
      if (isTabOwnedUri(key)) previewUris.delete(key);

      const existing = mod.editor.getModel(uri);
      if (existing) {
        if (previewUris.has(key)) touchPreview(key); // rule 2: re-resolving refreshes recency.
        return referenceTo(existing, key);
      }

      // Stock StandaloneTextModelService's own failure mode (resolverService.js), reproduced
      // verbatim for anything outside this app's own scheme, or revision-pinned/diff-sided (never
      // navigable — C6 D7, P76 §2): no silent empty model, ever.
      if (uri.scheme !== 'kira-repo') throw new Error('Model not found');
      const loc = repoLocationFromUri(uri);
      if (!loc) throw new Error('Model not found');

      const content = await control.codeWorkspaceReadFile(loc.repoId, loc.path);
      if (content.kind !== 'found') throw new Error('Model not found');

      // Registered with `loc` exactly as a real tab mount would (RepoFileView.vue's own mount()),
      // so navigation resolves from inside a peek preview too, not only from an open tab.
      const model = getOrCreateModel(mod, key, content.text, monacoLanguageFor(loc.path), loc);
      registerPreview(key);
      return referenceTo(model, key);
    },
  };
}

/** Called once from editor/monaco.ts's loadMonaco(), before any editor.create — see this module's
 *  own header comment for why the timing matters. */
export function installKiraTextModelService(mod: MonacoModule): void {
  mod.StandaloneServices.initialize({ textModelService: createKiraTextModelService(mod) });
}
