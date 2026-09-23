<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertTitle } from '@theme/components/ui/alert';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { registerCommand } from '@workbench/shortcuts/commands';
import { registerTabRuntimeCleanup } from '@workbench/state/tabRuntime';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { gitRepoIdFor } from '../../repo/git/hostHandlers';
import { useSettingsStore } from '../../state/settings';
// C5 §12: the real Monaco mount — lands together with monaco.ts's lazy init (S10's own note: no
// separate stand-in file view ever ships in between).
import type { RepoFileTabRecord } from '../../state/tabDomain';
import { useTabsStore } from '../../state/tabs';
import { repoIdOfWorkspace, type WorkspaceKey } from '../../state/workspace';
import { registerEditor, unmountEditor } from './editors';
import { loadFileContent } from './fileContent';
import { monacoLanguageFor } from './language';
import { renderMarkdownReading } from './markdownReading';
import {
  getOrCreateModel,
  KIRA_EDITOR_THEME,
  loadMonaco,
  overflowWidgetsContainer,
  repoFileUri,
  repoRevisionFileUri,
} from './monaco';
import { consumeReveal } from './reveal';
import { useInlineBlame } from './useInlineBlame';

type StandaloneEditor = import('monaco-editor').editor.IStandaloneCodeEditor;

// 7e (P68 review): D11's own comment claims the reading view is "re-rendered at most once" since
// the source never changes underneath it — true only within one mount. A mere tab switch away and
// back destroys and remounts this component (MainView's own v-if, same as every other tab view),
// which used to re-issue the IPC file read and re-run markdown-it plus a full DOM rebuild every
// time. Cached by tab id, module-level so it survives the remount; invalidated by
// registerTabRuntimeCleanup below, the same per-tab-close hook browse/state.ts and keyvalue/state.ts
// already use for their own runtime maps.
//
// Group 4 (P69 review): keyed on tab id ALONE used to go stale whenever the underlying file
// changed between mounts of the same tab (a `git pull`, a branch checkout, an external edit —
// routine since P67e made the git surface write-capable) — `mount()` re-reads the file from disk
// on every remount, so Source would show fresh bytes while Reading kept showing stale rendered
// HTML. Each entry now also carries the exact `fileText` it was rendered from, so a changed
// `content` naturally misses the cache instead of matching on tab id alone.
const markdownHtmlByTabId = new Map<string, { content: string; html: string }>();
registerTabRuntimeCleanup((tabId) => {
  markdownHtmlByTabId.delete(tabId);
});

const props = defineProps<{ tab: RepoFileTabRecord }>();
const tabsStore = useTabsStore();
const settingsStore = useSettingsStore();

type ViewState = 'loading' | 'found' | 'binary' | 'tooLarge' | 'missing' | 'error';
const state = ref<ViewState>('loading');
const errorMessage = ref('');
const container = ref<HTMLElement | null>(null);
const readingPane = ref<HTMLElement | null>(null);
let editorInstance: StandaloneEditor | null = null;

// D11: only true `markdown` (§2.3's `.md`/`.markdown`/`.mdown`/… — never `.mdx`, which colors as
// its own Monaco language) grows a toolbar at all; every other file type stays byte-identical to
// before this phase. D12: opens on Source, like every other file type — a reading view is opt-in,
// restored per tab from `markdownReading`.
const isMarkdown = computed(() => monacoLanguageFor(props.tab.path) === 'markdown');
const view = ref<'source' | 'reading'>(props.tab.state.markdownReading ? 'reading' : 'source');
const fileText = ref('');
const renderedHtml = ref<string | null>(null);
const VIEW_OPTIONS = [
  { value: 'source' as const, label: 'Source', testid: 'repo-file-view-source' },
  { value: 'reading' as const, label: 'Reading', testid: 'repo-file-view-reading' },
];

// D11: rendered lazily on first switch to Reading, then cached — a markdown file opened and never
// toggled never pays `markdown-it`'s import cost, and a plain read-only view is re-rendered at most
// once per tab, not once per mount (7e, P68 review: markdownHtmlByTabId above survives a tab
// switch-away-and-back, since the source text never changes underneath it either way).
async function ensureMarkdownRendered(): Promise<void> {
  if (renderedHtml.value !== null || !fileText.value) return;
  const cached = markdownHtmlByTabId.get(props.tab.id);
  if (cached !== undefined && cached.content === fileText.value) {
    renderedHtml.value = cached.html;
    return;
  }
  const html = await renderMarkdownReading(fileText.value);
  markdownHtmlByTabId.set(props.tab.id, { content: fileText.value, html });
  renderedHtml.value = html;
}

