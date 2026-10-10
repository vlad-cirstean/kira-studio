<script setup lang="ts">
import type { MemoryClarification, MemoryStoreResult } from '@shared/domain/memory';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Label } from '@theme/components/ui/label';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, reactive, ref } from 'vue';
import { useStoreMemory } from './queries';
import { useMemoryUiStore } from './store';

// P214: free-text Add memory through the MCP store_memory gate. A challenge stores nothing; answer or edit, resubmit.
const emit = defineEmits<{ close: [] }>();
const ui = useMemoryUiStore();
const store = useStoreMemory();

const MAX_TEXT = 1000;
const MANUAL_REASON = 'Stated by the user, added manually in the Memory module.';
const text = ref('');
const result = ref<MemoryStoreResult | null>(null);
const answers = reactive<Record<string, string>>({});
const asked = ref<MemoryClarification[]>([]);
let controller: AbortController | null = null;

const busy = computed(() => store.isPending.value);
const challenged = computed(() => result.value?.status === 'challenged');
const stored = computed(() => result.value?.status === 'stored');
const canSubmit = computed(() => !busy.value && text.value.trim() !== '');

function answerKey(index: number, q: number): string {
  return `${index}:${q}`;
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
      items: [{ fact: text.value.trim(), reason: MANUAL_REASON }],
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
    <DialogContent size="lg" data-testid="add-memory-dialog">
      <DialogHeader closable>
        <DialogTitle>Add memory</DialogTitle>
      </DialogHeader>
      <DialogBody>
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
          <div class="flex flex-col gap-1">
            <Label for="memory-text">What should be remembered?</Label>
            <Textarea
              id="memory-text"
              v-model="text"
              :disabled="busy"
              :maxlength="MAX_TEXT"
              placeholder="Facts in your own words; Claude splits and checks them"
              data-testid="add-memory-text"
            />
            <span class="self-end text-kira-sm text-muted-foreground" data-testid="add-memory-count">{{ text.length }} / {{ MAX_TEXT }}</span>
            <template v-if="challenged">
              <div
                v-for="c in result?.challenges.filter((x) => x.index === 0)"
                :key="c.index"
                class="flex flex-col gap-1 rounded-kira-sm bg-warn/10 p-1.5"
                data-testid="add-memory-challenge"
              >
                <div v-for="(question, q) in c.questions" :key="q" class="flex flex-col gap-0.5">
                  <Label :for="`memory-answer-${q}`">{{ question }}</Label>
                  <Textarea :id="`memory-answer-${q}`" v-model="answers[answerKey(c.index, q)]" :disabled="busy" placeholder="Your answer" data-testid="add-memory-answer" />
                </div>
              </div>
            </template>
          </div>
          <p v-if="busy" class="m-0 text-kira-sm text-muted-foreground" data-testid="add-memory-busy">Checking with Claude…</p>
        </template>
      </DialogBody>
      <DialogFooter>
        <template v-if="stored">
          <Button variant="dialog-primary" size="kira-lg" data-testid="add-memory-done" @click="emit('close')">Done</Button>
        </template>
        <template v-else>
          <Button v-if="busy" variant="dialog" size="kira-lg" data-testid="add-memory-cancel" @click="cancel">Cancel</Button>
          <Button v-else variant="dialog" size="kira-lg" @click="emit('close')">Close</Button>
          <Button variant="dialog-primary" size="kira-lg" :disabled="!canSubmit" data-testid="add-memory-submit" @click="submit">
            {{ challenged ? 'Resubmit' : 'Add' }}
          </Button>
        </template>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
