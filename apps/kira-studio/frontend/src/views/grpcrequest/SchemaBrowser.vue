<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@theme/components/ui/input-group';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, ref } from 'vue';
import { patchGrpcRequestTabState } from '../../api/tabs';
import { control } from '../../bridge/control';
import type { GrpcRequestTabRecord } from '../../state/tabDomain';
import { useGrpcRequestViewStore } from './state';

// D13's Schema pane: the source selector (Reflection / .proto file + import paths + Reload) above
// a service→method list — inside the tab, not the left panel (D13's own reasoning: a schema is a
// property of one request's target, not of the workspace).
const props = defineProps<{ tab: GrpcRequestTabRecord }>();
const grpcRequestViewStore = useGrpcRequestViewStore();

const rt = computed(() => grpcRequestViewStore.schemaRuntime[props.tab.id]);

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
  void grpcRequestViewStore.loadSchema(props.tab.id, true);
}

// P16 D15: matches service name or method name — a service whose own name matches shows all its
// methods; otherwise only the methods that themselves match, and a service with no match at all
// (name or any method) drops out entirely.
const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');
const filteredServices = computed(() => {
  const services = rt.value?.schema?.services ?? [];
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return services;
  return services.flatMap((svc) => {
    const svcMatches = svc.name.toLowerCase().includes(q);
    const methods = svcMatches
      ? svc.methods
      : svc.methods.filter((m) => m.name.toLowerCase().includes(q));
    return methods.length > 0 ? [{ ...svc, methods }] : [];
  });
});

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
      <ToggleGroup
        type="single"
        :model-value="tab.state.descriptorMode"
        data-testid="grpc-source-toggle"
        @update:model-value="(v) => v && setDescriptorMode(v as 'reflection' | 'proto')"
      >
        <ToggleGroupItem
          v-for="opt in SOURCE_OPTIONS"
          :key="opt.value"
          :value="opt.value"
          :data-testid="opt.testid"
        >
          {{ opt.label }}
        </ToggleGroupItem>
      </ToggleGroup>
      <template v-if="tab.state.descriptorMode === 'reflection'">
        <Input
          :model-value="tab.state.target"
          placeholder="api.example.com:443"
          class="flex-1"
          data-testid="grpc-schema-target"
          @update:model-value="onTargetInput($event.toString())"
        />
      </template>
      <template v-else>
        <Input
          :model-value="tab.state.protoPath"
          placeholder="No .proto file chosen"
          readonly
          class="flex-1"
          data-testid="grpc-proto-path"
        />
        <Button variant="toolbar" size="kira" data-testid="grpc-choose-proto" @click="chooseProtoFile">
          Choose…
        </Button>
      </template>
      <Button
        variant="toolbar"
        size="kira"
        data-testid="grpc-schema-reload"
        :disabled="rt?.status === 'loading'"
        @click="onReload"
      >
        <CodiconIcon name="refresh" :size="13" />
        Reload
      </Button>
    </div>

    <div v-if="tab.state.descriptorMode === 'proto'" class="import-paths" data-testid="grpc-import-paths">
      <span class="def-section-title">Import paths</span>
      <div class="import-path-list">
        <div v-for="(p, i) in tab.state.importPaths" :key="i" class="p-row">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="text-kira-xs font-data import-path-text">{{ p }}</span>
            </TooltipTrigger>
            <TooltipContent>{{ p }}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="toolbar"
                size="kira-icon"
                class="ml-auto"
                aria-label="Remove"
                @click="removeImportPath(i)"
              >
                <CodiconIcon name="close" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove</TooltipContent>
          </Tooltip>
        </div>
        <div v-if="tab.state.importPaths.length === 0" class="text-kira-xs text-subtle">
          No import paths — the .proto file's own directory is used
        </div>
      </div>
      <div class="add-row">
        <Input
          v-model="newImportPath"
          placeholder="Add an import path…"
          data-testid="grpc-new-import-path"
          @keydown.enter="addImportPath"
        />
        <Button variant="toolbar" size="kira" data-testid="grpc-add-import-path" @click="addImportPath">
          Add
        </Button>
      </div>
    </div>

    <Alert v-if="rt?.status === 'error' && rt.error" variant="destructive" data-testid="grpc-schema-error">
      <AlertDescription>{{ rt.error }}</AlertDescription>
    </Alert>

    <InputGroup v-if="rt?.schema && rt.schema.services.length > 0">
      <InputGroupAddon>
        <CodiconIcon name="search" :size="13" />
      </InputGroupAddon>
      <InputGroupInput
        v-model="filterQuery"
        placeholder="Filter services and methods"
        data-testid="grpc-schema-filter"
      />
      <InputGroupAddon v-if="filterQuery" align="inline-end">
        <InputGroupButton @click="filterQuery = ''">
          <CodiconIcon name="close" :size="13" />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
    <div class="service-list" data-testid="grpc-service-list">
      <template v-if="rt?.schema && filteredServices.length > 0">
        <div v-for="svc in filteredServices" :key="svc.name" class="service-group">
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
            <span class="method-name font-data">{{ m.name }}</span>
            <Badge
              v-if="m.serverStreaming || m.clientStreaming"
              variant="ok"
              data-testid="grpc-method-streaming-badge"
            >
              STREAM
            </Badge>
            <Badge v-else variant="info" data-testid="grpc-method-streaming-badge">UNARY</Badge>
          </button>
        </div>
      </template>
      <Alert
        v-else-if="isFiltered && rt?.schema && rt.schema.services.length > 0"
        class="empty-state"
        data-testid="grpc-schema-filter-empty"
      >
        <CodiconIcon name="search" :size="24" class="empty-state-icon" />
        <AlertTitle class="empty-state-title">No matches</AlertTitle>
      </Alert>
      <Alert v-else-if="rt?.status !== 'loading'" class="empty-state">
        <CodiconIcon name="symbol-interface" :size="24" class="empty-state-icon" />
        <AlertTitle class="empty-state-title">
          Choose a source above to browse this server's services
        </AlertTitle>
      </Alert>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.schema-browser {
  @apply flex h-full min-h-0 flex-col overflow-auto;
}

.source-row {
  @apply gap-1;
}

.import-paths {
  @apply flex flex-col gap-0.5 border-b border-border px-1.5 py-1;
}

/* D14: a real cap + scroll, so a large .proto tree's import list can never push the source row
   and the whole service browser off the pane. */
.import-path-list {
  @apply flex max-h-32 flex-col overflow-auto;
}

.import-path-text {
  @apply min-w-0 overflow-hidden text-ellipsis whitespace-nowrap;
}

.add-row {
  @apply flex items-center gap-1;
}

.service-list {
  @apply flex-1 min-h-0 overflow-auto px-1.5 py-1;
}

.service-group {
  @apply mb-1.5;
}

.service-name {
  @apply py-0.5;
}

/* p-row supplies height/display/align-items/gap/padding/border-radius/color/font-size/cursor
   and its own hover + is-selected states; this button only needs what .p-row does not supply. */
.method-row {
  @apply w-full justify-between border-0 bg-none text-left font-[inherit];
}

.method-name {
  @apply text-kira-sm;
}

.empty-state {
  @apply flex flex-1 min-h-0 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center;
}
.empty-state-icon {
  @apply text-subtle;
}
.empty-state-title {
  @apply text-kira-md text-muted-foreground font-normal;
}
</style>
