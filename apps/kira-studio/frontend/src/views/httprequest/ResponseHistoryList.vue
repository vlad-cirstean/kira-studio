<script setup lang="ts">
import { httpMethodToken, statusClass, statusHint } from '@shared/domain/http';
import {
  HISTORY_PER_SCOPE_LIMIT,
  type ResponseHistoryEntry,
} from '@shared/domain/response-history';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertTitle } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@theme/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { methodTextClass } from '@theme/methodColor';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { formatBytes, formatRelative } from '@workbench/util/format';
import { computed, onMounted, ref } from 'vue';
import { patchHttpRequestTabState } from '../../api/tabs';
import type { HttpRequestTabRecord } from '../../state/tabDomain';
import { useTabIncognitoStore } from '../../state/tabIncognito';
import { useHttpHistoryStore } from './history';

// P8 D15: the History pane's list — one row per response, capped at HISTORY_PER_SCOPE_LIMIT by
// construction (P18 D4/D6), so no VirtualList/TreeHost involvement.
const confirmDialogStore = useConfirmDialogStore();
const tabIncognitoStore = useTabIncognitoStore();
const httpHistoryStore = useHttpHistoryStore();
const props = defineProps<{ tab: HttpRequestTabRecord }>();
const emit = defineEmits<{ compare: [ids: [string, string]] }>();

const rt = computed(() => httpHistoryStore.runtime[props.tab.id]);
const entries = computed<ResponseHistoryEntry[]>(() => rt.value?.entries ?? []);
const selected = computed(() => rt.value?.selected ?? []);
const viewingId = computed(() => rt.value?.viewing?.id ?? null);
const isScratch = computed(() => !props.tab.state.itemId);
// P71 §3.5: nothing is suppressed here — with nothing recorded, historyList simply returns the
// empty set, so this only exists to explain the silence rather than leave it looking broken.
const incognito = computed(() => tabIncognitoStore.isIncognito(props.tab.id));
// P18 D6: the list is ≤ HISTORY_PER_SCOPE_LIMIT by construction (Record's own trim), so "the list
// is full" is exactly this predicate — not a stored eviction count (rejected in the plan: List can
// never say more than "the list is full" without a new column and write path). Not suppressed by
// the filter (§6 OQ-5): the note describes what is *stored*, not what is currently shown.
const atCap = computed(() => entries.value.length >= HISTORY_PER_SCOPE_LIMIT);

onMounted(() => {
  httpHistoryStore.ensureHistoryFresh(props.tab.id);
});

// P16 D15: matches method, URL, status text, or environment name — the fields already on screen
// in each row.
const filterQuery = ref('');
const isFiltered = computed(() => filterQuery.value.trim() !== '');
const filteredEntries = computed<ResponseHistoryEntry[]>(() => {
  const q = filterQuery.value.trim().toLowerCase();
  if (!q) return entries.value;
  return entries.value.filter(
    (e) =>
      e.method.toLowerCase().includes(q) ||
      e.url.toLowerCase().includes(q) ||
      e.statusText.toLowerCase().includes(q) ||
      String(e.status).includes(q) ||
      e.environment.toLowerCase().includes(q),
  );
});

/** D15: the URL is shown on a second line only when it differs from the row above it — within
 *  one request's history the URL is usually identical, and repeating it twenty times is noise.
 *  Indexes into `filteredEntries` (the rendered list), not `entries` — the row "above" is the
 *  row visibly above it, under a filter too. */
function showUrl(i: number): boolean {
  return i === 0 || filteredEntries.value[i - 1]?.url !== filteredEntries.value[i]?.url;
}

// D10: "click views the entry" swaps the *whole* response pane, not just the runtime pointer —
// without switching back to Body, selecting a row would leave the user staring at the same list
// they just clicked in, with no visible sign anything happened.
function onRowClick(id: string): void {
  void httpHistoryStore.viewHistoryEntry(props.tab.id, id);
  patchHttpRequestTabState(props.tab.id, { responsePane: 'body' });
}

// P105 §5.2(c): Enter/Space mirror a single click — the checkbox nested inside stays its own tab
// stop, so this handler never claims either key from it.
function onRowKeydown(e: KeyboardEvent, id: string): void {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  onRowClick(id);
}

function onToggle(id: string): void {
  httpHistoryStore.toggleSelected(props.tab.id, id);
}

function onDelete(id: string): void {
  void httpHistoryStore.deleteHistoryEntry(props.tab.id, id);
}

function onCompare(): void {
  const [a, b] = selected.value;
  if (a && b) emit('compare', [a, b]);
}

async function onClear(): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog('Clear this request’s response history? This cannot be undone.', {
    danger: true,
  });
  if (ok) await httpHistoryStore.clearHistory(props.tab.id);
}
</script>

