<script setup lang="ts">
import { syntaxHighlighting } from '@codemirror/language';
import type { MergeView as MergeViewType } from '@codemirror/merge';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { statusClass } from '@shared/domain/http';
import type { ResponseHistorySnapshot } from '@shared/domain/response-history';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { beautifyJson, beautifyXml, scanJson, scanXml } from '../../beautify';
import { control } from '../../bridge/control';
import { languageExtension } from '../../editor/languages';
import { kiraEditorTheme, kiraHighlightStyle } from '../../editor/theme';
import { formatBytes, formatRelative } from '../../format';
import AppButton from '../../theme/primitives/AppButton.vue';
import DialogFrame from '../../theme/primitives/DialogFrame.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import { loadMerge } from './mergeEntry';

// P8 D12: two entries, three levels of difference, one dialog. `ids` are the two selections from
// the History list's own checkboxes — this dialog itself decides which is A (older) and which is
// B (newer) by sentAt, never by click order (D12), so the diff's direction is never a surprise.
const props = defineProps<{ ids: [string, string] }>();
const emit = defineEmits<{ close: [] }>();

const snapA = ref<ResponseHistorySnapshot | null>(null);
const snapB = ref<ResponseHistorySnapshot | null>(null);
const loadingSnapshots = ref(true);
const loadError = ref<string | null>(null);
const mergeLoading = ref(false);
const mergeHostRef = ref<HTMLElement | null>(null);
let mergeView: MergeViewType | null = null;

async function loadSnapshots(): Promise<void> {
  try {
    const [s1, s2] = await Promise.all([
      control.historyGet(props.ids[0]),
      control.historyGet(props.ids[1]),
    ]);
    // ISO timestamps compare lexicographically in chronological order (model.FormatISO's fixed
    // UTC width) — no Date parsing needed to pick the older one.
    if (s1.entry.sentAt <= s2.entry.sentAt) {
      snapA.value = s1;
      snapB.value = s2;
    } else {
      snapA.value = s2;
      snapB.value = s1;
    }
  } catch (err) {
    loadError.value = err instanceof Error ? err.message : String(err);
  } finally {
    loadingSnapshots.value = false;
  }
}
void loadSnapshots();

// D12: "not compared" — a binary body on either side. The dialog still shows the summary and
// headers levels; only the body diff is withheld, with the reason stated inline.
const bothStored = computed(() => !!snapA.value?.bodyStored && !!snapB.value?.bodyStored);

function detectFormat(body: string): 'json' | 'xml' | null {
  if (scanJson(body).ok) return 'json';
  const t = body.trim();
  if (t.length > 0 && t[0] === '<' && t[t.length - 1] === '>' && scanXml(t).ok) return 'xml';
  return null;
}

// D12: both bodies are pretty-printed before diffing only when *both* are the same recognised
// format — a minified-vs-minified diff of two 40 KB single lines tells the user nothing.
// beautifyJson(text, 'indented') is lossless by construction (P2 F13), so this never
// misrepresents what came back.
const commonFormat = computed<'json' | 'xml' | null>(() => {
  if (!snapA.value || !snapB.value) return null;
  const a = detectFormat(snapA.value.response.body);
  const b = detectFormat(snapB.value.response.body);
  return a && a === b ? a : null;
});

function prettyOrRaw(body: string): string {
  if (commonFormat.value === 'json') return beautifyJson(body, 'indented').text;
  if (commonFormat.value === 'xml') return beautifyXml(body, 'indented').text;
  return body;
}
const bodyTextA = computed(() => (snapA.value ? prettyOrRaw(snapA.value.response.body) : ''));
const bodyTextB = computed(() => (snapB.value ? prettyOrRaw(snapB.value.response.body) : ''));

