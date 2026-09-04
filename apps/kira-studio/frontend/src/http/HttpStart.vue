<script setup lang="ts">
import { openHttpRequestTab } from '../state/tabs';
import CodiconIcon from '../theme/CodiconIcon.vue';

// D13: the mode's front door — StudioStart.vue's own first-run shape verbatim (mark, title, one
// line of copy, one p-dlgbtn primary button), the same `http/ -> state/` edge
// CollectionsPanel.vue's own New request action uses (D7).
</script>

<template>
  <div class="start" data-testid="http-start">
    <div class="start-inner">
      <span class="start-mark dim"><CodiconIcon name="globe" :size="32" /></span>
      <div class="start-title">No request open</div>
      <div class="start-sub muted">Send an HTTP request and see its response here.</div>
      <button type="button" class="p-dlgbtn primary" data-testid="new-request-start" @click="openHttpRequestTab">
        <span class="icon-box"><CodiconIcon name="add" :size="13" /></span>
        New request
      </button>
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
</style>
