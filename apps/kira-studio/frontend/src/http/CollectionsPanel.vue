<script setup lang="ts">
import { openHttpRequestTab } from '../state/tabs';
import EmptyState from '../theme/primitives/EmptyState.vue';
import IconButton from '../theme/primitives/IconButton.vue';
import LeftPanel from '../workbench/panels/LeftPanel.vue';

// P1 C6: Http's own left-panel content, mounted through the same LeftPanel shell Studio's
// ProjectPanel.vue uses (D3/D6) — proof the seam works, not a stub of a feature. `empty` is
// always true: collections themselves don't land until P4, so there is genuinely no tree here
// yet (AGENTS.md: "scope left out of a phase is left out entirely") — D13 gives the panel header
// a New request action anyway, exactly where ProjectPanel.vue puts Add connection.
</script>

<template>
  <LeftPanel empty>
    <template #title>
      <span>Collections</span>
    </template>
    <template #actions>
      <IconButton
        icon="add"
        aria-label="New request"
        v-tooltip="'New request'"
        data-testid="new-request"
        @click="openHttpRequestTab"
      />
    </template>
    <template #empty>
      <EmptyState icon="globe" label="Collections arrive in a later phase">
        <button type="button" class="p-dlgbtn primary" data-testid="new-request-empty" @click="openHttpRequestTab">
          New request
        </button>
      </EmptyState>
    </template>
  </LeftPanel>
</template>
