<script setup lang="ts">
import { shortAge } from '@ade/ago';
import { TONE_TAG_CLASS } from '@ade/tones';
import { Alert } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@theme/components/ui/empty';
import { storeToRefs } from 'pinia';
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import PermissionHint from '../components/PermissionHint.vue';
import ReplySheet from '../components/ReplySheet.vue';
import { useAuthStore } from '../state/auth';
import { newIntentKey, useAdeWrites } from '../state/useAdeWrites';
import { useAgentsModel } from '../state/useAgentsModel';

// Everything that waits on you, most urgent first. An agent waiting in its Claude Code session
// can be answered from here, or taken over when a run is stuck.
const { model, boardQuery } = useAgentsModel();
const { permissions } = storeToRefs(useAuthStore());
const writes = useAdeWrites();
const router = useRouter();

const replying = ref<{ sessionId: string; context: string } | null>(null);
const takingOver = ref<{ sessionId: string; what: string } | null>(null);
const takeOverError = ref('');
let takeOverKey = newIntentKey();

const canReply = computed(() => permissions.value.agentInput);
const needsAgentInput = computed(
  () =>
    !canReply.value &&
    !!model.value?.needs.items.some(
      (n) => n.sessionId && (n.kind === 'question' || n.kind === 'stuck run'),
    ),
);

function askTakeOver(sessionId: string, what: string): void {
  takeOverError.value = '';
  takeOverKey = newIntentKey();
  takingOver.value = { sessionId, what };
}

async function confirmTakeOver(): Promise<void> {
  const target = takingOver.value;
  if (!target) return;
  takeOverError.value = '';
  try {
    const launch = await writes.takeOver.mutateAsync({ sessionId: target.sessionId, key: takeOverKey });
    takingOver.value = null;
    void router.push({ name: 'terminal', params: { sessionId: launch.sessionId } });
  } catch (err) {
    takeOverError.value = err instanceof Error ? err.message : String(err);
  }
}
</script>

<template>
  <section class="flex flex-col" data-testid="needs-screen">
    <p v-if="boardQuery.isPending.value" class="m-0 p-4 text-muted-foreground">Loading</p>
    <Alert v-else-if="boardQuery.isError.value" variant="destructive" class="m-3 w-auto" data-testid="needs-error">
      Could not load the board.
    </Alert>
    <template v-else-if="model">
      <Empty v-if="model.needs.empty" class="py-10" data-testid="needs-empty">
        <EmptyHeader>
          <EmptyTitle>Nothing needs you</EmptyTitle>
          <EmptyDescription>{{ model.needs.footer }}</EmptyDescription>
        </EmptyHeader>
      </Empty>
      <template v-else>
        <PermissionHint v-if="needsAgentInput" what="Replying to agents is off for this phone." />
        <ul class="m-0 flex list-none flex-col p-0">
          <li
            v-for="item in model.needs.items"
            :key="item.id"
            class="flex flex-col gap-1 border-b border-border px-3 py-2.5"
            data-testid="needs-item"
            :data-kind="item.kind"
          >
            <span class="flex items-center gap-2">
              <span
                class="rounded-kira-sm px-2 py-0.5 text-kira-sm font-bold"
                :class="TONE_TAG_CLASS[item.tone]"
                >{{ item.kind }}</span
              >
              <span class="text-kira-sm text-subtle">{{ shortAge(item.ageMs) }}</span>
              <span class="ml-auto flex min-w-0 items-center gap-1.5 text-kira-sm text-subtle">
                <span
                  class="size-2 shrink-0 rounded-full"
                  :style="{ background: model.cards.get(item.taskId)?.color }"
                />
                <span class="truncate">{{ model.cards.get(item.taskId)?.title }}</span>
              </span>
            </span>
            <span class="text-kira-md text-fg">{{ item.what }}</span>
            <span v-if="item.detail" class="text-kira-sm text-muted-foreground">{{ item.detail }}</span>
            <span v-if="item.scope" class="text-kira-sm text-subtle">{{ item.scope }}</span>
            <span v-if="canReply && item.sessionId" class="flex gap-2 pt-1">
              <Button
                v-if="item.kind === 'question'"
                variant="dialog-primary"
                class="h-11 px-4"
                data-testid="needs-reply"
                @click="replying = { sessionId: item.sessionId, context: item.what }"
              >
                Reply
              </Button>
              <RouterLink
                v-if="item.kind === 'question'"
                :to="{ name: 'terminal', params: { sessionId: item.sessionId } }"
                class="flex h-11 items-center rounded-kira border border-border-strong bg-field px-4 text-kira-md text-fg no-underline"
                data-testid="needs-terminal"
              >
                Terminal
              </RouterLink>
              <Button
                v-else-if="item.kind === 'stuck run'"
                variant="dialog"
                class="h-11 px-4"
                data-testid="needs-take-over"
                @click="askTakeOver(item.sessionId, item.what)"
              >
                Take over
              </Button>
            </span>
          </li>
        </ul>
        <p class="m-0 px-3 py-2 text-kira-sm text-subtle" data-testid="needs-footer">{{ model.needs.footer }}</p>
      </template>
    </template>
    <ReplySheet
      :open="replying !== null"
      :session-id="replying?.sessionId ?? ''"
      :context="replying?.context ?? ''"
      @close="replying = null"
    />
    <ConfirmDialog
      :open="takingOver !== null"
      title="Take over?"
      :text="`${takingOver?.what ?? ''} Taking over stops the background run and continues it in Claude Code on your computer.`"
      confirm-label="Take over"
      :busy="writes.takeOver.isPending.value"
      :error="takeOverError"
      @cancel="takingOver = null"
      @confirm="confirmTakeOver"
    />
  </section>
</template>
