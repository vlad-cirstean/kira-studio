<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { computed } from 'vue';
import type { AppUpdateStore } from '../state/createAppUpdateStore';

// P119: the in-app update flow, replacing Kira Studio's own release-page banner click (§4.6's
// deliberate behavior change). ConfirmDialog.vue/GitCredentialDialog.vue's own shadcn-vue Dialog
// structure and classes; the store is a prop (StackDialog.vue's own precedent, packages/git-ui) —
// App.vue owns the v-if (`v-if="store.dialogOpen"`, mounted beside <ConfirmDialog />, the same
// mount-order-decides-stacking reason ConfirmDialog.vue's own comment gives), so this component
// only ever exists while open.
const props = defineProps<{ store: AppUpdateStore }>();

type DialogState = 'idle' | 'installing' | 'error';

const state = computed<DialogState>(() => {
  if (props.store.installing) return 'installing';
  if (props.store.installError) return 'error';
  return 'idle';
});

// Esc/overlay click while idle or in error is Later (ConfirmDialog.vue's own @update:open
// precedent); while installing, both are ignored (below) so `open` never goes false to begin with.
function onOpenChange(open: boolean): void {
  if (!open) props.store.later();
}

function onEscapeOrOutside(e: Event): void {
  if (state.value === 'installing') e.preventDefault();
}
</script>

<template>
  <Dialog :open="true" @update:open="onOpenChange">
    <DialogContent
      :show-close-button="false"
      data-testid="update-dialog"
      class="w-100"
      @escape-key-down="onEscapeOrOutside"
      @pointer-down-outside="onEscapeOrOutside"
    >
      <DialogHeader>
        <DialogTitle>{{ store.appName }} update</DialogTitle>
      </DialogHeader>

      <template v-if="state === 'installing'">
        <p class="m-0">
          Downloading and verifying {{ store.appName }} {{ store.latestVersion }}…
          {{ store.appName }} quits once the new version is ready.
        </p>
      </template>
      <template v-else>
        <p class="m-0" data-testid="update-dialog-versions">
          {{ store.appName }} {{ store.latestVersion }} is available. You have
          {{ store.currentVersion }}.
        </p>
        <p class="m-0 text-subtle">
          Updating quits {{ store.appName }}, installs the new version into /Applications, then
          reopens it. If it doesn't reopen within a few minutes, see {{ store.installLogPath }}.
        </p>
        <p v-if="state === 'error'" class="m-0 text-error" data-testid="update-dialog-error">
          {{ store.installError }} Details: {{ store.installLogPath }}.
        </p>
      </template>

      <DialogFooter
        class="items-stretch gap-2 border-t bg-field/50 -mx-4 -mb-4 rounded-b-kira-pill p-4 flex-col-reverse sm:flex-row sm:justify-end"
      >
        <template v-if="state === 'installing'">
          <Button
            variant="dialog"
            size="kira-lg"
            data-testid="update-dialog-cancel"
            @click="store.cancelInstall()"
          >
            Cancel
          </Button>
        </template>
        <template v-else>
          <Button
            variant="dialog"
            size="kira-lg"
            data-testid="update-dialog-later"
            @click="store.later()"
          >
            Later
          </Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="update-dialog-install"
            @click="store.install()"
          >
            {{ state === 'error' ? 'Try again' : 'Update' }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
