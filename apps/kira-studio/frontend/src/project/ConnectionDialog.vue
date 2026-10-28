<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import { DEFAULT_PORT, FILE_KINDS } from '@shared/domain/connection';
import CodiconIcon from '@theme/CodiconIcon.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import TruncatedText from '@theme/components/TruncatedText.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { FieldDescription } from '@theme/components/ui/field';
import { Tabs } from '@theme/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { useAsyncAction } from '@workbench/behaviour/asyncAction';
import ViewToolbar from '@workbench/components/ViewToolbar.vue';
import { computed, provide, ref, watch } from 'vue';
import { control } from '../bridge/control';
import { useConnectionDialogStore, useConnectionsStore } from '../state/connections';
import EngineIcon from '../theme/EngineIcon.vue';
import ConnectionAdvancedTab from './connection/ConnectionAdvancedTab.vue';
import ConnectionEnginePicker from './connection/ConnectionEnginePicker.vue';
import ConnectionGeneralTab from './connection/ConnectionGeneralTab.vue';
import ConnectionMcpTab from './connection/ConnectionMcpTab.vue';
import ConnectionPreconnectTab from './connection/ConnectionPreconnectTab.vue';
import ConnectionPrivacyTab from './connection/ConnectionPrivacyTab.vue';
import { CONNECTION_FORM_KEY, type DetailTab, useConnectionForm } from './connection/form';
import { KIND_ACCENT_CLASS, KIND_LABEL, SUPPORTED_KINDS } from './connection/kinds';
import { CONNECTION_REVEAL_KEY, useConnectionReveal } from './connection/reveal';

const connectionsStore = useConnectionsStore();
const connectionDialogStore = useConnectionDialogStore();

const draft = computed(() => connectionDialogStore.draft);
const isEdit = computed(() => connectionDialogStore.mode === 'edit');
const secretStatus = computed(() => connectionsStore.secretStorage);
const isFileStyle = computed(() => !!draft.value && FILE_KINDS.has(draft.value.kind));

// A new connection starts at the engine picker; an existing one starts on its fields and
// reaches the picker through "Change engine".
const step = ref<'engine' | 'details'>(isEdit.value ? 'details' : 'engine');

const activeTab = ref<DetailTab>('General');
watch(step, (s) => {
  if (s === 'details') activeTab.value = 'General';
});

const DETAIL_TABS = computed<readonly { value: DetailTab; label: string; testid: string }[]>(() => [
  {
    value: 'General',
    label: t('studio.project.connectionDialog.tab.general.label'),
    testid: 'connection-tab-general',
  },
  { value: 'Advanced', label: t('common.advanced.label'), testid: 'connection-tab-advanced' },
  {
    value: 'Pre-connect',
    label: t('studio.project.connectionDialog.tab.preconnect.label'),
    testid: 'connection-tab-preconnect',
  },
  { value: 'MCP', label: t('common.mcp.label'), testid: 'connection-tab-mcp' },
  {
    value: 'Privacy',
    label: t('studio.project.connectionDialog.tab.privacy.label'),
    testid: 'connection-tab-privacy',
  },
]);

const form = useConnectionForm((tab) => {
  activeTab.value = tab;
});
provide(CONNECTION_FORM_KEY, form);
provide(CONNECTION_REVEAL_KEY, useConnectionReveal());

// Unsaved edits are those made on the details step; the engine pick itself is not an edit.
const baseline = ref(JSON.stringify(draft.value));
watch(draft, (d) => {
  baseline.value = JSON.stringify(d);
});
const dirty = computed(
  () => step.value === 'details' && JSON.stringify(draft.value) !== baseline.value,
);

function pickKind(kind: ConnectionKind): void {
  const d = draft.value;
  if (!d || !SUPPORTED_KINDS.has(kind)) return;
  d.kind = kind;
  const defaultPort = DEFAULT_PORT[kind];
  if (defaultPort !== undefined) d.port = defaultPort;
  baseline.value = JSON.stringify(d);
  step.value = 'details';
}

