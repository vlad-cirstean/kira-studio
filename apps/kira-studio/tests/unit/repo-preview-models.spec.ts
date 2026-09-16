// P78 §1.4/§11.2: the kira-repo ITextModelService's own preview-model registry — cache eviction
// with three interacting rules (a tab-owned uri never evicted, a 40-entry LRU cap on preview-only
// models, promotion out of the registry once a tab claims the uri), the bar's own named case for a
// dedicated test. No DOM/monaco-editor needed: createKiraTextModelService/getOrCreateModel/
// registerEditor all take the Monaco module or editor instance as a plain parameter rather than
// importing the real package (editors-shared-model-refcount.spec.ts's own precedent), so a
// structurally-faithful fake exercises the real registry code untouched.
//
// modelCache (monaco.ts) and the preview registry (textModels.ts) are both module-level singletons
// shared across every spec file bun runs in this process (restoreAfterEach.ts's own documented
// hazard class, for `control`/`data`) — every uri here is namespaced under a repo id unique to this
// file, and every test that depends on exact LRU order pads its own filler count well past
// PREVIEW_MODEL_LIMIT (40) so the result holds regardless of what an earlier test in this file (or
// this process) already left in the registry; each padding count's own margin is justified inline.
import './support/window';

import { describe, expect, test } from 'bun:test';
import type { Uri } from 'monaco-editor';
import { restoreAfterEach } from './support/restoreAfterEach';

const { control } = await import('../../frontend/src/bridge/control');
// Set before restoreAfterEach snapshots control, so every test in this file (restoreAfterEach's
// own afterEach runs between them) reverts to this stub, never to the real bridge call — which
// has no live Wails runtime to answer it in this test environment and hangs instead of rejecting.
(
  control as unknown as { codeWorkspaceReadFile: typeof control.codeWorkspaceReadFile }
).codeWorkspaceReadFile = async (_id: string, path: string) => ({
  kind: 'found' as const,
  text: `content of ${path}`,
  bytes: 0,
  limitBytes: 0,
  language: 'plaintext',
});
restoreAfterEach(control);

const { getOrCreateModel } = await import('../../frontend/src/views/repo/monaco');
const { registerEditor } = await import('../../frontend/src/views/repo/editors');
const { createKiraTextModelService } = await import('../../frontend/src/views/repo/textModels');

import type { MonacoModule } from '../../frontend/src/views/repo/monaco';

interface FakeModel {
  isDisposed: () => boolean;
  dispose: () => void;
}

function fakeMod(): MonacoModule {
  const registry = new Map<string, FakeModel>();
  return {
    editor: {
      createModel: (_text: string, _lang: string, uri: string) => {
        const key = uri;
        let disposed = false;
        const model: FakeModel = {
          isDisposed: () => disposed,
          dispose: () => {
            disposed = true;
            registry.delete(key);
          },
        };
        registry.set(key, model);
        return model;
      },
      getModel: (uri: Uri) => registry.get(uri.toString()) ?? null,
    },
    Uri: { parse: (s: string) => s },
    // biome-ignore lint/suspicious/noExplicitAny: a minimal structural fake, not the real module.
  } as any;
}

function fakeEditor(): import('monaco-editor').editor.IStandaloneCodeEditor {
  // biome-ignore lint/suspicious/noExplicitAny: a minimal structural fake, not the real editor.
  return { dispose: () => {} } as any;
}

let repoCounter = 0;
function freshRepoId(): string {
  repoCounter += 1;
  return `p78-preview-repo-${repoCounter}`;
}

function repoUri(repoId: string, path: string, query = ''): Uri {
  const uriString = `kira-repo://${repoId}/${path}${query ? `?${query}` : ''}`;
  return {
    scheme: 'kira-repo',
    authority: repoId,
    path: `/${path}`,
    query,
    toString: () => uriString,
    // biome-ignore lint/suspicious/noExplicitAny: a minimal structural fake, not the real Uri.
  } as any;
}

