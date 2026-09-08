/**
 * G19 §4.2/D4 (item 4): a standalone mount for `CommitMeta.vue`'s own message-body clamp — built
 * and served independently of the full graph-panel bootstrap (`App.vue`, SlickGrid, the layout
 * worker), which this one geometry assertion has no need to drive end to end. No transport, no
 * bridge, no fake RPC — a hand-built `CommitDetail` with a long multi-paragraph body is all
 * `CommitMeta.vue`'s `'message'` section needs to render.
 */
import { CommitStore } from '@kira/git-core';
import { createApp, h } from 'vue';
// A relative import straight into packages/git-ui's own source — this harness is built by its
// own small Vite step (commitMetaHarnessServer.ts), not the shared packages/git-ui/vite.config.ts
// bundle, so it reaches the component the same way any other file in this monorepo would.
import CommitMetaVue from '../../../../../packages/git-ui/src/components/CommitMeta.vue';

const PARAGRAPH =
  'This paragraph exists only to overflow a four-line clamp reliably regardless of viewport ' +
  'width or font metrics, so the test above it never has to guess how many words make four ' +
  'lines in whatever font this harness happens to render with today.';

const LONG_BODY = Array.from({ length: 10 }, (_, i) => `Paragraph ${i + 1}. ${PARAGRAPH}`).join(
  '\n\n',
);

const detail = {
  sha: '2'.repeat(40),
  parents: [],
  author: { name: 'Fake Author', email: 'fake@example.com', timestamp: 1_700_000_000 },
  committer: { name: 'Fake Author', email: 'fake@example.com', timestamp: 1_700_000_000 },
  subject: 'A commit with a long message body',
  body: LONG_BODY,
  trailers: [],
  signature: { status: 'N' as const, signer: '' },
  decoration: [],
  parentIndex: 0,
  files: [],
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

const app = createApp({
  render: () => h(CommitMetaVue, { detail, store, actions, section: 'message' as const }),
});
app.mount('#app');