// D12 level 2: the headers table. Reduced to added/removed/changed/unchanged by header *name*
// (case-insensitive) rather than by @codemirror/merge's own text-diff — headers are a keyed
// structure, not ordered prose, so a name-keyed comparison is the semantically correct model (it
// stays right even when two servers emit the same headers in a different order) and needs no
// diff algorithm of its own. @codemirror/merge's diff/LCS machinery is exactly what the body
// level below is for.
interface HeaderRow {
  name: string;
  a: string | null;
  b: string | null;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
}
const headerRows = computed<HeaderRow[]>(() => {
  if (!snapA.value || !snapB.value) return [];
  const order: string[] = [];
  const mapA = new Map<string, string>();
  const mapB = new Map<string, string>();
  for (const h of snapA.value.response.headers) {
    const key = h.name.toLowerCase();
    if (!mapA.has(key)) {
      mapA.set(key, h.value);
      order.push(h.name);
    }
  }
  for (const h of snapB.value.response.headers) {
    const key = h.name.toLowerCase();
    if (!mapA.has(key) && !mapB.has(key)) order.push(h.name);
    if (!mapB.has(key)) mapB.set(key, h.value);
  }
  return order.map((name) => {
    const key = name.toLowerCase();
    const a = mapA.has(key) ? (mapA.get(key) ?? null) : null;
    const b = mapB.has(key) ? (mapB.get(key) ?? null) : null;
    let status: HeaderRow['status'];
    if (a === null) status = 'added';
    else if (b === null) status = 'removed';
    else if (a === b) status = 'unchanged';
    else status = 'changed';
    return { name, a, b, status };
  });
});
const changedHeaderRows = computed(() => headerRows.value.filter((r) => r.status !== 'unchanged'));
const unchangedHeaderRows = computed(() =>
  headerRows.value.filter((r) => r.status === 'unchanged'),
);

// D12 level 3: the real payoff of @codemirror/merge — a scroll-locked, line-aligned,
// intra-line-highlighted side-by-side view. Both sides read-only (F14's own recipe).
async function buildMergeView(): Promise<void> {
  if (!bothStored.value || !snapA.value || !snapB.value) return;
  mergeLoading.value = true;
  const { MergeView } = await loadMerge();
  mergeLoading.value = false;
  mergeView?.destroy();
  mergeView = null;
  await nextTick();
  if (!mergeHostRef.value) return;
  const lang = commonFormat.value ? [languageExtension(commonFormat.value)] : [];
  const readOnly = [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    syntaxHighlighting(kiraHighlightStyle),
    kiraEditorTheme,
  ];
  mergeView = new MergeView({
    parent: mergeHostRef.value,
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: {},
    a: { doc: bodyTextA.value, extensions: [...lang, ...readOnly] },
    b: { doc: bodyTextB.value, extensions: [...lang, ...readOnly] },
  });
}

watch(
  () => loadingSnapshots.value,
  (loading) => {
    if (!loading && bothStored.value) void buildMergeView();
  },
);

onUnmounted(() => {
  mergeView?.destroy();
  mergeView = null;
});
</script>

