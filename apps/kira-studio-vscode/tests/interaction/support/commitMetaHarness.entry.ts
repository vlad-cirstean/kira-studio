/**
 * G19 §4.2/D4: a standalone mount for the commit-detail pane's own geometry — built and served
 * independently of the full graph-panel bootstrap (`App.vue`, SlickGrid, the layout worker),
 * which this one geometry assertion has no need to drive end to end. No transport, no bridge, no
 * fake RPC — a hand-built `CommitDetail` (message-clamp geometry) is all `DetailPane.vue` needs
 * to render.
 *
 * G-UX D7 (item 7): mounts the real `DetailPane.vue` now, not a bare `CommitMeta.vue` —
 * `commit-meta-clamp.spec.ts`'s new cases need the whole subject/tree/details composition (the
 * trailer-hidden-while-collapsed case reads both the message section's clamp and the details
 * section's absence of SHA/parent markup; the detail-pane-proportion case measures the real
 * `.kv-detail-pane-tree` against `.kv-detail-pane`, D7's own 80% target). `detailState` is a
 * plain object satisfying exactly the shape `DetailPane.vue` reads from `DetailState` — not the
 * real class, which needs a `BridgeClient` this harness has no use for (no request ever fires;
 * `detail`/`sha` are set directly, once, before mount).
 */
import { CommitStore } from '@kira/git-core';
import { createApp, h, reactive } from 'vue';
// A relative import straight into packages/git-ui's own source — this harness is built by its
// own small Vite step (commitMetaHarnessServer.ts), not the shared packages/git-ui/vite.config.ts
// bundle, so it reaches the component the same way any other file in this monorepo would.
import DetailPaneVue from '../../../../../packages/git-ui/src/components/DetailPane.vue';

const PARAGRAPH =
  'This paragraph exists only to overflow a two-line clamp reliably regardless of viewport ' +
  'width or font metrics, so the test above it never has to guess how many words make two ' +
  'lines in whatever font this harness happens to render with today.';

const LONG_BODY = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}. ${PARAGRAPH}`).join(
  '\n\n',
);

// G-UX D7 (item 7): trailers + a distinct author (author !== committer) — commit-meta-clamp.spec.ts's
// new "trailer-hidden-while-collapsed" case asserts both are absent from the DOM while collapsed
// and present, inside .kv-meta-expanded, after "Show more". A parent sha is included too, so the
// "SHA/parent markup is gone entirely" assertion is checking against a fixture that would have
// shown a Parent row under the pre-D7 shape, not one that never had anything to show in the first
// place.
const detail = {
  sha: '2'.repeat(40),
  parents: ['3'.repeat(40)],
  author: { name: 'Fake Author', email: 'fake@example.com', timestamp: 1_700_000_000 },
  committer: { name: 'Fake Committer', email: 'committer@example.com', timestamp: 1_700_000_500 },
  subject: 'A commit with a long message body',
  body: LONG_BODY,
  trailers: [
    { token: 'Co-authored-by', value: 'Jane Coauthor <jane@example.com>' },
    { token: 'Signed-off-by', value: 'Fake Author <fake@example.com>' },
  ],
  signature: { status: 'N' as const, signer: '' },
  decoration: [],
  parentIndex: 0,
  files: [
    {
      kind: 'modified' as const,
      path: 'src/example.ts',
      additions: 3,
      deletions: 1,
      isBinary: false,
    },
    { kind: 'added' as const, path: 'README.md', additions: 5, deletions: 0, isBinary: false },
  ],
};

const actions = {
  capabilities: { openInEditor: false, goToFile: false, clipboard: false, resolveConflict: false },
  copy(): void {},
  announce(): void {},
  async openInEditor(): Promise<void> {},
  async goToFile(): Promise<{ line: number }> {
    return { line: 1 };
  },
};

const store = new CommitStore();

// Plain object satisfying exactly the DetailState shape DetailPane.vue reads (see this file's own
// doc comment on why not the real class) — `reactive()` so DetailPane.vue's own `v-if="detail"`/
// the FileTree props below re-render if a test ever mutates one of these fields.
const detailState = reactive({
  sha: { value: detail.sha },
  parentIndex: { value: 0 },
  detail: { value: detail },
  error: { value: undefined as string | undefined },
  selectedFile: { value: -1 },
  listMode: { value: 'tree' as const },
  filter: { value: '' },
  selectFile(_index: number): void {},
  setListMode(_mode: 'tree' | 'flat'): void {},
  setFilter(_text: string): void {},
  setParentIndex(_index: number): void {},
});

const app = createApp({
  render: () => h(DetailPaneVue, { detailState: detailState as never, store, actions }),
});
app.mount('#app');
