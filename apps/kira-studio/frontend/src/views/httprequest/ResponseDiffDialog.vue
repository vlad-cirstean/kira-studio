<script setup lang="ts">
import { statusClass, statusHint } from '@shared/domain/http';
import type { ResponseHistorySnapshot } from '@shared/domain/response-history';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import DialogFrame from '@theme/primitives/DialogFrame.vue';
import { KIRA_EDITOR_THEME, loadMonaco } from '@workbench/editor/monaco';
import { formatBytes, formatRelative } from '@workbench/util/format';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { type BeautifyResult, beautifyJson, beautifyXml } from '../../beautify';
import { control } from '../../bridge/control';
import { monacoLanguageIdFor } from '../../editor/monacoLanguages';

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
type DiffEditor = import('monaco-editor').editor.IStandaloneDiffEditor;
type TextModel = import('monaco-editor').editor.ITextModel;
let diffEditor: DiffEditor | null = null;
let originalModel: TextModel | null = null;
let modifiedModel: TextModel | null = null;

function disposeMergeView(): void {
  diffEditor?.dispose();
  diffEditor = null;
  originalModel?.dispose();
  originalModel = null;
  modifiedModel?.dispose();
  modifiedModel = null;
}

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

interface DetectedBody {
  format: 'json' | 'xml' | null;
  result: BeautifyResult | null;
}

// Round-2 review finding 8: beautifyJson/beautifyXml run the exact same parse scanJson/scanXml
// would — detected once per body here (memoized by `computed` below) and reused by both
// commonFormat's own detection and bodyTextA/B's rendering, instead of parsing each body twice.
// The `<…>` bracket check mirrors ResponsePane.vue's own (and celleditor/detect.ts's own
// detectXml gate): an XML parse alone accepts plain text with no tags at all, so without it every
// plain-text response would misreport as XML.
function detectAndBeautify(body: string): DetectedBody {
  const json = beautifyJson(body, 'indented');
  if (json.ok) return { format: 'json', result: json };
  const t = body.trim();
  if (t.length > 0 && t[0] === '<' && t[t.length - 1] === '>') {
    const xml = beautifyXml(body, 'indented');
    if (xml.ok) return { format: 'xml', result: xml };
  }
  return { format: null, result: null };
}

const detectedA = computed<DetectedBody | null>(() =>
  snapA.value ? detectAndBeautify(snapA.value.response.body) : null,
);
const detectedB = computed<DetectedBody | null>(() =>
  snapB.value ? detectAndBeautify(snapB.value.response.body) : null,
);

// D12: both bodies are pretty-printed before diffing only when *both* are the same recognised
// format — a minified-vs-minified diff of two 40 KB single lines tells the user nothing.
// beautifyJson(text, 'indented') is lossless by construction (P2 F13), so this never
// misrepresents what came back.
const commonFormat = computed<'json' | 'xml' | null>(() => {
  const a = detectedA.value?.format ?? null;
  const b = detectedB.value?.format ?? null;
  return a && a === b ? a : null;
});

const bodyTextA = computed(() => {
  if (!snapA.value) return '';
  return commonFormat.value && detectedA.value?.result
    ? detectedA.value.result.text
    : snapA.value.response.body;
});
const bodyTextB = computed(() => {
  if (!snapB.value) return '';
  return commonFormat.value && detectedB.value?.result
    ? detectedB.value.result.text
    : snapB.value.response.body;
});

// D12 level 2: the headers table. Reduced to added/removed/changed/unchanged by header *name*
// (case-insensitive) rather than by the diff editor's own text-diff — headers are a keyed
// structure, not ordered prose, so a name-keyed comparison is the semantically correct model (it
// stays right even when two servers emit the same headers in a different order) and needs no
// diff algorithm of its own. Monaco's diff editor (P60a) is exactly what the body level below is
// for.
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

// D12 level 3 / P60a §6: the real payoff of Monaco's diff editor — a scroll-locked,
// line-aligned, intra-line-highlighted side-by-side view. Both sides read-only (§6's own recipe,
// the same second-layer guard RepoDiffView.vue's review diff already uses: readOnly alone blocks
// edits, renderMarginRevertIcon/renderGutterMenu additionally hide the revert/apply affordances a
// read-write diff widget would otherwise offer).
async function buildMergeView(): Promise<void> {
  if (!bothStored.value || !snapA.value || !snapB.value) return;
  mergeLoading.value = true;
  const mod = await loadMonaco();
  mergeLoading.value = false;
  disposeMergeView();
  await nextTick();
  if (!mergeHostRef.value) return;
  const languageId = monacoLanguageIdFor(commonFormat.value ?? 'plain');
  originalModel = mod.editor.createModel(bodyTextA.value, languageId);
  modifiedModel = mod.editor.createModel(bodyTextB.value, languageId);
  diffEditor = mod.editor.createDiffEditor(mergeHostRef.value, {
    theme: KIRA_EDITOR_THEME,
    readOnly: true,
    domReadOnly: true,
    originalEditable: false,
    renderMarginRevertIcon: false,
    renderGutterMenu: false,
    automaticLayout: true,
    renderSideBySide: true,
    renderIndicators: true,
    hideUnchangedRegions: { enabled: true },
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
  });
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });
  // tests/ui's own text-reading seam (P60a §9.1/OQ-3) — both models are static once created (this
  // dialog never edits them), so a one-time attribute set here (rather than a change listener,
  // MonacoHost.vue's own approach) is enough. The diff editor's two sides are plain Monaco
  // sub-editors, not a MonacoHost mount, so they carry no `data-kira-editor-text` of their own.
  if (__KIRA_DEBUG_HOOKS__ && mergeHostRef.value) {
    mergeHostRef.value.setAttribute('data-kira-diff-original-text', originalModel.getValue());
    mergeHostRef.value.setAttribute('data-kira-diff-modified-text', modifiedModel.getValue());
  }
}

