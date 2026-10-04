<script setup lang="ts">
import { computed, ref } from 'vue';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import { ACTIVITY_LABEL, ACTIVITY_RANK, type ActivityKind } from '../activity';
import { usePlanModel } from '../plan/usePlanModel';
import type { SessionView } from '../sessions/sessionView';
import { useSessionViews } from '../sessions/useSessionViews';
import AdeAllSessionRow from './AdeAllSessionRow.vue';

// Every session, grouped by task: Running or Stopped, most urgent group first (SPEC2 section 11).
const { model } = usePlanModel();
const { sessions, view } = useSessionViews();

const filter = ref<'running' | 'stopped'>('running');
const running = computed(() => sessions.value.filter((s) => s.state === 'running').length);
const stopped = computed(() => sessions.value.length - running.value);

interface Group {
  taskId: string;
  title: string;
  color: string;
  archived: boolean;
  rows: SessionView[];
}

function describe(taskId: string): Pick<Group, 'title' | 'color' | 'archived'> {
  const m = model.value;
  const card = m?.cardFor(taskId);
  if (card) return { title: card.title, color: card.color, archived: false };
  const entry = m?.board.history.find((h) => h.taskId === taskId);
  return { title: entry?.title || taskId, color: 'var(--kira-fg-subtle)', archived: true };
}

const groups = computed((): Group[] => {
  const want = filter.value === 'running';
  const byTask = new Map<string, SessionView[]>();
  for (const s of sessions.value) {
    if ((s.state === 'running') !== want) continue;
    const list = byTask.get(s.taskId) ?? [];
    list.push(view(s));
    byTask.set(s.taskId, list);
  }
  const rank = (rows: SessionView[]): number => Math.min(...rows.map((r) => ACTIVITY_RANK[r.kind]));
  return [...byTask.entries()]
    .map(([taskId, rows]) => ({
      taskId,
      ...describe(taskId),
      rows: rows.sort((a, b) => ACTIVITY_RANK[a.kind] - ACTIVITY_RANK[b.kind]),
    }))
    .sort((a, b) => rank(a.rows) - rank(b.rows));
});

const summary = computed(() => {
  if (filter.value !== 'running') return [];
  const counts = new Map<ActivityKind, number>();
  for (const s of sessions.value) {
    if (s.state !== 'running') continue;
    const k = view(s).kind;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return (['input', 'working', 'waiting'] as const)
    .filter((k) => counts.has(k))
    .map((k) => ({ kind: k, text: `${counts.get(k)} ${ACTIVITY_LABEL[k]}` }));
});

const segment = (on: boolean): string =>
  `h-7 cursor-pointer rounded-kira border-0 px-3 text-kira-md ${on ? 'bg-field font-semibold text-fg' : 'bg-transparent text-muted-foreground'}`;
</script>

<template>
  <div class="flex max-w-[1080px] flex-col gap-[18px]" data-testid="ade-all-sessions">
    <div class="flex items-center gap-3.5">
      <div class="flex rounded-kira border border-border bg-elevated p-[3px]">
        <button type="button" :class="segment(filter === 'running')" data-testid="ade-all-running" @click="filter = 'running'">
          Running {{ running }}
        </button>
        <button type="button" :class="segment(filter === 'stopped')" data-testid="ade-all-stopped" @click="filter = 'stopped'">
          Stopped {{ stopped }}
        </button>
      </div>
      <div class="flex gap-3">
        <span v-for="a in summary" :key="a.kind" class="inline-flex items-center gap-[5px] text-kira-md">
          <AdeActivityIcon :kind="a.kind" />{{ a.text }}
        </span>
      </div>
    </div>
    <section v-for="g in groups" :key="g.taskId" class="flex flex-col gap-0.5" data-testid="ade-all-group">
      <div class="mb-1 flex items-center gap-2 border-b border-border px-3 pb-1.5">
        <span class="size-2.5 shrink-0 rounded-[3px]" :style="{ background: g.color }" />
        <h3 class="m-0 truncate text-kira-lg font-semibold">{{ g.title }}</h3>
      </div>
      <AdeAllSessionRow v-for="r in g.rows" :key="r.session.id" :view="r" :archived="g.archived" />
    </section>
    <div v-if="groups.length === 0" class="p-3 text-kira-lg text-muted-foreground" data-testid="ade-all-empty">Nothing here.</div>
  </div>
</template>
