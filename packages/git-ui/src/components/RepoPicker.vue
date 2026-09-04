<script setup lang="ts">
/**
 * §6.2's repo picker — the toolbar's leftmost item. Closes a real P3 gap: P3's UI could only
 * open a repo already in persisted state, so both host e2e specs had to smuggle a `KIRA_REPO`
 * environment variable in. This calls `repo.list` for candidates and offers **Open Folder…**
 * (`repo.pick` → `repo.open`), styled as a quick-input-style dropdown (§6.1: "Dialogs borrow the
 * quick-input surface").
 *
 * Emits `repo-opened` rather than performing the reset itself: switching repos resets
 * `GraphViewState`, clears selection, and persists the new `repoId`, and W11's `App.vue` is what
 * wires that — this component only ever knows about `RepoState` (mirrors `SelectionState`'s own
 * documented decoupling from `GraphViewState` in W5).
 */
import type { RepoCandidate } from '@kira/git-ipc';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { STATE_ICONS } from '../icons/index';
import type { RepoState } from '../state/repo';
import { shortRepoLabel } from './repoLabel';

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

async function openFolder(): Promise<void> {
  close();
  const path = await props.repoState.pick();
  if (!path) return;
  const result = await props.repoState.open(path);
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
    <button
      type="button"
      class="kv-repo-trigger"
      aria-haspopup="listbox"
      :aria-expanded="isOpen"
      :title="repoState.activeRepo.value?.root ?? 'Open a repository'"
      @click="toggle"
    >
      <span class="codicon" :class="STATE_ICONS.repo" aria-hidden="true"></span>
      <span class="kv-repo-trigger-label">{{ triggerLabel }}</span>
      <span class="codicon" :class="STATE_ICONS.chevronDown" aria-hidden="true"></span>
    </button>
    <ul v-if="isOpen" class="kv-repo-list" role="listbox" aria-label="Repositories">
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
      <li class="kv-repo-separator" role="separator"></li>
      <li
        role="option"
        tabindex="0"
        class="kv-repo-item"
        aria-selected="false"
        @click="openFolder"
        @keydown.enter="openFolder"
        @keydown.space.prevent="openFolder"
      >
        <span class="codicon kv-repo-item-check" :class="STATE_ICONS.openFolder" aria-hidden="true"></span>
        <span class="kv-repo-item-label">Open Folder…</span>
      </li>
    </ul>
  </div>
</template>

<style>
.kv-repo-picker {
  position: relative;
}

.kv-repo-trigger {
  display: inline-flex;
  align-items: center;
  gap: var(--kv-space-2);
  height: 22px;
  padding: 0 var(--kv-space-2);
  border: none;
  border-radius: var(--kv-radius);
  background: transparent;
  color: var(--kv-app-fg);
  font-family: inherit;
  font-size: inherit;
  max-width: 220px;
  cursor: pointer;
}

.kv-repo-trigger:hover {
  background-color: var(--kv-row-hover-bg);
}

.kv-repo-trigger:focus-visible {
  outline: 1px solid var(--kv-focus-border);
  outline-offset: -1px;
}

.kv-repo-trigger-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv-repo-list {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  z-index: 10;
  min-width: 260px;
  max-height: 320px;
  overflow-y: auto;
  margin: 0;
  padding: var(--kv-space-1) 0;
  list-style: none;
  background-color: var(--kv-panel-bg);
  border: 1px solid var(--kv-panel-border);
  border-radius: var(--kv-radius);
  box-shadow: 0 2px 8px var(--kv-widget-shadow);
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

.kv-repo-separator {
  height: 1px;
  margin: var(--kv-space-1) 0;
  background-color: var(--kv-panel-border);
}
</style>
