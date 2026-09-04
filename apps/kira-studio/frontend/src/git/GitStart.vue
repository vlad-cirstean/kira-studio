<script setup lang="ts">
// D13's own first-run shape, StudioStart.vue/HttpStart.vue verbatim: mark, title, one line of
// copy, one p-dlgbtn primary button. Opening the tab is all this file does — git-ui's own
// NoRepositoryPanel handles picking and opening a repository once the tab (and its GitGraphView)
// exists, the same "the UI decides, the host only opens a channel" split repo.ts's own doc
// comment states.
import { openGitGraphTab } from '../state/tabs';
import CodiconIcon from '../theme/CodiconIcon.vue';
</script>

<template>
  <div class="start" data-testid="git-start">
    <div class="start-inner">
      <span class="start-mark dim"><CodiconIcon name="git-branch" :size="32" /></span>
      <div class="start-title">No repository open</div>
      <div class="start-sub muted">Open a git repository to see its history here.</div>
      <div class="start-actions">
        <button
          type="button"
          class="p-dlgbtn primary"
          data-testid="open-repository-start"
          @click="openGitGraphTab"
        >
          <span class="icon-box"><CodiconIcon name="folder-opened" :size="13" /></span>
          Open repository
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.start {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--kira-s-6);
}

.start-inner {
  width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: var(--kira-s-4);
}

.start-title {
  font-size: var(--kira-t-xl);
  color: var(--kira-fg);
  letter-spacing: -0.01em;
}

.start-sub {
  font-size: var(--kira-t-md);
  line-height: 1.5;
}

.start-actions {
  display: flex;
  gap: var(--kira-s-2);
  align-items: center;
}
</style>
