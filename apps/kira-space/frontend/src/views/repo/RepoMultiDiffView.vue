<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
// P104 §3.4: EmptyState's ui/alert rewrite is a genuinely separate, non-mechanical piece of work --
// not attempted in this pass, same deferral as OperationsPanel.vue's own.
import EmptyState from '@theme/primitives/EmptyState.vue';
import { type ComponentPublicInstance, nextTick, onUnmounted, type Ref, reactive, ref } from 'vue';
// P92 item 5/§7.3: one commit's whole changed-file set, one tab — VS Code's own multi-file diff
// editor's counterpart. A scrolling column of per-file sections; each section's own diff editor
// mounts only while that section is expanded, so a 60-file commit constructs at most a few live
// Monaco instances rather than sixty at once. First section expanded on mount, the rest collapsed.
//
// Each section reuses RepoDiffView.vue's own loading path verbatim (useDiffEditor.ts), keyed
// `${tabId}:${path}` — editors.ts's own composite-key convention for this tab kind
// (dropRepoMultiDiffTab's own doc comment) — rather than a second copy of that five-state
// classification (CLAUDE.md's "one term per concept").
//
// A section's `useDiffEditor` handle (and the container element it mounts into) deliberately live
// in plain Maps, not inside the `sections` reactive array: a DiffEditorHandle carries its own Refs
// (`state`/`errorMessage`), and `reactive()`'s deep unwrap would strip that Ref-ness from a nested
// property, breaking DiffEditorHandle's own type. Only the two plain per-path fields the template
// actually reads — `expanded`, and each section's own copied-out state/error strings — need to be
// reactive.
import type { RepoMultiDiffTabRecord } from '../../state/tabDomain';
import { repoIdOfWorkspace, type WorkspaceKey } from '../../state/workspace';
import { useDiffEditor } from './useDiffEditor';

const props = defineProps<{ tab: RepoMultiDiffTabRecord }>();

type SectionState = 'loading' | 'found' | 'binary' | 'tooLarge' | 'bothMissing' | 'error';

interface SectionMeta {
  path: string;
  expanded: boolean;
}

const repoId = props.tab.workspaceId
  ? repoIdOfWorkspace(props.tab.workspaceId as WorkspaceKey)
  : null;

// Plan §7.3: first section expanded on mount, the rest collapsed.
const sections = reactive<SectionMeta[]>(
  props.tab.state.files.map((path, index) => ({ path, expanded: index === 0 })),
);

const sectionState = reactive<Record<string, SectionState>>(
  Object.fromEntries(props.tab.state.files.map((path) => [path, 'loading'])),
);
const sectionError = reactive<Record<string, string>>({});

const containers = new Map<string, Ref<HTMLElement | null>>();
function containerRef(path: string): Ref<HTMLElement | null> {
  let r = containers.get(path);
  if (!r) {
    r = ref(null);
    containers.set(path, r);
  }
  return r;
}

const diffEditors = new Map<string, ReturnType<typeof useDiffEditor>>();

function setContainer(path: string, el: Element | ComponentPublicInstance | null): void {
  const target = containerRef(path);
  target.value = el instanceof HTMLElement ? el : null;
  const meta = sections.find((s) => s.path === path);
  if (meta?.expanded && target.value && !diffEditors.has(path)) void mountSection(path);
}

async function mountSection(path: string): Promise<void> {
  if (!repoId || diffEditors.has(path)) return;
  await nextTick();
  const meta = sections.find((s) => s.path === path);
  if (!meta?.expanded || !containerRef(path).value) return; // Collapsed again before the DOM caught up.
  const handle = useDiffEditor(containerRef(path), {
    editorKey: `${props.tab.id}:${path}`,
    repoId,
    path,
    left: props.tab.state.left,
    right: props.tab.state.right,
    review: props.tab.state.review !== null,
  });
  diffEditors.set(path, handle);
  await handle.mount();
  sectionState[path] = handle.state.value;
  sectionError[path] = handle.errorMessage.value;
}

// Collapsing a section disposes its editor widget only — the models it loaded stay cached in
// editors.ts (RepoDiffView.vue's own onUnmounted comment: "the models survive ... until an actual
// close calls dropResources"), so re-expanding the same section is cheap.
function disposeSection(path: string): void {
  diffEditors.get(path)?.dispose();
  diffEditors.delete(path);
  sectionState[path] = 'loading';
}

function toggle(meta: SectionMeta): void {
  meta.expanded = !meta.expanded;
  if (meta.expanded) {
    // Else: setContainer's own ref callback mounts it once Vue renders the now-expanded template.
    if (containerRef(meta.path).value) void mountSection(meta.path);
  } else {
    disposeSection(meta.path);
  }
}

function goToFile(path: string): void {
  diffEditors.get(path)?.goToFile();
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

onUnmounted(() => {
  for (const meta of sections) disposeSection(meta.path);
});
</script>

<template>
  <div v-if="!repoId" class="repo-multi-diff-root">
    <EmptyState icon="warning" label="This tab has no repository." />
  </div>
  <div v-else class="repo-multi-diff-root" data-testid="repo-multi-diff-view">
    <div v-for="section in sections" :key="section.path" class="section">
      <div class="section-header">
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="repo-multi-diff-toggle"
              @click="toggle(section)"
            >
              <CodiconIcon :name="section.expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ section.expanded ? 'Collapse' : 'Expand' }}</TooltipContent>
        </Tooltip>
        <span class="path" :title="section.path">{{ basename(section.path) }}</span>
        <span class="path-dir" :title="section.path">{{ section.path }}</span>
        <Button
          v-if="section.expanded && sectionState[section.path] === 'found'"
          variant="toolbar"
          size="kira"
          data-testid="repo-multi-diff-go-to-file"
          @click="goToFile(section.path)"
        >
          <CodiconIcon name="go-to-file" :size="13" />
          Go to file
        </Button>
      </div>
      <template v-if="section.expanded">
        <div
          v-if="sectionState[section.path] === 'loading' || sectionState[section.path] === 'found'"
          :ref="(el) => setContainer(section.path, el)"
          class="monaco-host"
          data-testid="repo-multi-diff-editor"
        />
        <EmptyState
          v-else-if="sectionState[section.path] === 'binary'"
          icon="file-binary"
          label="This file is binary and can't be compared."
        />
        <EmptyState
          v-else-if="sectionState[section.path] === 'tooLarge'"
          icon="warning"
          label="This file is too large to compare (over 8 MB)."
        />
        <EmptyState
          v-else-if="sectionState[section.path] === 'bothMissing'"
          icon="warning"
          label="This file no longer exists."
        />
        <EmptyState
          v-else
          icon="warning"
          :label="sectionError[section.path] || 'Could not open this diff.'"
        />
      </template>
    </div>
    <EmptyState v-if="sections.length === 0" icon="git-compare" label="No changed files." />
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.repo-multi-diff-root {
  @apply h-full overflow-y-auto flex flex-col;
}

.section {
  @apply flex flex-none flex-col border-b border-border;
}

.section-header {
  @apply flex flex-none items-center gap-1 py-1 px-1.5;
}

.path {
  @apply font-semibold overflow-hidden text-ellipsis whitespace-nowrap;
}

.path-dir {
  @apply flex-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted text-kira-sm;
}

.monaco-host {
  @apply flex-none h-[60vh] w-full;
}
</style>