watch(
  () => loadingSnapshots.value,
  (loading) => {
    if (!loading && bothStored.value) void buildMergeView();
  },
);

onUnmounted(() => {
  disposeMergeView();
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
    <Alert v-else-if="loadError" variant="destructive"><AlertDescription>{{ loadError }}</AlertDescription></Alert>
    <div v-else-if="snapA && snapB" class="diff-body">
      <div class="diff-summary" data-testid="http-diff-summary">
        <div class="diff-summary-side">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="p-xs dim diff-summary-time">{{ formatRelative(snapA.entry.sentAt) }}</span>
            </TooltipTrigger>
            <TooltipContent>{{ snapA.entry.sentAt }}</TooltipContent>
          </Tooltip>
          <div class="diff-summary-col">
            <Tooltip>
              <TooltipTrigger as-child>
                <span class="p-chip" :class="statusClass(snapA.entry.status)" data-testid="http-diff-status-a">
                  {{ snapA.entry.status }} {{ snapA.entry.statusText }}
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ statusHint(snapA.entry.status) }}</TooltipContent>
            </Tooltip>
            <span class="p-xs dim">{{ snapA.entry.elapsedMs }} ms</span>
            <span class="p-xs dim">{{ formatBytes(snapA.entry.bodyBytes) }}</span>
          </div>
        </div>
        <span class="diff-arrow">→</span>
        <div class="diff-summary-side">
          <Tooltip>
            <TooltipTrigger as-child>
              <span class="p-xs dim diff-summary-time">{{ formatRelative(snapB.entry.sentAt) }}</span>
            </TooltipTrigger>
            <TooltipContent>{{ snapB.entry.sentAt }}</TooltipContent>
          </Tooltip>
          <div class="diff-summary-col">
            <Tooltip>
              <TooltipTrigger as-child>
                <span class="p-chip" :class="statusClass(snapB.entry.status)" data-testid="http-diff-status-b">
                  {{ snapB.entry.status }} {{ snapB.entry.statusText }}
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ statusHint(snapB.entry.status) }}</TooltipContent>
            </Tooltip>
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

      <Alert v-if="!bothStored" class="strip-note" data-testid="http-diff-not-comparable">
        <AlertDescription class="strip-note-text">
          At least one response's body was not kept in history, so it can't be compared.
        </AlertDescription>
      </Alert>
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
        <Button variant="dialog" size="kira" data-testid="http-diff-close" @click="emit('close')">Close</Button>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
@reference "@theme/base.css";

.diff-status {
  @apply p-2;
}

.diff-body {
  @apply flex h-full min-h-0 flex-col;
}

.diff-summary {
  @apply flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5;
}

.diff-summary-side {
  @apply flex flex-col gap-0.5;
}

.diff-summary-time {
  @apply self-start;
}

.diff-summary-col {
  @apply flex items-center gap-1;
}

.diff-arrow {
  @apply text-muted;
}

.diff-headers {
  @apply max-h-[160px] shrink-0 overflow-auto border-b border-border px-2 py-1;
}

.diff-header-row {
  grid-template-columns: 72px 160px 1fr 1fr;
  @apply grid gap-1 py-0.5 text-kira-xs;
}

.diff-header-head {
  @apply text-subtle uppercase tracking-[0.05em];
}

.diff-header-row.added .diff-header-status {
  @apply text-ok;
}

.diff-header-row.removed .diff-header-status {
  @apply text-error;
}

.diff-header-row.changed .diff-header-status {
  @apply text-warn;
}

.diff-header-name {
  @apply text-muted;
}

.diff-header-value {
  @apply [overflow-wrap:anywhere];
}

.diff-raw-note {
  @apply shrink-0 px-2 py-1;
}

.diff-merge-host {
  @apply flex-1 min-h-0 overflow-auto;
}

.diff-merge-host :deep(.monaco-diff-editor) {
  @apply h-full;
}

/* Alert tone class replacing the raw MessageStrip note marker (P104 §9 rule 5: literal hex, not a
   --kira-* token, so kept as-is rather than converted through §7.1's scale). */
.strip-note {
  @apply bg-info/8 border-info/20;
}
.strip-note-text {
  @apply text-[#a8c8ee];
}
</style>
