<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import FiltersDialog from '../../project/FiltersDialog.vue';
import ProjectTree from '../../project/ProjectTree.vue';
import SchemaDialog from '../../project/SchemaDialog.vue';
import { treeState } from '../../project/state/tree';
import {
  codeReposState,
  importRepoViaDialog,
  removeCodeRepo,
  renameCodeRepo,
} from '../../state/coderepos';
import { connectionsState, openCreateDialog } from '../../state/connections';
import { openContextMenu } from '../../state/contextMenu';
import { schemaDialogState } from '../../state/schemas';
import { openRepoWorkspace } from '../../state/workspace';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import AppButton from '../../theme/primitives/AppButton.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import PanelShell from '../../theme/primitives/PanelShell.vue';
import TextField from '../../theme/primitives/TextField.vue';

// C5 §3.4: a parallel list, collapsible, hidden entirely when empty — never folded into the
// connection tree (D1). Single click selects; double click, or the Open menu item, opens the
// workspace (the tree's own select/open split, unchanged).
const reposCollapsed = ref(false);
const selectedRepoId = ref<string | null>(null);
const importError = ref<string | null>(null);

// §3.4: "The panel search filters repo names by substring alongside the tree's own filtering" —
// the same treeState.search box, read here too rather than a second search field.
const filteredRepos = computed(() => {
  const query = treeState.search.trim().toLowerCase();
  if (!query) return codeReposState.records;
  return codeReposState.records.filter((r) => r.name.toLowerCase().includes(query));
});

async function onImport(): Promise<void> {
  importError.value = null;
  try {
    await importRepoViaDialog();
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err);
  }
}

function onSelectRepo(id: string): void {
  selectedRepoId.value = id;
}

function onOpenRepo(id: string): void {
  openRepoWorkspace(id);
}

// Electron's renderer has no window.prompt() — the same in-app substitute
// ConsoleSavedMenu.vue/FilterHistoryMenu.vue already use.
const textPrompt = ref<{
  title: string;
  value: string;
  resolve: (v: string | null) => void;
} | null>(null);
const promptInput = ref<{ $el: HTMLElement } | null>(null);
function promptText(title: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    textPrompt.value = { title, value: initial, resolve };
    void nextTick(() => promptInput.value?.$el.querySelector('input')?.focus());
  });
}
function submitPrompt(): void {
  if (!textPrompt.value) return;
  const { value, resolve } = textPrompt.value;
  textPrompt.value = null;
  resolve(value);
}
function cancelPrompt(): void {
  if (!textPrompt.value) return;
  const { resolve } = textPrompt.value;
  textPrompt.value = null;
  resolve(null);
}

async function onRenameRepo(id: string, currentName: string): Promise<void> {
  const name = await promptText('Rename repository', currentName);
  if (!name || name.trim() === '') return;
  await renameCodeRepo(id, name.trim());
}

async function onRemoveRepo(id: string): Promise<void> {
  await removeCodeRepo(id);
  if (selectedRepoId.value === id) selectedRepoId.value = null;
}

function onRepoContextMenu(e: MouseEvent, id: string, name: string, root: string): void {
  onSelectRepo(id);
  openContextMenu(e, [
    { type: 'item', id: 'open', label: 'Open', icon: 'folder-opened', run: () => onOpenRepo(id) },
    {
      type: 'item',
      id: 'rename',
      label: 'Rename…',
      icon: 'edit',
      run: () => onRenameRepo(id, name),
    },
    {
      type: 'item',
      id: 'copy-path',
      label: 'Copy path',
      icon: 'copy',
      run: () => void navigator.clipboard.writeText(root),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'remove',
      label: 'Remove',
      icon: 'trash',
      danger: true,
      run: () => onRemoveRepo(id),
    },
  ]);
}
</script>

