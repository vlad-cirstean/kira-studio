<script setup lang="ts">
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { FieldError } from '@theme/components/ui/field';
import { t } from '@theme/i18n';
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
      size="sm"
      data-testid="update-dialog"
      @escape-key-down="onEscapeOrOutside"
      @pointer-down-outside="onEscapeOrOutside"
    >
      <DialogHeader :closable="state !== 'installing'">
        <DialogTitle>{{ t('workbench.update.dialog.title', { app: store.appName }) }}</DialogTitle>
      </DialogHeader>

      <DialogBody>
        <template v-if="state === 'installing'">
          <p class="m-0">
            {{
              t('workbench.update.installing.body', { app: store.appName, version: store.latestVersion })
            }}
          </p>
        </template>
        <template v-else>
          <p class="m-0" data-testid="update-dialog-versions">
            {{
              t('workbench.update.versions.body', { app: store.appName, latest: store.latestVersion, current: store.currentVersion })
            }}
          </p>
          <p class="m-0 text-subtle">
            {{
              t('workbench.update.explain.body', { app: store.appName, folder: '/Applications', log: store.installLogPath })
            }}
          </p>
          <FieldError v-if="state === 'error'" data-testid="update-dialog-error">
            {{ store.installError }}
            {{ t('workbench.update.installDetails.error', { log: store.installLogPath }) }}
          </FieldError>
        </template>
      </DialogBody>

      <DialogFooter>
        <template v-if="state === 'installing'">
          <Button
            variant="dialog"
            size="kira-lg"
            data-testid="update-dialog-cancel"
            @click="store.cancelInstall()"
          >
            {{ t('common.action.cancel.label') }}
          </Button>
        </template>
        <template v-else>
          <Button
            variant="dialog"
            size="kira-lg"
            data-testid="update-dialog-later"
            @click="store.later()"
          >
            {{ t('common.later.label') }}
          </Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="update-dialog-install"
            @click="store.install()"
          >
            {{
              state === 'error' ? t('common.action.retry.label') : t('workbench.update.install.label')
            }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