describe('P78 §1.4: the preview model cache', () => {
  test('a uri a tab already owns survives a full preview registry', async () => {
    const mod = fakeMod();
    const repoId = freshRepoId();
    const owned = repoUri(repoId, 'owned.ts');
    const ownedModel = getOrCreateModel(mod, owned.toString(), 'x', 'plaintext', {
      repoId,
      path: 'owned.ts',
    });
    registerEditor(`tab-${repoId}`, owned.toString(), fakeEditor());

    const svc = createKiraTextModelService(mod);
    const ref = await svc.createModelReference(owned);
    expect(ref.object.textEditorModel).toBe(ownedModel);

    // 45 comfortably exceeds PREVIEW_MODEL_LIMIT (40) regardless of whatever this shared registry
    // already held coming into this test (see this file's own header comment).
    for (let i = 0; i < 45; i++) {
      await svc.createModelReference(repoUri(repoId, `filler-${i}.ts`));
    }

    expect(mod.editor.getModel(owned)).not.toBeNull();
  });

  test('the cap evicts the least recently resolved preview first', async () => {
    const mod = fakeMod();
    const repoId = freshRepoId();
    const svc = createKiraTextModelService(mod);

    const uris: Uri[] = [];
    for (let i = 0; i < 50; i++) {
      const u = repoUri(repoId, `cap-${i}.ts`);
      uris.push(u);
      await svc.createModelReference(u);
    }

    // However many uris this shared registry already held (at most 40, its own cap), the earliest
    // of these 50 is older than all of them and is guaranteed evicted; the last is younger than
    // every other uri ever registered and is guaranteed to survive — true for any prior count in
    // [0, 40], which is this file's own header comment's argument, applied concretely here.
    expect(mod.editor.getModel(uris[0])).toBeNull();
    expect(mod.editor.getModel(uris[49])).not.toBeNull();
  });

  test('a preview promoted to a tab leaves the registry and is never evicted afterwards', async () => {
    const mod = fakeMod();
    const repoId = freshRepoId();
    const svc = createKiraTextModelService(mod);
    const promoted = repoUri(repoId, 'promoted.ts');

    await svc.createModelReference(promoted); // resolved as a preview first — the oldest so far.
    registerEditor(`tab-${repoId}`, promoted.toString(), fakeEditor()); // the tab opens it for real.

    for (let i = 0; i < 45; i++) {
      await svc.createModelReference(repoUri(repoId, `filler-${i}.ts`));
    }

    expect(mod.editor.getModel(promoted)).not.toBeNull();
  });

  test('re-resolving an existing preview refreshes its recency', async () => {
    const mod = fakeMod();
    const repoId = freshRepoId();
    const svc = createKiraTextModelService(mod);
    const early = repoUri(repoId, 'early.ts');

    await svc.createModelReference(early);
    // Twenty more, comfortably under the 40 cap on top of `early` alone, so `early` is still alive
    // (never evicted) by the time it's refreshed below regardless of this shared registry's own
    // prior state (at most 40 already-cached entries, all older than everything this test adds).
    for (let i = 0; i < 20; i++) {
      await svc.createModelReference(repoUri(repoId, `pre-${i}.ts`));
    }

    await svc.createModelReference(early); // refresh — early is now the newest entry.

    // Twenty-five more: without the refresh, early (added before the twenty "pre-" fillers) would
    // be among the oldest and get evicted; with it, it is younger than all twenty "pre-" fillers
    // and survives losing only the oldest of those instead.
    for (let i = 0; i < 25; i++) {
      await svc.createModelReference(repoUri(repoId, `post-${i}.ts`));
    }

    expect(mod.editor.getModel(early)).not.toBeNull();
  });

  test('a non-kira-repo uri and a rev-pinned uri both reject rather than fabricate a model', async () => {
    const mod = fakeMod();
    const repoId = freshRepoId();
    const svc = createKiraTextModelService(mod);

    const notKiraRepo = {
      scheme: 'file',
      authority: '',
      path: '/tmp/x.ts',
      query: '',
      toString: () => 'file:///tmp/x.ts',
      // biome-ignore lint/suspicious/noExplicitAny: a minimal structural fake, not the real Uri.
    } as any;
    await expect(svc.createModelReference(notKiraRepo)).rejects.toThrow('Model not found');

    const revPinned = repoUri(repoId, 'pinned.ts', 'rev=deadbeef');
    await expect(svc.createModelReference(revPinned)).rejects.toThrow('Model not found');
  });
});
