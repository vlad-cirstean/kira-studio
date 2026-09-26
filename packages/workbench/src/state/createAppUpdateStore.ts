import { useMutation, useQuery } from '@tanstack/vue-query';
import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';
import type { AppUpdateStatus } from '../bridge/createCoreControl';
import { queryClient } from './queryClient';

// P119: hoisted from Kira Studio's own state/appUpdate.ts (the poll) and rebuilt onto
// createAppMetricsStore.ts's own factory shape, plus install/cancel and the dialog's own
// auto-open/dismiss rules — Kira Space's own copy of this file is the same call, `'Kira Space'`.

export interface AppUpdateControl {
  updateStatus(): Promise<AppUpdateStatus>;
  updateInstall(): Promise<void>;
  updateCancelInstall(): Promise<void>;
}

// appMetrics.ts's own shape, pull instead of push: Go decides cadence (an hourly poll here is a
// ceiling, not the real interval — UpdateService.Status's own cache floor decides whether any
// given call actually reaches the network).
const POLL_MS = 60 * 60 * 1000; // hourly

export function createAppUpdateStore(control: AppUpdateControl, appName: string) {
  return defineStore('appUpdate', () => {
    // Off until initAppUpdate() flips it (main.ts, after app.mount) — an update check gains
    // nothing from blocking first paint, and starting the query eagerly would fetch before then.
    const enabled = ref(false);

    const statusQuery = useQuery(
      {
        queryKey: ['appUpdate'],
        queryFn: control.updateStatus,
        refetchInterval: POLL_MS,
        // Today's setInterval poll ran regardless of window focus — kept, not tightened.
        refetchIntervalInBackground: true,
        enabled,
      },
      queryClient,
    );

    // A failed poll keeps the previous data and renders nothing — P66's "failure is silence" holds
    // (TanStack Query's own default: an error never clears `data`).
    const available = computed(() => statusQuery.data.value?.updateAvailable ?? false);
    const currentVersion = computed(() => statusQuery.data.value?.currentVersion ?? '');
    const latestVersion = computed(() => statusQuery.data.value?.latestVersion ?? '');
    const installLogPath = computed(() => statusQuery.data.value?.installLogPath ?? '');

    // Shared by every window of this app (same origin) — VueUse syncs it across windows via the
    // `storage` event, so **Later** in one window silences the dialog in every other one too.
    const dismissedVersion = useLocalStorage('kira.appUpdate.dismissedVersion', '');

    const dialogOpen = ref(false);
    const installError = ref<string | null>(null);

    const installMutation = useMutation(
      { mutationKey: ['appUpdate', 'install'], mutationFn: control.updateInstall },
      queryClient,
    );
    const installing = computed(() => installMutation.isPending.value);

    // Net: the dialog auto-opens once per new version, across all windows; **Later** silences that
    // version until a newer one appears. Skipped while installing — the dialog stays open through
    // its own installing state even if another window's poll lands in between.
    watch([available, latestVersion, dismissedVersion], ([isAvailable, latest, dismissed]) => {
      if (installing.value) return;
      if (isAvailable && latest !== dismissed) {
        dialogOpen.value = true;
      } else if (dismissed === latest) {
        dialogOpen.value = false;
      }
    });

    function initAppUpdate(): void {
      enabled.value = true;
    }

    // The status-bar item's own click — ignores dismissal, always reopens.
    function openUpdateDialog(): void {
      dialogOpen.value = true;
    }

    function later(): void {
      if (installing.value) return;
      dismissedVersion.value = latestVersion.value;
      dialogOpen.value = false;
    }

    async function install(): Promise<void> {
      installError.value = null;
      try {
        await installMutation.mutateAsync();
        // A successful InstallUpdate quits this process shortly after replying — nothing left to
        // update here; the window is going away.
      } catch (err) {
        const code = err instanceof Error ? (err as Error & { code?: string }).code : undefined;
        if (code === 'E_CANCELLED') {
          installError.value = null;
          return;
        }
        installError.value = err instanceof Error ? err.message : String(err);
      }
    }

    function cancelInstall(): void {
      void control.updateCancelInstall();
    }

    return {
      appName,
      available,
      currentVersion,
      latestVersion,
      installLogPath,
      dialogOpen,
      installing,
      installError,
      initAppUpdate,
      openUpdateDialog,
      later,
      install,
      cancelInstall,
    };
  });
}

export type AppUpdateStore = ReturnType<ReturnType<typeof createAppUpdateStore>>;
