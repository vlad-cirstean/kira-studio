<script setup lang="ts">
import type { HttpTimelineHop } from '@shared/domain/http';
import { statusClass, statusHint } from '@shared/domain/http';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import type { HttpRequestTabRecord } from '../../state/tabDomain';
import { useHttpHistoryStore } from './history';
import { useHttpRequestViewStore } from './state';

// P10 D11/D12/D13/F18: the waterfall and the per-hop detail — a fifth response-pane segment,
// mounted here (not http/) for the same reason RawExchangePane.vue is (P9 F16): it needs
// theme/ and views/**'s own import rights, which http/** does not have (biome.json).
const props = defineProps<{ tab: HttpRequestTabRecord }>();
const httpRequestViewStore = useHttpRequestViewStore();
const httpHistoryStore = useHttpHistoryStore();

// P8 D10's own source swap, duplicated exactly as RawExchangePane.vue does — each pane computes
// its own runtime over the tab id rather than threading it down as props.
const rt = computed(() => httpRequestViewStore.runtime[props.tab.id]);
const historyRt = computed(() => httpHistoryStore.runtime[props.tab.id]);
const viewingStored = computed(() => historyRt.value?.viewing ?? null);
const response = computed(
  () => viewingStored.value?.snapshot.response ?? rt.value?.response ?? null,
);
// D10: unlike wire (P9 D7), a stored entry keeps its real timeline — there is no "no timeline for
// a stored response" empty state distinct from "no timeline at all" the way Raw has one.
const timeline = computed(() => response.value?.timeline ?? null);

// P10 D15/C5: a failed send's own partial timeline — closes P9 OQ-7. A response, live or stored,
// always takes precedence: this is only ever consulted when there is none.
const failedTimeline = computed(() => {
  if (response.value) return null;
  if (rt.value?.status !== 'error') return null;
  return rt.value.error?.timeline ?? null;
});
const activeTimeline = computed(() => timeline.value ?? failedTimeline.value);

// D13: "The request failed during {phase}." — inferred from which of the send's own measured
// phases the failed hop actually has, the same evidence the hop's own phase list already shows.
function failurePhaseText(hop: HttpTimelineHop): string {
  if (!hop.dns && !hop.connect) return 'connecting to the server';
  if (hop.connect && !hop.tls && hop.url.startsWith('https:')) return 'the TLS handshake';
  if (!hop.wait && !hop.download) return 'waiting for a response';
  return 'the download';
}

