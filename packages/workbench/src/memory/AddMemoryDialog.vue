<script setup lang="ts">
import type { MemoryClarification, MemoryStoreResult } from '@shared/domain/memory';
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Label } from '@theme/components/ui/label';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, reactive, ref } from 'vue';
import { useStoreMemory } from './queries';
import { useMemoryUiStore } from './store';

// P201: Add memory — the same gate/reconcile flow the MCP store_memory tool runs. A challenge
// stores nothing; the user answers (or edits the rows) and resubmits with clarifications.
const emit = defineEmits<{ close: [] }>();
const ui = useMemoryUiStore();
const store = useStoreMemory();

const MAX_ROWS = 20;
const rows = ref([{ fact: '', reason: '' }]);
const result = ref<MemoryStoreResult | null>(null);
const answers = reactive<Record<string, string>>({});
const asked = ref<MemoryClarification[]>([]);
let controller: AbortController | null = null;

const busy = computed(() => store.isPending.value);
const challenged = computed(() => result.value?.status === 'challenged');
const stored = computed(() => result.value?.status === 'stored');
const canSubmit = computed(() => !busy.value && rows.value.every((r) => r.fact.trim() !== ''));

function answerKey(index: number, q: number): string {
  return `${index}:${q}`;
}

function addRow(): void {
  if (rows.value.length < MAX_ROWS) rows.value.push({ fact: '', reason: '' });
}

function removeRow(i: number): void {
  rows.value.splice(i, 1);
}

async function submit(): Promise<void> {
  const clarifications = [...asked.value];
  for (const c of result.value?.challenges ?? []) {
    c.questions.forEach((question, q) => {
      const answer = (answers[answerKey(c.index, q)] ?? '').trim();
      if (answer !== '') clarifications.push({ question, answer });
    });
  }
  controller = new AbortController();
  try {
    const res = await store.mutateAsync({
      items: rows.value.map((r) => ({ fact: r.fact.trim(), reason: r.reason.trim() })),
      clarifications,
      signal: controller.signal,
    });
    asked.value = clarifications;
    result.value = res;
  } catch {
    // Surfaced through store.error; an aborted call needs nothing.
  } finally {
    controller = null;
  }
}

function cancel(): void {
  controller?.abort();
  store.reset();
}

function actionLabel(o: MemoryStoreResult['outcomes'][number]): string {
  switch (o.action) {
    case 'add':
      return 'Added';
    case 'update':
      return `Updated v${o.version - 1} to v${o.version}`;
    case 'noop':
      return 'Already known';
    default:
      return `Failed: ${o.error}`;
  }
}

function select(id: string): void {
  if (id === '') return;
  ui.selectedId = id;
  emit('close');
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('close')">
    <DialogContent :show-close-button="false" data-testid="add-memory-dialog" class="flex flex-col p-0 gap-0 w-150 max-h-4/5">
      <DialogHeader>
        <DialogTitle>Add memory</DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-2 overflow-auto p-3">
        <Alert v-if="store.isError.value" variant="destructive" data-testid="add-memory-error">
          <AlertDescription>{{ store.error.value?.message }}</AlertDescription>
        </Alert>

        <template v-if="stored && result">
          <ul class="m-0 flex list-none flex-col gap-1 p-0" data-testid="add-memory-outcomes">
            <li v-for="(o, i) in result.outcomes" :key="i" class="flex flex-col gap-0.5 rounded-kira-sm border border-border p-1.5">
              <span class="text-kira-sm text-muted-foreground" :data-testid="`add-memory-outcome-${i}`">{{ actionLabel(o) }}</span>
              <button
                v-if="o.action !== 'failed'"
                type="button"
                class="cursor-default border-0 bg-transparent p-0 text-left text-kira-md hover:underline"
                @click="select(o.id)"
              >{{ o.fact }}</button>
              <span v-else class="text-kira-md">{{ o.fact }}</span>
            </li>
          </ul>
        </template>

        <template v-else>
          <div v-for="(row, i) in rows" :key="i" class="flex flex-col gap-1 border-b border-border pb-2" :data-testid="`add-memory-row-${i}`">
            <div class="flex items-center">
              <Label :for="`memory-fact-${i}`">Fact</Label>
              <TooltipIconButton
                v-if="rows.length > 1"
                icon="trash"
                label="Remove"
                class="ml-auto"
                :disabled="busy"
                @click="removeRow(i)"
              />
            </div>
            <Textarea :id="`memory-fact-${i}`" v-model="row.fact" :disabled="busy" placeholder="One durable fact" data-testid="add-memory-fact" />
            <Label :for="`memory-reason-${i}`">Reason</Label>
            <Textarea :id="`memory-reason-${i}`" v-model="row.reason" :disabled="busy" placeholder="Why it is true" data-testid="add-memory-reason" />
            <template v-if="challenged">
              <div
                v-for="c in result?.challenges.filter((x) => x.index === i)"
                :key="c.index"
                class="flex flex-col gap-1 rounded-kira-sm bg-warn/10 p-1.5"
                data-testid="add-memory-challenge"
              >
                <div v-for="(question, q) in c.questions" :key="q" class="flex flex-col gap-0.5">
                  <Label :for="`memory-answer-${i}-${q}`">{{ question }}</Label>
                  <Textarea :id="`memory-answer-${i}-${q}`" v-model="answers[answerKey(c.index, q)]" :disabled="busy" placeholder="Your answer" data-testid="add-memory-answer" />
                </div>
              </div>
            </template>
          </div>
          <Button variant="dialog" size="kira-lg" class="self-start" :disabled="busy || rows.length >= MAX_ROWS" @click="addRow">
            <CodiconIcon name="add" :size="12" /> Add another
          </Button>
          <p v-if="busy" class="m-0 text-kira-sm text-muted-foreground" data-testid="add-memory-busy">Checking with Claude…</p>
        </template>
      </div>
      <DialogFooter>
        <template v-if="stored">
          <Button variant="dialog-primary" size="kira-lg" class="ml-auto" data-testid="add-memory-done" @click="emit('close')">Done</Button>
        </template>
        <template v-else>
          <Button v-if="busy" variant="dialog" size="kira-lg" data-testid="add-memory-cancel" @click="cancel">Cancel</Button>
          <Button v-else variant="dialog" size="kira-lg" @click="emit('close')">Close</Button>
          <Button variant="dialog-primary" size="kira-lg" class="ml-auto" :disabled="!canSubmit" data-testid="add-memory-submit" @click="submit">
            {{ challenged ? 'Resubmit' : 'Add' }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
