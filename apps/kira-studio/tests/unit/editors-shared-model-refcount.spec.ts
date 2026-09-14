// C14-5: openRepoCommitDiffTab/openRepoReviewDiffTab deliberately keep two tabs open for what can
// be an identical (path, left, right) revision pair, so monaco.ts's repoRevisionDiffUris (keyed by
// revision alone) hands both tabs the exact same cached model objects via getOrCreateModel.
// dropRepoDiffTab used to dispose every uri its own closing tab held, unconditionally -- closing
// the first of two such tabs disposed models the second tab was still actively displaying, leaving
// it blank or throwing. This pins that a model shared by two open tabs survives one tab closing,
// and is only actually disposed once its last referencing tab closes too -- while a uri unique to
// one tab still disposes exactly when that tab closes, same as before.
//
// No DOM/monaco-editor needed: getOrCreateModel/registerDiffEditor/dropRepoDiffTab all take the
// Monaco module or editor instance as a plain parameter rather than importing the real package, so
// a structurally-faithful fake exercises the real caching/refcounting code paths untouched.
import { describe, expect, test } from 'bun:test';
import type { MonacoModule } from '../../frontend/src/views/repo/monaco';

const { getOrCreateModel } = await import('../../frontend/src/views/repo/monaco');
const { registerDiffEditor, dropRepoDiffTab } = await import(
  '../../frontend/src/views/repo/editors'
);

interface FakeModel {
  isDisposed: () => boolean;
  dispose: () => void;
}

function fakeModel(): FakeModel {
  let disposed = false;
  return {
    isDisposed: () => disposed,
    dispose: () => {
      disposed = true;
    },
  };
}

function fakeMod(): MonacoModule {
  return {
    editor: { createModel: () => fakeModel() },
    Uri: { parse: (s: string) => s },
    // biome-ignore lint/suspicious/noExplicitAny: a minimal structural fake, not the real module
  } as any;
}

function fakeDiffEditor(): import('monaco-editor').editor.IStandaloneDiffEditor {
  // biome-ignore lint/suspicious/noExplicitAny: a minimal structural fake, not the real editor
  return { dispose: () => {} } as any;
}

describe('C14-5: a model uri shared by two open diff tabs is only disposed once both close', () => {
  test('closing the first of two tabs sharing a revision pair leaves the shared model live', () => {
    const mod = fakeMod();
    const sharedUri = 'kira-repo://repo1/a.ts?rev=abc123';
    const onlyTabAUri = 'kira-repo://repo1/a.ts?rev=abc123&side=extra-a';
    const onlyTabBUri = 'kira-repo://repo1/a.ts?rev=abc123&side=extra-b';

    // Two open tabs (a commit-diff tab and a review-diff tab, say) that both resolve to the same
    // shared uri for one side of their diff, per getOrCreateModel's own cache-hit rule.
    const sharedForA = getOrCreateModel(mod, sharedUri, 'text', 'plaintext');
    const onlyA = getOrCreateModel(mod, onlyTabAUri, 'text', 'plaintext');
    registerDiffEditor('tab-a', [sharedUri, onlyTabAUri], fakeDiffEditor());

    const sharedForB = getOrCreateModel(mod, sharedUri, 'text', 'plaintext');
    const onlyB = getOrCreateModel(mod, onlyTabBUri, 'text', 'plaintext');
    registerDiffEditor('tab-b', [sharedUri, onlyTabBUri], fakeDiffEditor());

    // Confirms the setup actually reproduces the sharing this bug depends on.
    expect(sharedForA).toBe(sharedForB);

    dropRepoDiffTab('tab-a');

    // The regression: this used to dispose sharedUri's model outright, breaking tab-b.
    expect((sharedForA as unknown as FakeModel).isDisposed()).toBe(false);
    // tab-a's own uri, unshared, disposes exactly as before.
    expect((onlyA as unknown as FakeModel).isDisposed()).toBe(true);
    // tab-b's own uri is untouched by tab-a's close.
    expect((onlyB as unknown as FakeModel).isDisposed()).toBe(false);

    // tab-b still resolves to the identical, still-live model instance -- not a fresh recreation.
    const sharedStillForB = getOrCreateModel(mod, sharedUri, 'text', 'plaintext');
    expect(sharedStillForB).toBe(sharedForB);

    dropRepoDiffTab('tab-b');

    // Now the last referencing tab is gone: the shared model is finally disposed.
    expect((sharedForA as unknown as FakeModel).isDisposed()).toBe(true);
    expect((onlyB as unknown as FakeModel).isDisposed()).toBe(true);
  });
});
