<script setup lang="ts">
import type { HttpTimelineHop } from '@shared/domain/http';
import { statusClass } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import { historyRuntime } from './history';
import { runtime } from './state';

// P10 D11/D12/D13/F18: the waterfall and the per-hop detail — a fifth response-pane segment,
// mounted here (not http/) for the same reason RawExchangePane.vue is (P9 F16): it needs
// theme/primitives/ and views/**'s own import rights, which http/** does not have (biome.json).
const props = defineProps<{ tab: HttpRequestTabRecord }>();

// P8 D10's own source swap, duplicated exactly as RawExchangePane.vue does — each pane computes
// its own runtime over the tab id rather than threading it down as props.
const rt = computed(() => runtime[props.tab.id]);
const historyRt = computed(() => historyRuntime[props.tab.id]);
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
const RESIDUE_COLOR = 'var(--kira-conn-grey)';
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
  return [...segs, { colorVar: RESIDUE_COLOR, widthPct: residuePct }];
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
</script>

<template>
  <div class="timeline-pane" data-testid="http-timeline-pane">
    <template v-if="activeTimeline && activeTimeline.hops.length > 0">
      <!-- D15: a failed send's own partial timeline — the failure sentence names the phase the
           request never got past, from the same measured phases the hop below already shows. -->
      <MessageStrip
        v-if="failedTimeline"
        tone="err"
        data-testid="http-timeline-failure-note"
      >
        The request failed during {{ failurePhaseText(failedTimeline.hops[failedTimeline.hops.length - 1]) }}.
        The steps below are what completed before it did.
      </MessageStrip>
      <MessageStrip v-else-if="viewingStored" tone="note" data-testid="http-timeline-stored-note">
        This timeline was recorded when the response was received.
      </MessageStrip>

      <div v-if="!failedTimeline" class="p-xs dim timeline-summary" data-testid="http-timeline-summary">
        {{ summary }}
      </div>

      <div class="timeline-hops">
        <div
          v-for="hop in activeTimeline.hops"
          :key="hop.index"
          class="timeline-hop"
          data-testid="http-timeline-hop"
        >
          <div class="hop-caption mono" data-testid="http-timeline-hop-caption">
            <span class="hop-index">{{ hop.index + 1 }}</span>
            <span>{{ hop.method }}</span>
            <span class="hop-url">{{ hop.url }}</span>
            <span>→</span>
            <span v-if="hop.status > 0" class="p-chip" :class="statusClass(hop.status)">
              {{ hop.status }} {{ hop.statusText }}
            </span>
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
              <span
                class="hop-phase"
                :data-testid="`http-timeline-phase-${seg.key}`"
                :data-present="hop[seg.key] ? 'true' : 'false'"
                v-tooltip="hop[seg.key] ? undefined : phaseTooltip(hop, seg.key)"
              >
                {{ seg.label }} {{ hop[seg.key] ? formatMs(hop[seg.key]!.durationMs) : '—' }}
              </span>
            </template>
          </div>

          <MessageStrip v-if="reuseNote(hop)" tone="note" data-testid="http-timeline-reuse-note">
            {{ reuseNote(hop) }}
          </MessageStrip>
          <MessageStrip v-if="attemptsNote(hop)" tone="note" data-testid="http-timeline-attempts-note">
            {{ attemptsNote(hop) }}
          </MessageStrip>
          <MessageStrip v-if="info1xxNote(hop)" tone="note" data-testid="http-timeline-1xx-note">
            {{ info1xxNote(hop) }}
          </MessageStrip>
          <MessageStrip v-if="residueNote(hop)" tone="note" data-testid="http-timeline-gap-note">
            {{ residueNote(hop) }}
          </MessageStrip>
          <MessageStrip v-if="hop.headersElided" tone="note" data-testid="http-timeline-headers-elided-note">
            Some response headers for this hop are not shown.
          </MessageStrip>

          <details v-if="hop.headers && hop.headers.length > 0" class="p-disclosure hop-headers">
            <summary class="p-xs dim">Response headers</summary>
            <div v-for="(h, i) in hop.headers" :key="i" class="p-kv-row hop-header-row">
              <span class="p-kv-name mono">{{ h.name }}</span>
              <span class="p-kv-value mono">{{ h.value }}</span>
            </div>
          </details>
          <details
            v-else-if="hop.index === activeTimeline!.hops.length - 1 && response?.headers.length"
            class="p-disclosure hop-headers"
          >
            <summary class="p-xs dim">Response headers</summary>
            <div v-for="(h, i) in response!.headers" :key="i" class="p-kv-row hop-header-row">
              <span class="p-kv-name mono">{{ h.name }}</span>
              <span class="p-kv-value mono">{{ h.value }}</span>
            </div>
          </details>
        </div>
      </div>

      <div v-if="!failedTimeline" class="timeline-legend p-xs dim" data-testid="http-timeline-legend">
        <span v-for="seg in PHASE_SEGMENTS" :key="seg.key" class="legend-item">
          <span class="legend-swatch" :style="{ backgroundColor: seg.colorVar }" />{{ seg.label }}
        </span>
        <span class="legend-item">
          <span class="legend-swatch" :style="{ backgroundColor: RESIDUE_COLOR }" />Unattributed
        </span>
      </div>
    </template>

    <EmptyState v-else-if="response" icon="watch" label="No timeline for this response" data-testid="http-timeline-empty" />
    <EmptyState
      v-else-if="rt?.status === 'error'"
      icon="warning"
      label="This request failed before any timeline was captured"
      data-testid="http-timeline-empty"
    />
    <EmptyState v-else icon="arrow-right" label="Send a request to see the response" />
  </div>
</template>

<style scoped>
.timeline-pane {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3);
}

.timeline-summary {
  padding: 0 var(--kira-s-1);
}

.timeline-hops {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
}

.timeline-hop {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
  padding: var(--kira-s-2);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
}

.hop-caption {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  font-size: var(--kira-t-xs);
}

.hop-index {
  color: var(--kira-fg-muted);
}

.hop-url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.hop-track {
  position: relative;
  height: 10px;
  background: var(--kira-bg-input);
  border-radius: var(--kira-radius-sm);
  overflow: hidden;
}

.hop-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  min-width: 2px;
}

.hop-segment {
  height: 100%;
}

.hop-phases {
  display: flex;
  flex-wrap: wrap;
  gap: var(--kira-s-3);
}

.hop-phase[data-present='false'] {
  opacity: 0.6;
}

.hop-headers {
  margin-top: var(--kira-s-1);
}

/* p-kv-row supplies display/gap/font-size; this row also carries its own vertical breathing room. */
.hop-header-row {
  padding: var(--kira-s-1) 0;
}

.timeline-legend {
  display: flex;
  flex-wrap: wrap;
  gap: var(--kira-s-3);
  padding: 0 var(--kira-s-1);
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: var(--kira-s-1);
}

.legend-swatch {
  width: 8px;
  height: 8px;
  border-radius: var(--kira-radius-sm);
  display: inline-block;
}
</style>