function continueToDetails(): void {
  if (draft.value && SUPPORTED_KINDS.has(draft.value.kind)) step.value = 'details';
}

const testState = ref<{ status: 'idle' | 'testing' | 'ok' | 'error'; message?: string }>({
  status: 'idle',
});
const testLabel = computed(() => {
  const { status, message } = testState.value;
  if (status === 'testing') return t('studio.project.connectionDialog.test.testing.loading');
  if (status === 'ok') {
    return t('studio.project.connectionDialog.test.ok.status', { message: message ?? '' });
  }
  return message ?? '';
});

// Edits made while a Test is in flight, or a swap to another draft, make the response describe
// something other than what was typed: the snapshot and identity check drop such a result.
async function onTest(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  const targetEditingId = connectionDialogStore.editingId;
  const snapshot = JSON.stringify(d);
  const stillCurrent = (): boolean =>
    connectionDialogStore.draft === d &&
    connectionDialogStore.editingId === targetEditingId &&
    JSON.stringify(connectionDialogStore.draft) === snapshot;

  testState.value = { status: 'testing' };
  // The backend fills in the stored secret when the draft carries none, so an unrevealed
  // connection still probes with its real credential.
  const result = await control.connectionsTest(d, targetEditingId ?? '');
  if (!stillCurrent()) return;
  testState.value = result.ok
    ? { status: 'ok', message: result.serverVersion }
    : { status: 'error', message: result.error };
}

// Guards a double click: two in-flight creates would insert two connections.
const {
  run: runSave,
  pending: saving,
  error: saveError,
} = useAsyncAction(() => connectionDialogStore.saveDialog());

async function onSave(): Promise<void> {
  if (!draft.value || saving.value) return;
  if (!(await form.submit())) return;
  connectionDialogStore.error = null;
  if (!(await runSave())) connectionDialogStore.error = saveError.value;
}
</script>