<template>
  <div class="flex flex-1 min-h-0 flex-col" data-testid="http-history-list">
    <div class="h-bar shrink-0 flex items-center gap-1 px-2 border-b border-border">
      <span class="text-kira-xs text-subtle">{{ entries.length }} {{ entries.length === 1 ? 'response' : 'responses' }}</span>
      <span class="ml-auto" />
      <Button
        variant="toolbar"
        size="kira"
        :disabled="selected.length !== 2"
        data-testid="http-history-compare"
        @click="onCompare"
      >
        Compare
      </Button>
      <Button
        variant="toolbar"
        size="kira"
        :disabled="entries.length === 0"
        data-testid="http-history-clear"
        @click="onClear"
      >
        <CodiconIcon name="trash" :size="13" />
        Clear history
      </Button>
    </div>

    <Alert v-if="entries.length === 0" class="empty-state" data-testid="http-history-empty">
      <CodiconIcon name="history" :size="24" class="text-subtle" />
      <AlertTitle class="text-kira-md text-muted-foreground font-normal">No past responses yet</AlertTitle>
      <span class="text-kira-xs text-subtle mt-0.5">
        <template v-if="incognito">Responses are not recorded in an incognito tab.</template>
        <template v-else>
          Sending this request will record one.
          <template v-if="isScratch">
            Scratch requests keep their history until the tab is closed — save this request to
            keep it.
          </template>
        </template>
      </span>
    </Alert>

    <template v-else>
      <InputGroup>
        <InputGroupAddon><CodiconIcon name="search" :size="13" /></InputGroupAddon>
        <InputGroupInput v-model="filterQuery" placeholder="Filter history" data-testid="http-history-filter" />
        <InputGroupAddon v-if="filterQuery" align="inline-end">
          <InputGroupButton aria-label="Clear filter" @click="filterQuery = ''">
            <CodiconIcon name="close" :size="13" />
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <Alert
        v-if="isFiltered && filteredEntries.length === 0"
        class="empty-state"
        data-testid="http-history-filter-empty"
      >
        <CodiconIcon name="search" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md text-muted-foreground font-normal">No matches</AlertTitle>
      </Alert>
    </template>

    <div
      v-if="entries.length > 0 && filteredEntries.length > 0"
      class="flex flex-1 min-h-0 flex-col overflow-auto"
      role="listbox"
      aria-label="Response history"
    >
      <div
        v-for="(entry, i) in filteredEntries"
        :key="entry.id"
        class="history-row flex cursor-pointer gap-1 border-b border-border px-1.5 py-1"
        :class="{ 'is-viewing': entry.id === viewingId }"
        data-testid="http-history-row"
        role="option"
        tabindex="0"
        :aria-selected="entry.id === viewingId"
        @click="onRowClick(entry.id)"
        @keydown="onRowKeydown($event, entry.id)"
      >
        <Checkbox
          data-testid="http-history-checkbox"
          :model-value="selected.includes(entry.id)"
          :disabled="!selected.includes(entry.id) && selected.length >= 2"
          @click.stop
          @update:model-value="onToggle(entry.id)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <div class="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger as-child>
                <span class="text-kira-xs text-subtle min-w-16">{{ formatRelative(entry.sentAt) }}</span>
              </TooltipTrigger>
              <TooltipContent>{{ entry.sentAt }}</TooltipContent>
            </Tooltip>
            <Badge variant="chip" :class="methodTextClass(httpMethodToken(entry.method))">{{ entry.method }}</Badge>
            <Tooltip>
              <TooltipTrigger as-child>
                <Badge :variant="statusClass(entry.status)">{{ entry.status }} {{ entry.statusText }}</Badge>
              </TooltipTrigger>
              <TooltipContent>{{ statusHint(entry.status) }}</TooltipContent>
            </Tooltip>
            <span class="text-kira-xs text-subtle">{{ entry.elapsedMs }} ms</span>
            <span class="text-kira-xs text-subtle">{{ formatBytes(entry.bodyBytes) }}</span>
            <span v-if="entry.environment" class="text-kira-xs text-subtle">{{ entry.environment }}</span>
            <span class="ml-auto" />
            <Tooltip>
              <TooltipTrigger as-child>
                <Button
                  variant="toolbar"
                  size="kira-icon"
                  aria-label="Delete"
                  data-testid="http-history-delete"
                  @click.stop="onDelete(entry.id)"
                >
                  <CodiconIcon name="trash" :size="13" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete</TooltipContent>
            </Tooltip>
          </div>
          <div v-if="showUrl(i)" class="text-kira-xs text-subtle overflow-hidden text-ellipsis whitespace-nowrap">{{ entry.url }}</div>
        </div>
      </div>
    </div>

    <div v-if="atCap" class="text-kira-xs text-subtle shrink-0 border-t border-border px-1.5 py-1" data-testid="http-history-cap-note">
      Only the last {{ HISTORY_PER_SCOPE_LIMIT }} are kept — older responses are removed
      automatically.
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";
/* P110 B40: every plain single-selector rule this file had moved onto the template as Tailwind
   utilities. `.history-row` stays a bare marker to anchor this hover/is-viewing compound. */
.history-row:hover,
.history-row.is-viewing {
  @apply bg-hover;
}
/* P110 B34: `.empty-state` moved to base.css's own @utility empty-state (15-file duplicate). */
</style>
