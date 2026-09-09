<script setup lang="ts">
/**
 * §6.2's repo picker — the toolbar's leftmost item. Closes a real P3 gap: P3's UI could only
 * open a repo already in persisted state, so both host e2e specs had to smuggle a `KIRA_REPO`
 * environment variable in. This calls `repo.list` for candidates (`repo.open` on selection) and
 * is the *only* way to switch repositories (G-UX D4): the workspace's own folders are the sole
 * source, so there is no folder-picking affordance here at all.
 *
 * Emits `repo-opened` rather than performing the reset itself: switching repos resets
 * `GraphViewState`, clears selection, and persists the new `repoId`, and W11's `App.vue` is what
 * wires that — this component only ever knows about `RepoState` (mirrors `SelectionState`'s own
 * documented decoupling from `GraphViewState` in W5).
 */
import type { RepoCandidate } from '@kira/git-ipc';
import { KuiButton, KuiPopoverPanel } from '@kira/kira-ui';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { STATE_ICONS } from '../icons/index.ts';
import type { RepoState } from '../state/repo.ts';
import { shortRepoLabel } from './repoLabel.ts';

const props = defineProps<{ repoState: RepoState }>();
const emit = defineEmits<(event: 'repo-opened', repoId: string) => void>();

const isOpen = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const triggerLabel = computed(() => {
  const repo = props.repoState.activeRepo.value;
  return repo ? shortRepoLabel(repo.root) : 'Open a repository';
});

function isActive(candidate: RepoCandidate): boolean {
  return props.repoState.activeRepo.value?.root === candidate.path;
}

async function toggle(): Promise<void> {
  if (isOpen.value) {
    isOpen.value = false;
    return;
  }
  isOpen.value = true;
  await props.repoState.refreshList();
}

function close(): void {
  isOpen.value = false;
}

async function selectCandidate(candidate: RepoCandidate): Promise<void> {
  close();
  const result = await props.repoState.open(candidate.path);
  if (result.kind === 'ok') emit('repo-opened', result.repo.repoId);
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!isOpen.value) return;
  if (rootEl.value && event.target instanceof Node && rootEl.value.contains(event.target)) return;
  close();
}

watch(isOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onDocumentPointerDown);
  else document.removeEventListener('pointerdown', onDocumentPointerDown);
});

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown);
});
</script>

<template>
  <div ref="rootEl" class="kv-repo-picker" @keydown.escape="close">
    <KuiButton
      class="kv-repo-trigger"
      :icon="STATE_ICONS.repo"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      v-kui-tooltip="repoState.activeRepo.value?.root ?? 'Open a repository'"
      @click="toggle"
    >
      <span class="kv-repo-trigger-label">{{ triggerLabel }}</span>
      <span class="codicon" :class="STATE_ICONS.chevronDown" aria-hidden="true"></span>
    </KuiButton>
    <KuiPopoverPanel v-if="isOpen" anchor="left" :width="260" @close="close">
    <ul class="kv-repo-list" role="listbox" aria-label="Repositories">
      <li
        v-for="candidate in repoState.candidates.value"
        :key="candidate.path"
        role="option"
        tabindex="0"
        class="kv-repo-item"
        :aria-selected="isActive(candidate)"
        @click="selectCandidate(candidate)"
        @keydown.enter="selectCandidate(candidate)"
        @keydown.space.prevent="selectCandidate(candidate)"
      >
        <span
          class="codicon kv-repo-item-check"
          :class="STATE_ICONS.check"
          aria-hidden="true"
          :style="{ visibility: isActive(candidate) ? 'visible' : 'hidden' }"
        ></span>
        <span class="kv-repo-item-label">{{ candidate.label }}</span>
      </li>
      <li v-if="repoState.candidates.value.length === 0" class="kv-repo-empty" aria-disabled="true">
        No repositories found
      </li>
    </ul>
    </KuiPopoverPanel>
  </div>
</template>

<style>
.kv-repo-picker {
  position: relative;
}

.kv-repo-trigger {
  max-width: 220px;
}

.kv-repo-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* G20 D5: positioning/chrome move onto KuiPopoverPanel's own `.kui-popover`. */
.kv-repo-list {
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
  padding: var(--kv-space-1) 0;
  list-style: none;
}

.kv-repo-item {
  display: flex;
  align-items: center;
  gap: var(--kv-space-2);
  padding: var(--kv-space-1) var(--kv-space-3);
  cursor: pointer;
}

.kv-repo-item:hover,
.kv-repo-item:focus-visible {
  background-color: var(--kv-row-hover-bg);
  outline: none;
}

.kv-repo-item-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-repo-empty {
  padding: var(--kv-space-1) var(--kv-space-3);
  color: var(--kv-description-fg);
}
</style>
