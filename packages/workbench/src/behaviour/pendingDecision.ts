import { useIntervalFn } from '@vueuse/core';
import type { ComponentPublicInstance } from 'vue';
import { computed, nextTick, ref, useTemplateRef, watch } from 'vue';

export interface PendingDecisionSource {
  pendingId: () => string | null | undefined;
  expiresAtMs: () => number | undefined;
}

// P113 F5: extracted from GitPairingDialog.vue / DbMcpApprovalDialog.vue's identical countdown
// ticker plus focus-Deny-on-open watch. Keys on the request id, not a `pending !== null` boolean
// — P108 Part 12 F2's fix for DbMcpApprovalDialog, generalized here so GitPairingDialog picks up
// the same fix: a boolean source never re-fires when the queue advances from request A straight
// to request B (no null in between), so Deny focus and the countdown reset silently stayed on A.
//
// Owns the "denyButton" template ref itself (useTemplateRef works from inside a composable, same
// as a plain script-setup call, as long as it runs during the owning component's own setup) rather
// than returning a ref for the caller to bind — the caller's script would otherwise hold a
// destructured ref used only from its <template>, which this repo's linter cannot see and flags as
// unused. Both call sites already have a matching `ref="denyButton"` on their Deny button.
export function usePendingDecision(source: PendingDecisionSource) {
  const denyButton = useTemplateRef<ComponentPublicInstance>('denyButton');
  const now = ref(Date.now());

  // Perf: the owning dialog is always-mounted at its app's root (never unmounted per request), so
  // a plain onMounted interval would tick for the app's entire lifetime even while the dialog
  // itself renders nothing. useIntervalFn's own pause()/resume() (immediate: false) starts/stops
  // instead as the request id flips present/absent.
  const { pause: pauseTick, resume: resumeTick } = useIntervalFn(
    () => {
      now.value = Date.now();
    },
    1000,
    { immediate: false },
  );

  watch(
    () => source.pendingId() ?? null,
    (id) => {
      if (id) {
        now.value = Date.now();
        resumeTick();
        // Deny is the default focus — a trust/approval prompt whose Enter key grants access or
        // runs a statement is the wrong default.
        void nextTick(() => denyButton.value?.$el?.focus());
      } else {
        pauseTick();
      }
    },
    { immediate: true },
  );

  const remainingSeconds = computed(() => {
    const expires = source.expiresAtMs();
    if (expires === undefined) return 0;
    return Math.max(0, Math.ceil((expires - now.value) / 1000));
  });

  return { denyButton, remainingSeconds };
}