<template>
  <PanelShell
    :search="treeState.search"
    :empty="connectionsState.records.length === 0 && codeReposState.records.length === 0"
    @update:search="treeState.search = $event"
  >
    <template #title>
      <span>Connections</span>
    </template>
    <template #actions>
      <!-- P28 D18: the DataGrip import moved to the menu bar (App → Import DataGrip
           Connections…). It is a once-per-machine action and did not earn a permanent slot in a
           four-button header. StudioStart.vue's own first-run button stays: an empty state is
           exactly when a menu-bar-only affordance is hardest to find. -->
      <IconButton
        icon="add"
        aria-label="Add connection"
        v-tooltip="'New connection'"
        data-testid="add-connection"
        @click="openCreateDialog"
      />
      <!-- C5 §3.3/§3.4: no new dialog, no new native picker — reuses FilesService.ChooseFolder. -->
      <IconButton
        icon="repo"
        aria-label="Import repository"
        v-tooltip="'Import repository…'"
        data-testid="import-repo"
        @click="onImport"
      />
    </template>
    <template #body>
      <div
        v-if="importError"
        class="p-strip note error-note"
        data-testid="import-repo-error"
        @click="importError = null"
      >
        {{ importError }}
      </div>
      <section v-if="codeReposState.records.length > 0" class="repo-section" data-testid="repo-section">
        <button
          type="button"
          class="repo-section-header"
          data-testid="repo-section-toggle"
          @click="reposCollapsed = !reposCollapsed"
        >
          <CodiconIcon :name="reposCollapsed ? 'chevron-right' : 'chevron-down'" :size="13" />
          <span class="p-xs dim">Repositories</span>
        </button>
        <div v-if="!reposCollapsed" class="repo-list">
          <div
            v-for="repo in filteredRepos"
            :key="repo.id"
            class="repo-row"
            :class="{ selected: selectedRepoId === repo.id }"
            data-testid="repo-row"
            :data-repo-id="repo.id"
            @click="onSelectRepo(repo.id)"
            @dblclick="onOpenRepo(repo.id)"
            @contextmenu.prevent="onRepoContextMenu($event, repo.id, repo.name, repo.root)"
          >
            <CodiconIcon name="source-control" :size="13" class="repo-icon" />
            <span class="repo-name" v-tooltip="repo.root">{{ repo.name }}</span>
          </div>
        </div>
      </section>
      <ProjectTree />
    </template>
    <!-- FirstRun.html's side-empty: says what the panel is for, nothing more — the headline
         already lives on the main start page, so it is not repeated here. -->
    <template #empty>
      <span class="dim"><CodiconIcon name="database" :size="24" /></span>
      <span class="p-xs dim side-empty-text">Everything you connect to<br />shows up here.</span>
    </template>
  </PanelShell>
  <FiltersDialog />
  <SchemaDialog v-if="schemaDialogState.open" />

  <div v-if="textPrompt" class="prompt-scrim" data-testid="text-prompt" @click.stop>
    <div class="prompt-box p-float">
      <div class="prompt-title p-sm muted">{{ textPrompt.title }}</div>
      <TextField
        ref="promptInput"
        v-model="textPrompt.value"
        size="md"
        data-testid="text-prompt-input"
        @enter="submitPrompt"
        @keydown.escape="cancelPrompt"
      />
      <div class="prompt-actions">
        <AppButton kind="dialog" data-testid="text-prompt-cancel" @click="cancelPrompt">Cancel</AppButton>
        <AppButton kind="dialog" variant="primary" data-testid="text-prompt-ok" @click="submitPrompt">
          OK
        </AppButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.side-empty-text {
  line-height: 1.5;
}

.error-note {
  color: var(--kira-error);
  cursor: pointer;
}

.repo-section {
  flex-shrink: 0;
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.repo-section-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: var(--kira-s-2) var(--kira-s-3);
  background: none;
  border: none;
  cursor: pointer;
  color: var(--kira-fg-muted);
}

.repo-section-header:hover {
  background: var(--kira-hover);
}

.repo-list {
  display: flex;
  flex-direction: column;
}

.repo-row {
  height: var(--kira-row-height);
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding: 0 var(--kira-s-3) 0 var(--kira-s-6);
  cursor: default;
  user-select: none;
}

.repo-row:hover {
  background: var(--kira-hover);
}

.repo-row.selected {
  background: var(--kira-select);
}

.repo-icon {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

.repo-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.prompt-scrim {
  position: fixed;
  inset: 0;
  background: rgb(0 0 0 / 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}

.prompt-box {
  width: 280px;
  padding: var(--kira-s-4);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
}

.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--kira-s-3);
}
</style>