<template>
  <Dialog v-if="draft" :open="true" @update:open="(v) => !v && connectionDialogStore.closeDialog()">
    <DialogContent size="2xl" fixed-height :dirty="dirty" data-testid="connection-dialog">
      <DialogHeader v-if="step === 'engine'" close-testid="connection-dialog-close">
        <DialogTitle>{{
          isEdit ? t('studio.project.connectionDialog.changeEngine.title') : t('studio.project.connectionDialog.newConnection.title')
        }}</DialogTitle>
        <span class="min-w-0 grow" />
        <Button v-if="isEdit" variant="toolbar" size="kira" @click="step = 'details'">
          <CodiconIcon name="chevron-left" :size="13" />
          {{ t('common.action.back.label') }}
        </Button>
      </DialogHeader>
      <!-- The engine is identity here, not a control: it changes via "Change engine". -->
      <DialogHeader v-else close-testid="connection-dialog-close">
        <span class="flex shrink-0" :class="KIND_ACCENT_CLASS[draft.kind]">
          <EngineIcon :kind="draft.kind" :size="13" />
        </span>
        <DialogTitle>{{
          isEdit ? t('studio.project.connectionDialog.editTitle.title', { kind: KIND_LABEL[draft.kind] }) : t('studio.project.connectionDialog.newKindTitle.title', { kind: KIND_LABEL[draft.kind] })
        }}</DialogTitle>
        <span class="min-w-0 grow" />
        <Tooltip>
          <TooltipTrigger as-child>
            <Button variant="toolbar" size="kira" @click="step = 'engine'">
              <CodiconIcon name="chevron-left" :size="13" />
              {{ t('studio.project.connectionDialog.changeEngine.title') }}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{
            t('studio.project.connectionDialog.changeEngine.tooltip')
          }}</TooltipContent>
        </Tooltip>
      </DialogHeader>

      <DialogBody flush data-testid="connection-dialog-body">
        <ConnectionEnginePicker v-if="step === 'engine'" :kind="draft.kind" @pick="pickKind" />
        <Tabs
          v-else
          :model-value="activeTab"
          class="flex flex-col"
          @update:model-value="(v) => (activeTab = v as DetailTab)"
        >
          <ViewToolbar class="px-3">
            <SecondaryTabs
              :model-value="activeTab"
              :items="DETAIL_TABS"
              :aria-label="t('studio.project.connectionDialog.tabs.aria')"
              @update:model-value="(v) => (activeTab = v as DetailTab)"
            />
          </ViewToolbar>

          <ConnectionGeneralTab />
          <ConnectionAdvancedTab />
          <ConnectionPreconnectTab />
          <ConnectionMcpTab />
          <ConnectionPrivacyTab v-if="activeTab === 'Privacy'" />

          <div class="flex flex-col gap-3 px-3 pb-3 empty:hidden">
            <Alert
              v-if="connectionDialogStore.error"
              variant="error"
              data-testid="connection-save-error"
            >
              <AlertDescription>{{ connectionDialogStore.error }}</AlertDescription>
            </Alert>

            <!-- Three states from connectionsStore.secretStorage; none renders until hydrated. A
                 file kind has no credentials, so none applies. Dialog-level: it describes the
                 whole connection and stays visible on every tab. -->
            <template v-if="!isFileStyle">
              <FieldDescription
                v-if="secretStatus?.available && !secretStatus.insecureFallback"
                class="text-muted-foreground"
                data-testid="connection-credential-note"
              >
                {{ t('studio.project.connectionDialog.credentials.encrypted.hint') }}
              </FieldDescription>
              <Alert
                v-else-if="secretStatus?.insecureFallback"
                data-testid="connection-credential-note"
                variant="warn"
              >
                <AlertDescription>
                  {{ t('studio.project.connectionDialog.credentials.fallback.body') }}
                </AlertDescription>
              </Alert>
              <Alert
                v-else-if="secretStatus"
                variant="error"
                data-testid="connection-credential-note"
              >
                <AlertDescription>
                  {{ t('studio.project.connectionDialog.credentials.unavailable.body') }}
                </AlertDescription>
              </Alert>
            </template>
          </div>
        </Tabs>
      </DialogBody>

      <DialogFooter v-if="step === 'engine'">
        <Button
          variant="dialog"
          size="kira-lg"
          data-testid="connection-cancel"
          @click="connectionDialogStore.closeDialog"
          >{{
            t('common.action.cancel.label')
          }}</Button
        >
        <Button variant="dialog-primary" size="kira-lg" @click="continueToDetails">
          {{ t('common.continue.label') }}
          <CodiconIcon name="chevron-right" :size="13" />
        </Button>
      </DialogFooter>
      <DialogFooter v-else>
        <template #start>
          <Button
            variant="dialog"
            size="kira-lg"
            data-testid="connection-test"
            :pending="testState.status === 'testing'"
            @click="onTest"
          >
            <CodiconIcon name="plug" :size="13" />
            {{ t('studio.project.connectionDialog.test.label') }}
          </Button>
          <Badge
            v-if="testState.status !== 'idle'"
            class="min-w-0"
            :variant="testState.status === 'ok' ? 'ok' : testState.status === 'error' ? 'error' : 'info'"
            data-testid="connection-test-result"
          >
            <TruncatedText :text="testLabel" />
          </Badge>
        </template>
        <Button
          variant="dialog"
          size="kira-lg"
          data-testid="connection-cancel"
          @click="connectionDialogStore.closeDialog"
          >{{
            t('common.action.cancel.label')
          }}</Button
        >
        <Button
          variant="dialog-primary"
          size="kira-lg"
          data-testid="connection-save"
          :pending="saving"
          @click="onSave"
        >
          {{ t('common.action.save.label') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
