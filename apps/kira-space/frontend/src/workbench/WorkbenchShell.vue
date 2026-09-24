<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { useEventListener } from '@vueuse/core';
import MainView from '@workbench/components/MainView.vue';
import TabStrip from '@workbench/components/TabStrip.vue';
import WorkbenchShellBase from '@workbench/components/WorkbenchShell.vue';
import { runCommand } from '@workbench/shortcuts/commands';
import { shortcutFor } from '@workbench/shortcuts/keys';
import { computed, ref } from 'vue';
import GitPanel from '../repo/GitPanel.vue';
import GitStart from '../repo/GitStart.vue';
import { useCodeReposStore } from '../state/coderepos';
import { useLayoutStore } from '../state/layout';
import { openRepoTerminalTab } from '../state/repoTabs';
import { GENERAL_WORKSPACE, useWorkspaceStore } from '../state/workspace';
import StatusBar from './StatusBar.vue';

// P103 Part 2 (§5.4): Kira Studio's own WorkbenchShell.vue, trimmed — this app has exactly one
// module (GitPanel.vue is the whole of this app's own left panel) and no Operations panel, so
// `#dock` is never passed to the shared shell — its grid collapses to project/splitproj/main/status
// exactly as before (the shared component's own `.has-dock`-gated rows, §5.4's own hazard note).
// Now a thin composition over the shared grid/TabStrip/MainView package components; this file
// keeps only this app's own per-app content: GitPanel, the "view.find" keydown binding, and the
// "+" (a terminal at the active repository's own root).
const layoutStore = useLayoutStore();
const workspaceStore = useWorkspaceStore();
const codeReposStore = useCodeReposStore();

// shortcuts/keys.ts's own doc comment: this app's Go menu emits no accelerator channels, so every
// shortcut binds through a local keydown here, regardless of the shared SHORTCUTS table's `global`
// flag. 'view.find' is the one id kira-space actually has a registered handler for.
useEventListener(window, 'keydown', (e: KeyboardEvent) => {
  const id = shortcutFor(e, ['view.find']);
  if (!id) return;
  e.preventDefault();
  runCommand(id);
});

// The "+" opens a terminal at the active repository's own root — hidden when no repository is
// open yet, since a GENERAL_WORKSPACE terminal has no workspace of its own to scope a strip to.
const showNewTab = computed(() => workspaceStore.active !== GENERAL_WORKSPACE);
const newTabBtn = ref<HTMLButtonElement | null>(null);

function onNewTab(): void {
  const btn = newTabBtn.value;
  const repoId = workspaceStore.active;
  if (!btn || repoId === GENERAL_WORKSPACE) return;
  // Not the pinned repo-graph tab's own `path` — that field holds the workspace key (== repoId),
  // not a filesystem path. The repo's real root lives on its own codeRepoRecord.
  const record = codeReposStore.records.find((r) => r.id === repoId);
  if (!record) return;
  openRepoTerminalTab(repoId, record.root);
}
</script>

<template>
  <WorkbenchShellBase
    :project-visible="layoutStore.panel.project.visible"
    :project-width="layoutStore.panel.project.width"
    @resize-project="layoutStore.setProjectWidth"
  >
    <template #panel>
      <GitPanel />
    </template>
    <template #tab-strip>
      <TabStrip>
        <template #new-tab>
          <div
            v-if="showNewTab"
            class="h-full flex items-center shrink-0 pt-0.5 pr-1 pl-0.5"
            data-testid="tab-strip-actions"
          >
            <Tooltip>
              <TooltipTrigger as-child>
                <button
                  ref="newTabBtn"
                  type="button"
                  class="flex items-center justify-center size-5.5 bg-transparent border-0 cursor-pointer rounded-kira-sm text-muted-foreground hover:bg-hover hover:text-fg"
                  aria-label="New terminal"
                  data-testid="tab-strip-new"
                  @click="onNewTab"
                >
                  <CodiconIcon name="add" :size="13" />
                </button>
              </TooltipTrigger>
              <TooltipContent>New terminal at repository root</TooltipContent>
            </Tooltip>
          </div>
        </template>
      </TabStrip>
    </template>
    <template #main>
      <MainView>
        <template #empty>
          <GitStart />
        </template>
      </MainView>
    </template>
    <template #status>
      <StatusBar />
    </template>
  </WorkbenchShellBase>
</template>
