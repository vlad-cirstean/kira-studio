<script setup lang="ts">
/**
 * G-UX (item 13): "if app is off, show this in the panels as well" — before this, a dropped
 * connection to Kira Studio was visible only in the extension's own status bar
 * (`extension.ts`'s `updateStatusBar`, the sole consumer of `ConnectionManager.onStateChange`); a
 * panel that was already open kept rendering its last-known data with nothing telling the user it
 * had gone stale. `BridgeClient.hostConnection` is the live signal this reads — seeded from the
 * bootstrap island for a panel opened while already disconnected, then kept current by the
 * `connection.changed` event (see that class's own doc comment for the two-arm reasoning).
 *
 * Mounted unconditionally, above every other panel state — `App.vue`'s own boot-error branches
 * included, and `ReviewView.vue`'s own boot-error `v-if`/`v-else-if` chain — because a live
 * disconnect can happen regardless of which of those states the rest of the panel is currently
 * showing, and each of them fully replaces the panel's own content, which would otherwise hide
 * this exactly when it matters most.
 *
 * `role="status"`, not `role="alert"` — `ConflictBanner.vue`'s own reasoning applies here too:
 * this can stay on screen for a real outage's whole duration, and `alert` would re-announce
 * itself indefinitely rather than announcing once on appearance.
 */
import { computed, onUnmounted, ref, watch } from 'vue';
import type { HostConnectionState } from '../bridge/client.ts';

const props = defineProps<{
  state: HostConnectionState | undefined;
}>();

/** `connecting` covers both "first dial, socket not up yet" and every ordinary reconnect backoff
 *  step (`connection.ts`'s own 500ms-8s ladder) — showing a banner on every one of those would
 *  flash distractingly for a drop that resolves within a second or two. A short grace period
 *  before the banner appears for `connecting` specifically; every other kind (`pairing`/`denied`/
 *  `versionMismatch`) shows immediately, since none of those self-heal on their own the way a
 *  reconnect does. */
const GRACE_MS = 2000;

let graceTimer: ReturnType<typeof setTimeout> | undefined;
const graceElapsed = ref(false);

function clearGraceTimer(): void {
  if (graceTimer !== undefined) {
    clearTimeout(graceTimer);
    graceTimer = undefined;
  }
}

watch(
  () => props.state?.kind,
  (kind) => {
    clearGraceTimer();
    graceElapsed.value = false;
    if (kind === 'connecting') {
      graceTimer = setTimeout(() => {
        graceElapsed.value = true;
      }, GRACE_MS);
    }
  },
  { immediate: true },
);

onUnmounted(clearGraceTimer);

const visible = computed(() => {
  const kind = props.state?.kind;
  if (kind === undefined || kind === 'connected') return false;
  if (kind === 'connecting') return graceElapsed.value;
  return true;
});

/** Reuses `App.vue`'s own established "Kira Studio isn't reachable — …" wording (its `bootError`
 *  banners) for `connecting`/`denied`/`versionMismatch` — the three states this class's own
 *  `ConnectionState` shares the same underlying fact with (no live socket). `pairing` gets its
 *  own wording (`updateStatusBar`'s own "Waiting for approval…" text) since it is not a failure at
 *  all, just a step the user has not finished yet. */
const title = computed(() => {
  if (props.state?.kind === 'pairing') return "Waiting for approval in Kira Studio's window";
  return "Kira Studio isn't reachable";
});

const detail = computed(() => props.state?.detail);
</script>

<template>
  <div v-if="visible" class="kv-connection-banner" role="status" data-testid="connection-banner">
    <span
      class="codicon codicon-debug-disconnect kv-connection-banner-icon"
      aria-hidden="true"
    ></span>
    <span class="kv-connection-banner-title">{{ title }}</span>
    <span v-if="detail" class="kv-connection-banner-detail">{{ detail }}</span>
  </div>
</template>

<style>
.kv-connection-banner {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  padding: var(--kv-s-2) var(--kv-s-4);
  background-color: var(--kv-panel-bg);
  border-bottom: 1px solid var(--kv-panel-border);
}

.kv-connection-banner-icon {
  color: var(--kv-diff-deleted-fg);
}

.kv-connection-banner-title {
  font-weight: 600;
}

.kv-connection-banner-detail {
  color: var(--kv-description-fg);
  font-size: 0.9em;
}
</style>
