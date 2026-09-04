<script setup lang="ts">
// P1 D6/C9: Git mode's left panel — deliberately minimal. Unlike Studio's connection tree or
// Http's collections tree, there is nothing this app itself tracks across repositories yet
// (repo.list's own P1 answer is always empty, bridge/git.go's own doc comment on why) —
// git-ui's own App.vue is where repository picking, the graph and everything else actually
// live, mounted inside the tab's own content area (GitGraphView.vue), not this panel. This
// stays `empty` unconditionally until a later phase gives the panel something real to show
// (a recent-repositories list, say).
import { openGitGraphTab } from '../state/tabs';
import EmptyState from '../theme/primitives/EmptyState.vue';
import LeftPanel from '../workbench/panels/LeftPanel.vue';
</script>

<template>
  <LeftPanel :empty="true">
    <template #title>
      <span>Git</span>
    </template>
    <template #empty>
      <EmptyState icon="git-branch" label="No repository open">
        <button type="button" class="p-dlgbtn" data-testid="open-repository-panel" @click="openGitGraphTab">
          Open repository
        </button>
      </EmptyState>
    </template>
  </LeftPanel>
</template>