function onViewChange(next: 'source' | 'reading'): void {
  view.value = next;
  tabsStore.patchRepoFileTabState(props.tab.id, { markdownReading: next === 'reading' });
  if (next === 'reading') {
    void ensureMarkdownRendered();
  } else {
    // `automaticLayout: true` re-measures off a ResizeObserver, which does fire when `v-show`
    // brings the container back from `display: none` — this is a deliberate belt-and-braces call,
    // never observed to be necessary, cheap enough to always make on the one action that toggles it.
    editorInstance?.layout();
  }
}

// D13: every anchor click is neutralised — there is no back button in this webview, so an
// accidental navigation would strand the user with no way home short of a restart. A same-page
// `#anchor` link still scrolls (to a heading `renderMarkdownReading`'s own slugger id'd); anything
// else is left inert, its target already surfaced through the link's own `title` (set at render
// time), never actually opened — see the plan's own §5.4/§1.7 for why that stays out of this phase.
function onReadingClick(event: MouseEvent): void {
  const anchor = (event.target as HTMLElement).closest('a');
  if (!anchor) return;
  event.preventDefault();
  const href = anchor.getAttribute('href');
  if (!href?.startsWith('#')) return;
  const id = decodeURIComponent(href.slice(1));
  if (!id) return;
  readingPane.value?.querySelector(`#${CSS.escape(id)}`)?.scrollIntoView({ block: 'start' });
}

let disposeCursorSub: (() => void) | null = null;
let unregisterFind: (() => void) | null = null;
const inlineBlame = useInlineBlame();

// §11: every Monaco instance is readOnly/domReadOnly — neither the keyboard nor a paste can
// mutate a model. The rest of the option set mirrors §9.3 verbatim (no minimap/suggestions/
// codeLens/validation decorations — this is a viewer, not an editing surface).
async function mount(): Promise<void> {
  const repoId = props.tab.workspaceId
    ? repoIdOfWorkspace(props.tab.workspaceId as WorkspaceKey)
    : null;
  if (!repoId) {
    state.value = 'error';
    errorMessage.value = 'This tab has no repository.';
    return;
  }

  const rev = props.tab.state.rev;
  const result = await loadFileContent(repoId, props.tab.path, rev);
  if (result.kind === 'error') {
    state.value = 'error';
    errorMessage.value = result.message;
    return;
  }
  if (result.kind !== 'found') {
    state.value = result.kind;
    return;
  }
  // D11: held on a ref (not only handed to the model below) so the reading view can render it too.
  fileText.value = result.text;
  if (isMarkdown.value && view.value === 'reading') {
    void ensureMarkdownRendered();
  }

  const mod = await loadMonaco();
  // Unmounted (tab closed/switched away) while the read/import above was in flight.
  if (!container.value) return;

  const uri =
    rev === null
      ? repoFileUri(mod, repoId, props.tab.path)
      : repoRevisionFileUri(mod, repoId, props.tab.path, rev);
  const language = monacoLanguageFor(props.tab.path);
  const model = getOrCreateModel(mod, uri, result.text, language);

  const editor = mod.editor.create(container.value, {
    model,
    theme: KIRA_EDITOR_THEME,
    readOnly: true,
    domReadOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    quickSuggestions: false,
    wordBasedSuggestions: 'off',
    parameterHints: { enabled: false },
    codeLens: false,
    renderValidationDecorations: 'off',
    scrollBeyondLastLine: false,
    fontFamily: settingsStore.appearance.fontFamily,
    fontSize: settingsStore.appearance.fontSize,
    // editor/monaco.ts's own overflowWidgetsContainer doc comment: keeps the hover/find-widget a
    // DOM descendant of the shared overflow container (under document.body) rather than this tab's
    // own, possibly-clipped panel — the only widgets a read-only viewer still shows.
    fixedOverflowWidgets: true,
    overflowWidgetsDomNode: overflowWidgetsContainer(),
  });
  registerEditor(props.tab.id, uri, editor);
  editorInstance = editor;

  // P62 §4.1: attached after the editor exists, guarded on the setting and on whether this
  // window has a git record for the repository at all (`gitRepoIdFor`'s own "never guessed"
  // contract) — a silent no-op either way, never an error surface for a repo file view that has
  // always worked with no git backing. Read live (not just at mount) so toggling the setting
  // takes effect on the open tab immediately, the same live-apply `wordWrap` already gets.
  const gitRepoId = gitRepoIdFor(repoId);
  // `blame.line` always blames the working tree (contract.ts:1718) — a revision-pinned tab shows
  // different bytes, so its line numbers do not correspond.
  const blameable = gitRepoId !== undefined && rev === null;
  if (blameable && gitRepoId) {
    inlineBlame.attach({ gitRepoId, workspaceRepoId: repoId, path: props.tab.path, editor, mod });
  }

  // §9.3/§12, widened by C7 D12: a pending reveal (a search result or go-to-definition match that
  // arrived while this tab wasn't mounted) wins over the persisted revealLine — the mount-time
  // case D12's own fix doesn't change, since consumeReveal only ever has something to give when a
  // reveal request preceded this exact mount.
  const pendingReveal = consumeReveal(props.tab.id);
  if (pendingReveal) {
    if (pendingReveal.column === undefined) {
      editor.revealLineInCenter(pendingReveal.line);
      editor.setPosition({ lineNumber: pendingReveal.line, column: 1 });
    } else {
      const range = {
        startLineNumber: pendingReveal.line,
        startColumn: pendingReveal.column,
        endLineNumber: pendingReveal.line,
        endColumn: pendingReveal.endColumn ?? pendingReveal.column,
      };
      editor.setSelection(range);
      editor.revealRangeInCenter(range);
    }
  } else {
    const revealLine = props.tab.state.revealLine;
    if (revealLine !== null) {
      editor.revealLineInCenter(revealLine);
      editor.setPosition({ lineNumber: revealLine, column: 1 });
    }
  }

  // Debounced patch (patchRepoFileTabState's own skipUnchanged) — re-persists revealLine as the
  // user scrolls/navigates, so a restored session reopens roughly where it was left.
  const sub = editor.onDidChangeCursorPosition((e) => {
    tabsStore.patchRepoFileTabState(props.tab.id, { revealLine: e.position.lineNumber });
  });
  disposeCursorSub = () => sub.dispose();

  // C7 D13/§6: no second find UI — features/register.all.js already ships Monaco's own find
  // widget (case/word/regex toggles, match navigation and highlighting all included), so this
  // view's whole in-file-search deliverable is registering the app-wide `view.find` command onto
  // it, the exact lifecycle ConsoleView.vue and seven other views already use for this command id.
  unregisterFind = registerCommand('view.find', () => {
    editor.focus();
    void editor.getAction('actions.find')?.run();
  });

  state.value = 'found';
}