// F18's one extension to RunState.vue's own ms/s convention: a sub-millisecond figure keeps two
// decimals rather than rounding to "0 ms" — the reused-connection case this pane exists to explain
// is exactly the sub-millisecond one (D4).
function formatMs(ms: number): string {
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const summary = computed(() => {
  const tl = timeline.value;
  if (!tl) return '';
  const n = tl.hops.length;
  let text = `${n} hop${n === 1 ? '' : 's'} · ${formatMs(tl.totalMs)} total`;
  if (tl.hops[0]?.reused) text += ' · connection reused';
  return text;
});

interface PhaseSegment {
  key: 'dns' | 'connect' | 'tls' | 'wait' | 'download';
  label: string;
  colorVar: string;
}
const PHASE_SEGMENTS: readonly PhaseSegment[] = [
  { key: 'dns', label: 'DNS', colorVar: 'var(--kira-conn-violet)' },
  { key: 'connect', label: 'Connect', colorVar: 'var(--kira-conn-blue)' },
  { key: 'tls', label: 'TLS', colorVar: 'var(--kira-conn-teal)' },
  { key: 'wait', label: 'Wait', colorVar: 'var(--kira-conn-amber)' },
  { key: 'download', label: 'Download', colorVar: 'var(--kira-conn-green)' },
];
// D12: a hop whose own total is a rounding sliver of the send still renders a visible bar, so a
// sub-millisecond reused hop is seen rather than a hairline.
const MIN_BAR_PCT = 2;

function pct(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return (part / whole) * 100;
}

/** D5: the hop's own bar, offset by its StartOffsetMs inside the send's full-width track. */
function hopBarStyle(hop: HttpTimelineHop): { left: string; width: string } {
  const total = activeTimeline.value?.totalMs ?? 0;
  return {
    left: `${pct(hop.startOffsetMs, total)}%`,
    width: `${Math.max(pct(hop.totalMs, total), MIN_BAR_PCT)}%`,
  };
}

/** D5: the five phases plus a trailing, unlabelled "residue" segment for whatever time inside the
 *  hop's own total is not attributed to any of them — the CONNECT-tunnel gap F12 measured, mostly.
 *  Never padded to make the bar reach the end; the residue segment *is* the honest admission. */
function hopSegments(hop: HttpTimelineHop): Array<{ colorVar: string; widthPct: number }> {
  const total = hop.totalMs;
  const segs = PHASE_SEGMENTS.map((s) => ({
    colorVar: s.colorVar,
    widthPct: pct(hop[s.key]?.durationMs ?? 0, total),
  }));
  const measured = segs.reduce((sum, s) => sum + s.widthPct, 0);
  const residuePct = Math.max(0, 100 - measured);
  return [...segs, { colorVar: 'var(--kira-conn-grey)', widthPct: residuePct }];
}

function residueMs(hop: HttpTimelineHop): number {
  const measured =
    (hop.dns?.durationMs ?? 0) +
    (hop.connect?.durationMs ?? 0) +
    (hop.tls?.durationMs ?? 0) +
    (hop.wait?.durationMs ?? 0) +
    (hop.download?.durationMs ?? 0);
  return Math.max(0, hop.totalMs - measured);
}
function residueIsNotable(hop: HttpTimelineHop): boolean {
  return hop.totalMs > 0 && residueMs(hop) / hop.totalMs > 0.05;
}

// D13's own table, collected here so the prose is written once and can be checked against the
// measurements it cites.
function phaseTooltip(hop: HttpTimelineHop, key: PhaseSegment['key']): string {
  if (key === 'dns') {
    return hop.reused
      ? 'No DNS lookup — the connection was reused.'
      : 'No DNS lookup — the URL names an IP address.';
  }
  if (key === 'connect') return 'No TCP connect — the connection was reused.';
  if (key === 'tls') {
    return hop.reused
      ? 'No TLS handshake — the connection was reused.'
      : 'No TLS handshake — the request used plain HTTP.';
  }
  if (key === 'download') {
    return 'No download — no response bytes ever arrived.';
  }
  // wait
  return 'The server began responding before the request was fully sent, so there is no wait interval to report.';
}

function reuseNote(hop: HttpTimelineHop): string {
  if (!hop.reused) {
    if (!hop.dns && !hop.connect) return 'No DNS lookup — the URL names an IP address.';
    return '';
  }
  const idle = hop.idleMs !== undefined ? ` (idle ${formatMs(hop.idleMs)})` : '';
  return `Reused an existing connection${idle} — no DNS lookup, TCP connect or TLS handshake was needed.`;
}

function attemptsNote(hop: HttpTimelineHop): string {
  if (hop.connAttempts <= 1) return '';
  return `${hop.connAttempts} connection attempts — the first pooled connection was no longer usable.`;
}

function info1xxNote(hop: HttpTimelineHop): string {
  if (!hop.info1xx || hop.info1xx.length === 0) return '';
  return `The server sent ${hop.info1xx.join(', ')} before the final response; the wait figure ends at the first of those.`;
}

function residueNote(hop: HttpTimelineHop): string {
  if (!residueIsNotable(hop)) return '';
  return `${formatMs(residueMs(hop))} of this hop is not attributed to a phase — for a request through an HTTP proxy this is the CONNECT tunnel setup, which Go does not report separately.`;
}

// D11: a "note" that fires on the common case (a reused connection is the common case) is a
// caption, not a full-width tinted banner — up to five MessageStrips per hop could push ~180px
// of banner between a 10px bar and the next hop's caption. Same four sentences, same order, same
// testids — now p-xs dim caption lines instead of .p-strip banners.
interface HopNote {
  testid: string;
  text: string;
}
function hopNotes(hop: HttpTimelineHop): HopNote[] {
  const notes: HopNote[] = [];
  const reuse = reuseNote(hop);
  if (reuse) notes.push({ testid: 'http-timeline-reuse-note', text: reuse });
  const attempts = attemptsNote(hop);
  if (attempts) notes.push({ testid: 'http-timeline-attempts-note', text: attempts });
  const info1xx = info1xxNote(hop);
  if (info1xx) notes.push({ testid: 'http-timeline-1xx-note', text: info1xx });
  const residue = residueNote(hop);
  if (residue) notes.push({ testid: 'http-timeline-gap-note', text: residue });
  if (hop.headersElided) {
    notes.push({
      testid: 'http-timeline-headers-elided-note',
      text: 'Some response headers for this hop are not shown.',
    });
  }
  return notes;
}
</script>

<template>
  <div class="timeline-pane" data-testid="http-timeline-pane">
    <template v-if="activeTimeline && activeTimeline.hops.length > 0">
      <!-- D15: a failed send's own partial timeline — the failure sentence names the phase the
           request never got past, from the same measured phases the hop below already shows. -->
      <Alert v-if="failedTimeline" variant="destructive" data-testid="http-timeline-failure-note">
        <AlertDescription>
          The request failed during {{ failurePhaseText(failedTimeline.hops[failedTimeline.hops.length - 1]) }}.
          The steps below are what completed before it did.
        </AlertDescription>
      </Alert>
      <Alert v-else-if="viewingStored" variant="note" data-testid="http-timeline-stored-note">
        <AlertDescription>
          This timeline was recorded when the response was received.
        </AlertDescription>
      </Alert>

      <div v-if="!failedTimeline" class="timeline-summary-row">
        <div class="p-xs dim timeline-summary" data-testid="http-timeline-summary">
          {{ summary }}
        </div>
        <div class="timeline-legend p-xs dim" data-testid="http-timeline-legend">
          <span v-for="seg in PHASE_SEGMENTS" :key="seg.key" class="legend-item">
            <span class="legend-swatch" :style="{ backgroundColor: seg.colorVar }" />{{ seg.label }}
          </span>
          <span class="legend-item">
            <span class="legend-swatch bg-conn-grey" />Unattributed
          </span>
        </div>
      </div>

      <div class="timeline-hops">
        <div
          v-for="hop in activeTimeline.hops"
          :key="hop.index"
          class="timeline-hop"
          data-testid="http-timeline-hop"
        >
          <div class="hop-caption font-data" data-testid="http-timeline-hop-caption">
            <span class="hop-index">{{ hop.index + 1 }}</span>
            <span>{{ hop.method }}</span>
            <span class="hop-url">{{ hop.url }}</span>
            <span>→</span>
            <Tooltip v-if="hop.status > 0">
              <TooltipTrigger as-child>
                <span class="p-chip" :class="statusClass(hop.status)">{{ hop.status }} {{ hop.statusText }}</span>
              </TooltipTrigger>
              <TooltipContent>{{ statusHint(hop.status) }}</TooltipContent>
            </Tooltip>
            <span v-else class="p-chip err" data-testid="http-timeline-hop-failed-chip">
              {{ hop.error || 'failed' }}
            </span>
          </div>

          <div class="hop-track">
            <div class="hop-bar" :style="hopBarStyle(hop)">
              <span
                v-for="(seg, i) in hopSegments(hop)"
                :key="i"
                class="hop-segment"
                :style="{ width: `${seg.widthPct}%`, backgroundColor: seg.colorVar }"
              />
            </div>
          </div>

          <div class="hop-phases p-xs dim">
            <template v-for="seg in PHASE_SEGMENTS" :key="seg.key">
              <Tooltip v-if="!hop[seg.key]">
                <TooltipTrigger as-child>
                  <span class="hop-phase" :data-testid="`http-timeline-phase-${seg.key}`" data-present="false">
                    {{ seg.label }} —
                  </span>
                </TooltipTrigger>
                <TooltipContent>{{ phaseTooltip(hop, seg.key) }}</TooltipContent>
              </Tooltip>
              <span v-else class="hop-phase" :data-testid="`http-timeline-phase-${seg.key}`" data-present="true">
                {{ seg.label }} {{ formatMs(hop[seg.key]!.durationMs) }}
              </span>
            </template>
          </div>

          <div v-if="hopNotes(hop).length > 0" class="hop-notes p-xs dim">
            <div v-for="n in hopNotes(hop)" :key="n.testid" :data-testid="n.testid">{{ n.text }}</div>
          </div>

          <details v-if="hop.headers && hop.headers.length > 0" class="p-disclosure hop-headers">
            <summary class="p-xs dim">Response headers</summary>
            <div v-for="(h, i) in hop.headers" :key="i" class="p-kv-row hop-header-row">
              <span class="p-kv-name font-data">{{ h.name }}</span>
              <span class="p-kv-value font-data">{{ h.value }}</span>
            </div>
          </details>
          <details
            v-else-if="hop.index === activeTimeline!.hops.length - 1 && response?.headers.length"
            class="p-disclosure hop-headers"
          >
            <summary class="p-xs dim">Response headers</summary>
            <div v-for="(h, i) in response!.headers" :key="i" class="p-kv-row hop-header-row">
              <span class="p-kv-name font-data">{{ h.name }}</span>
              <span class="p-kv-value font-data">{{ h.value }}</span>
            </div>
          </details>
        </div>
      </div>
    </template>

    <Alert v-else-if="response" class="empty-state" data-testid="http-timeline-empty">
      <CodiconIcon name="watch" :size="24" class="text-subtle" />
      <AlertTitle class="text-kira-md text-muted-foreground font-normal">No timeline for this response</AlertTitle>
    </Alert>
    <Alert v-else-if="rt?.status === 'error'" class="empty-state" data-testid="http-timeline-empty">
      <CodiconIcon name="warning" :size="24" class="text-subtle" />
      <AlertTitle class="text-kira-md text-muted-foreground font-normal">This request failed before any timeline was captured</AlertTitle>
    </Alert>
    <Alert v-else class="empty-state">
      <CodiconIcon name="arrow-right" :size="24" class="text-subtle" />
      <AlertTitle class="text-kira-md text-muted-foreground font-normal">Send a request to see the response</AlertTitle>
    </Alert>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.timeline-pane {
  @apply flex flex-1 min-h-0 flex-col gap-1 overflow-auto p-1.5;
}

.timeline-summary-row {
  @apply flex items-center justify-between gap-1.5;
}

.timeline-summary {
  @apply px-0.5;
}

.timeline-hops {
  @apply flex flex-col gap-1.5;
}

.timeline-hop {
  @apply flex flex-col gap-0.5 rounded-kira border border-border p-1;
}

.hop-caption {
  @apply flex items-center gap-1 text-kira-xs;
}

.hop-index {
  @apply text-muted-foreground;
}

.hop-url {
  @apply min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap;
}

.hop-track {
  @apply relative h-3 overflow-hidden rounded-kira-sm bg-field;
}

.hop-bar {
  @apply absolute inset-y-0 flex min-w-0.5;
}

.hop-segment {
  @apply h-full;
}

.hop-phases {
  @apply flex flex-wrap gap-1.5;
}

.hop-phase[data-present='false'] {
  @apply opacity-60;
}

.hop-notes {
  @apply flex flex-col gap-0.5;
}

.hop-headers {
  @apply mt-0.5;
}

/* p-kv-row supplies display/gap/font-size; this row also carries its own vertical breathing room. */
.hop-header-row {
  @apply py-0.5;
}

.timeline-legend {
  @apply flex flex-wrap gap-1.5 px-0.5;
}

.legend-item {
  @apply inline-flex items-center gap-0.5;
}

.legend-swatch {
  @apply inline-block h-2 w-2 rounded-kira-sm;
}

.empty-state {
  @apply flex flex-1 min-h-0 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center;
}
</style>