<template>
  <DialogFrame
    title="Compare responses"
    :width="900"
    :height="640"
    test-id="http-diff-dialog"
    close-test-id="http-diff-close"
    @close="emit('close')"
  >
    <div v-if="loadingSnapshots" class="diff-status p-xs dim">Loading…</div>
    <MessageStrip v-else-if="loadError" tone="err">{{ loadError }}</MessageStrip>
    <div v-else-if="snapA && snapB" class="diff-body">
      <div class="diff-summary" data-testid="http-diff-summary">
        <div class="diff-summary-side">
          <span v-tooltip="snapA.entry.sentAt" class="p-xs dim diff-summary-time">{{
            formatRelative(snapA.entry.sentAt)
          }}</span>
          <div class="diff-summary-col">
            <span class="p-chip" :class="statusClass(snapA.entry.status)" data-testid="http-diff-status-a">
              {{ snapA.entry.status }} {{ snapA.entry.statusText }}
            </span>
            <span class="p-xs dim">{{ snapA.entry.elapsedMs }} ms</span>
            <span class="p-xs dim">{{ formatBytes(snapA.entry.bodyBytes) }}</span>
          </div>
        </div>
        <span class="diff-arrow">→</span>
        <div class="diff-summary-side">
          <span v-tooltip="snapB.entry.sentAt" class="p-xs dim diff-summary-time">{{
            formatRelative(snapB.entry.sentAt)
          }}</span>
          <div class="diff-summary-col">
            <span class="p-chip" :class="statusClass(snapB.entry.status)" data-testid="http-diff-status-b">
              {{ snapB.entry.status }} {{ snapB.entry.statusText }}
            </span>
            <span class="p-xs dim">{{ snapB.entry.elapsedMs }} ms</span>
            <span class="p-xs dim">{{ formatBytes(snapB.entry.bodyBytes) }}</span>
          </div>
        </div>
      </div>

      <div class="diff-headers" data-testid="http-diff-headers">
        <div class="diff-header-row diff-header-head p-xs dim">
          <span></span>
          <span></span>
          <span>before</span>
          <span>after</span>
        </div>
        <div
          v-for="row in changedHeaderRows"
          :key="row.name"
          class="diff-header-row"
          :class="row.status"
          data-testid="http-diff-header-row"
        >
          <span class="diff-header-status p-xs">{{ row.status }}</span>
          <span class="mono diff-header-name">{{ row.name }}</span>
          <span class="mono diff-header-value">{{ row.a ?? '—' }}</span>
          <span class="mono diff-header-value">{{ row.b ?? '—' }}</span>
        </div>
        <details v-if="unchangedHeaderRows.length > 0" class="p-disclosure diff-header-unchanged">
          <summary class="p-xs dim">{{ unchangedHeaderRows.length }} unchanged</summary>
          <div
            v-for="row in unchangedHeaderRows"
            :key="row.name"
            class="diff-header-row unchanged"
            data-testid="http-diff-header-row-unchanged"
          >
            <span class="diff-header-status p-xs">{{ row.status }}</span>
            <span class="mono diff-header-name">{{ row.name }}</span>
            <span class="mono diff-header-value">{{ row.a }}</span>
            <span class="mono diff-header-value">{{ row.b }}</span>
          </div>
        </details>
      </div>

      <MessageStrip v-if="!bothStored" tone="note" data-testid="http-diff-not-comparable">
        At least one response's body was not kept in history, so it can't be compared.
      </MessageStrip>
      <template v-else>
        <div v-if="!commonFormat" class="p-xs dim diff-raw-note">
          Comparing raw bytes — the two bodies aren't both JSON or both XML.
        </div>
        <div v-if="mergeLoading" class="diff-status p-xs dim">Loading the compare view…</div>
        <div ref="mergeHostRef" class="diff-merge-host" data-testid="http-diff-merge"></div>
      </template>
    </div>

    <template #footer>
      <span class="p-dialog-actions end">
        <AppButton kind="dialog" data-testid="http-diff-close" @click="emit('close')">Close</AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.diff-status {
  padding: var(--kira-s-4);
}

.diff-body {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.diff-summary {
  display: flex;
  align-items: center;
  gap: var(--kira-s-4);
  padding: var(--kira-s-3) var(--kira-s-4);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  flex-shrink: 0;
}

.diff-summary-side {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
}

.diff-summary-time {
  align-self: flex-start;
}

.diff-summary-col {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.diff-arrow {
  color: var(--kira-fg-muted);
}

.diff-headers {
  flex-shrink: 0;
  max-height: 160px;
  overflow: auto;
  padding: var(--kira-s-2) var(--kira-s-4);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
}

.diff-header-row {
  display: grid;
  grid-template-columns: 72px 160px 1fr 1fr;
  gap: var(--kira-s-2);
  padding: var(--kira-s-1) 0;
  font-size: var(--kira-t-xs);
}

.diff-header-head {
  color: var(--kira-fg-disabled);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.diff-header-row.added .diff-header-status {
  color: var(--kira-ok);
}

.diff-header-row.removed .diff-header-status {
  color: var(--kira-error);
}

.diff-header-row.changed .diff-header-status {
  color: var(--kira-warn);
}

.diff-header-name {
  color: var(--kira-fg-muted);
}

.diff-header-value {
  overflow-wrap: anywhere;
}

.diff-raw-note {
  flex-shrink: 0;
  padding: var(--kira-s-2) var(--kira-s-4);
}

.diff-merge-host {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.diff-merge-host :deep(.cm-mergeView) {
  height: 100%;
}
</style>