onMounted(() => void mount());

// A mere tab switch away (MainView's own `v-if`, every tab view in this app) — the widget
// disposes, the model (and the tabId -> uri mapping) survives in editors.ts until an actual close
// calls TAB_KINDS['repo-file'].dropResources.
onUnmounted(() => {
  disposeCursorSub?.();
  disposeCursorSub = null;
  unregisterFind?.();
  unregisterFind = null;
  inlineBlame.dispose();
  unmountEditor(props.tab.id);
  editorInstance = null;
});

// Remounting into the same tab (switching back) re-runs mount(), which reuses the cached model —
// the widget is what unmounted, not the data behind it.
</script>

<template>
  <template v-if="state === 'loading' || state === 'found'">
    <div v-if="isMarkdown" class="repo-file">
      <div class="p-toolbar last">
        <ToggleGroup
          type="single"
          :model-value="view"
          data-testid="repo-file-view-toggle"
          @update:model-value="(v) => v && onViewChange(v as 'source' | 'reading')"
        >
          <ToggleGroupItem
            v-for="opt in VIEW_OPTIONS"
            :key="opt.value"
            :value="opt.value"
            :data-testid="opt.testid"
          >
            {{ opt.label }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <!-- D11: `v-show`, never `v-if` — the editor widget must never be disposed/recreated by this
           toggle, only hidden, so scroll position/selection/find state survive a round trip. -->
      <div v-show="view === 'source'" ref="container" class="monaco-host" data-testid="repo-file-editor" />
      <!-- D11: `markdown-it`'s `html: false` (markdownReading.ts) escapes any literal HTML tag in
           the source, so this is the one `v-html` in this view that's safe. -->
      <div
        v-if="view === 'reading'"
        ref="readingPane"
        class="md-reading"
        data-testid="repo-file-markdown"
        v-html="renderedHtml"
        @click="onReadingClick"
      />
    </div>
    <div v-else ref="container" class="monaco-host" data-testid="repo-file-editor" />
  </template>
  <Alert
    v-else-if="state === 'binary'"
    class="flex-1 min-h-0 flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center"
  >
    <CodiconIcon name="file-binary" :size="24" class="text-subtle" />
    <AlertTitle class="text-kira-md font-normal text-muted">This file is binary and can't be previewed.</AlertTitle>
  </Alert>
  <Alert
    v-else-if="state === 'tooLarge'"
    class="flex-1 min-h-0 flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center"
  >
    <CodiconIcon name="warning" :size="24" class="text-subtle" />
    <AlertTitle class="text-kira-md font-normal text-muted">This file is too large to preview (over 8 MB).</AlertTitle>
  </Alert>
  <Alert
    v-else-if="state === 'missing'"
    class="flex-1 min-h-0 flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center"
  >
    <CodiconIcon name="warning" :size="24" class="text-subtle" />
    <AlertTitle class="text-kira-md font-normal text-muted">This file no longer exists.</AlertTitle>
  </Alert>
  <Alert
    v-else
    class="flex-1 min-h-0 flex-col items-center justify-center gap-1.5 border-0 bg-transparent text-center"
  >
    <CodiconIcon name="warning" :size="24" class="text-subtle" />
    <AlertTitle class="text-kira-md font-normal text-muted">{{ errorMessage || 'Could not open this file.' }}</AlertTitle>
  </Alert>
</template>

<style scoped>
@reference "@theme/base.css";

.monaco-host {
  @apply h-full w-full;
}

/* D11: column flex only when a markdown file grows the Source/Reading toolbar — every other file
   type keeps the single unwrapped .monaco-host above, byte-identical to before this phase. */
.repo-file {
  @apply flex flex-col h-full w-full;
}
.repo-file .monaco-host {
  @apply flex-1 min-h-0;
}

/* D14: every value below is an existing --kira-* token — no new literal. Tailwind's preflight
   zeroes margin/padding on `*`, font-size/font-weight on headings, and list-style on lists, so
   every block element below restates its own spacing (and headings their own scale, P73 §7); that
   is expected here, not a workaround. */
.md-reading {
  @apply flex-1 min-h-0 overflow-auto text-fg bg-bg font-ui text-kira-md leading-relaxed p-4;
}
.md-reading > :deep(*) {
  @apply max-w-[72ch];
}
.md-reading :deep(h1),
.md-reading :deep(h2),
.md-reading :deep(h3),
.md-reading :deep(h4),
.md-reading :deep(h5),
.md-reading :deep(h6) {
  @apply font-semibold leading-tight mt-4 mx-0 mb-1.5;
}
/* P73 §7(b): em, not --kira-t-xl (tokens.css: deliberately a 20px literal that ignores Appearance)
   — resolves against .md-reading's own font-size, so the scale tracks the Appearance font-size
   setting for free. Headings don't nest, so nothing compounds. */
.md-reading :deep(h1) {
  @apply border-b border-border text-[1.6em] pb-1.5;
}
.md-reading :deep(h2) {
  @apply text-[1.4em];
}
.md-reading :deep(h3) {
  @apply text-[1.2em];
}
.md-reading :deep(h4) {
  @apply text-[1.05em];
}
.md-reading :deep(h5),
.md-reading :deep(h6) {
  @apply text-[1em];
}
.md-reading :deep(p) {
  @apply mt-0 mx-0 mb-2;
}
.md-reading :deep(ul),
.md-reading :deep(ol) {
  @apply list-[revert] mt-0 mx-0 mb-2 pl-4;
}
.md-reading :deep(li) {
  @apply my-0.5 mx-0;
}
.md-reading :deep(a) {
  @apply text-info cursor-pointer;
}
.md-reading :deep(blockquote) {
  @apply border-l-4 border-border text-muted mt-0 mx-0 mb-2 py-0 px-2;
}
.md-reading :deep(hr) {
  @apply border-0 border-t border-border my-4 mx-0;
}
.md-reading :deep(code) {
  @apply bg-input rounded-kira-sm font-data text-kira-sm py-[0.1em] px-[0.35em];
}
.md-reading :deep(pre) {
  @apply overflow-auto bg-input rounded-kira-sm max-w-none mt-0 mx-0 mb-2 p-2;
}
/* P73 §7(a): more specific than :deep(code) above, so fenced code wins without touching that
   rule — a fenced block matches Monaco's own size exactly. Inline code deliberately stays at
   --kira-t-sm (the step-down exists so a same-px monospace run doesn't outsize the prose around
   it, which doesn't apply inside a standalone block). */
.md-reading :deep(pre code) {
  @apply bg-none p-0 text-kira-md;
}
.md-reading :deep(table) {
  @apply border-collapse max-w-none mt-0 mx-0 mb-2;
}
.md-reading :deep(th),
.md-reading :deep(td) {
  @apply border border-border text-left py-1 px-2;
}
.md-reading :deep(thead) {
  @apply border-b border-border;
}
.md-reading :deep(img) {
  @apply max-w-full;
}
</style>
