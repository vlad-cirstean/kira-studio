<script setup lang="ts">
import type { GrpcRequestTabRecord } from '@shared/domain/tabs';
import { computed, ref } from 'vue';
import { patchGrpcRequestTabState } from '../../api/tabs';
import { control } from '../../bridge/control';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { loadSchema, schemaRuntime } from './state';

// D13's Schema pane: the source selector (Reflection / .proto file + import paths + Reload) above
// a service→method list — inside the tab, not the left panel (D13's own reasoning: a schema is a
// property of one request's target, not of the workspace).
const props = defineProps<{ tab: GrpcRequestTabRecord }>();

const rt = computed(() => schemaRuntime[props.tab.id]);

const SOURCE_OPTIONS = [
  { value: 'reflection' as const, label: 'Reflection', testid: 'grpc-source-reflection' },
  { value: 'proto' as const, label: '.proto file', testid: 'grpc-source-proto' },
];

function setDescriptorMode(mode: 'reflection' | 'proto'): void {
  patchGrpcRequestTabState(props.tab.id, { descriptorMode: mode });
}

function onTargetInput(value: string): void {
  patchGrpcRequestTabState(props.tab.id, { target: value });
}

async function chooseProtoFile(): Promise<void> {
  const chosen = await control.filesChooseOpen({
    title: 'Choose a .proto file',
    filters: [{ name: 'Protocol Buffers', extensions: ['proto'] }],
  });
  if (chosen.canceled || !chosen.file) return;
  patchGrpcRequestTabState(props.tab.id, { protoPath: chosen.file.path });
}

// D4: import paths default to the .proto file's own directory (Go's own resolveProto), and the
// user can add more — FilesService.ChooseOpen has no directory-picking mode (P3 D4's own file-only
// scope), so an extra path is typed and confirmed with Enter rather than browsed to.
const newImportPath = ref('');
function addImportPath(): void {
  const path = newImportPath.value.trim();
  if (!path) return;
  patchGrpcRequestTabState(props.tab.id, {
    importPaths: [...props.tab.state.importPaths, path],
  });
  newImportPath.value = '';
}

function removeImportPath(i: number): void {
  patchGrpcRequestTabState(props.tab.id, {
    importPaths: props.tab.state.importPaths.filter((_, idx) => idx !== i),
  });
}

function onReload(): void {
  void loadSchema(props.tab.id, true);
}

function selectMethod(service: string, method: string): void {
  const m = rt.value?.schema?.services
    .find((s) => s.name === service)
    ?.methods.find((mm) => mm.name === method);
  patchGrpcRequestTabState(props.tab.id, {
    service,
    method,
    message: m?.requestTemplate ?? props.tab.state.message,
    requestPane: 'message',
  });
}
</script>

<template>
  <div class="schema-browser" data-testid="grpc-schema-browser">
    <div class="source-row p-toolbar">
      <SegmentedControl
        :model-value="tab.state.descriptorMode"
        :options="SOURCE_OPTIONS"
        data-testid="grpc-source-toggle"
        @update:model-value="setDescriptorMode"
      />
      <template v-if="tab.state.descriptorMode === 'reflection'">
        <TextField
          :model-value="tab.state.target"
          placeholder="api.example.com:443"
          style="flex: 1"
          data-testid="grpc-schema-target"
          @update:model-value="onTargetInput"
        />
      </template>
      <template v-else>
        <TextField
          :model-value="tab.state.protoPath"
          placeholder="No .proto file chosen"
          readonly
          style="flex: 1"
          data-testid="grpc-proto-path"
        />
        <AppButton data-testid="grpc-choose-proto" @click="chooseProtoFile">Choose…</AppButton>
      </template>
      <AppButton icon="refresh" data-testid="grpc-schema-reload" :disabled="rt?.status === 'loading'" @click="onReload">
        Reload
      </AppButton>
    </div>

    <div v-if="tab.state.descriptorMode === 'proto'" class="import-paths" data-testid="grpc-import-paths">
      <span class="def-section-title">Import paths</span>
      <div class="import-path-list">
        <div v-for="(p, i) in tab.state.importPaths" :key="i" class="p-row">
          <span class="p-xs mono import-path-text" v-tooltip="p">{{ p }}</span>
          <IconButton icon="close" class="p-push" v-tooltip="'Remove'" @click="removeImportPath(i)" />
        </div>
        <div v-if="tab.state.importPaths.length === 0" class="p-xs dim">
          No import paths — the .proto file's own directory is used
        </div>
      </div>
      <div class="add-row">
        <TextField
          v-model="newImportPath"
          placeholder="Add an import path…"
          data-testid="grpc-new-import-path"
          @enter="addImportPath"
        />
        <AppButton data-testid="grpc-add-import-path" @click="addImportPath">Add</AppButton>
      </div>
    </div>

    <MessageStrip v-if="rt?.status === 'error' && rt.error" tone="err" data-testid="grpc-schema-error">
      {{ rt.error }}
    </MessageStrip>

    <div class="service-list" data-testid="grpc-service-list">
      <template v-if="rt?.schema && rt.schema.services.length > 0">
        <div v-for="svc in rt.schema.services" :key="svc.name" class="service-group">
          <div class="def-section-title service-name" data-testid="grpc-service-name">{{ svc.name }}</div>
          <button
            v-for="m in svc.methods"
            :key="m.name"
            type="button"
            class="p-row method-row"
            :class="{ 'is-selected': tab.state.service === svc.name && tab.state.method === m.name }"
            data-testid="grpc-method-row"
            @click="selectMethod(svc.name, m.name)"
          >
            <span class="method-name mono">{{ m.name }}</span>
            <span
              v-if="m.serverStreaming || m.clientStreaming"
              class="p-chip ok"
              data-testid="grpc-method-streaming-badge"
            >
              STREAM
            </span>
            <span v-else class="p-chip info" data-testid="grpc-method-streaming-badge">UNARY</span>
          </button>
        </div>
      </template>
      <EmptyState
        v-else-if="rt?.status !== 'loading'"
        icon="symbol-interface"
        label="Choose a source above to browse this server's services"
      />
    </div>
  </div>
</template>

<style scoped>
.schema-browser {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}

.source-row {
  gap: var(--kira-s-2);
}

.import-paths {
  padding: var(--kira-s-2) var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

/* D14: a real cap + scroll, so a large .proto tree's import list can never push the source row
   and the whole service browser off the pane. */
.import-path-list {
  max-height: 132px;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.import-path-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-row {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.service-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--kira-s-2) var(--kira-s-3);
}

.service-group {
  margin-bottom: var(--kira-s-3);
}

.service-name {
  padding: var(--kira-s-1) 0;
}

/* p-row supplies height/display/align-items/gap/padding/border-radius/color/font-size/cursor
   and its own hover + is-selected states; this button only needs what .p-row does not supply. */
.method-row {
  width: 100%;
  justify-content: space-between;
  background: none;
  border: none;
  text-align: left;
  font: inherit;
}

.method-name {
  font-size: var(--kira-t-sm);
}
</style>
