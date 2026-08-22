<script setup lang="ts">
import Codicon from '../theme/Codicon.vue';
import { connectConnection } from '../project/state/connections';
import { loadTabData } from './state/data';
import { pathTailName, type Tab } from './state/tabs';

// §8.4 restored-tab placeholder (D15): a tab that survived relaunch renders this centred button and
// nothing else — and fires zero ops — until the user presses it. Failure at that point renders the
// normal error state with the server's message.

const props = defineProps<{ tab: Tab }>();

const label = pathTailName(props.tab.path);

async function reconnect(): Promise<void> {
  await connectConnection(props.tab.connectionId);
  await loadTabData(props.tab.id);
}
</script>

<template>
  <div class="reconnect" data-testid="reconnect-prompt">
    <Codicon name="plug" :size="28" />
    <p class="muted">{{ label }}</p>
    <button type="button" class="reconnect-button" data-testid="reconnect-load" @click="reconnect">
      Reconnect &amp; load
    </button>
  </div>
</template>

<style scoped>
.reconnect {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: var(--kira-fg-muted);
}

.muted {
  color: var(--kira-fg-disabled);
  font-size: 12px;
}

.reconnect-button {
  padding: 6px 16px;
  border-radius: var(--kira-radius);
  border: var(--kira-border-width) solid var(--kira-accent);
  background: var(--kira-accent);
  color: var(--kira-accent-fg);
  font-size: 13px;
  cursor: pointer;
}

.reconnect-button:hover {
  filter: brightness(1.1);
}
</style>
