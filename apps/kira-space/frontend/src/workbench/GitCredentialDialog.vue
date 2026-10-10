<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { computed, nextTick, onMounted, ref } from 'vue';
import { useGitCredentialStore } from '../state/gitCredential';

// P67e D10 / P246: git's own askpass prompt, mounted by PromptHost for the routed
// `git-credential` entry whose ref is a relay request id. Escape and the frame's close hide it in this
// window (the op keeps waiting); Cancel answers null (the op fails). The typed value lives only in `value`, cleared
// in the same statement that answers, and is never logged or persisted.
const props = defineProps<{ entry: RoutedPrompt; more: number }>();
const emit = defineEmits<{ hide: [] }>();
const store = useGitCredentialStore();
const prompt = computed(() => store.prompts.find((p) => p.requestId === props.entry.ref) ?? null);

const value = ref('');
const inputField = ref<InstanceType<typeof Input> | null>(null);

// Input.vue's own root IS the <input> element, so $el already is the real input.
onMounted(() => void nextTick(() => (inputField.value?.$el as HTMLInputElement | undefined)?.focus()));

function onSubmit(): void {
  if (!prompt.value) return;
  const secret = value.value;
  value.value = '';
  void store.answer(prompt.value.requestId, secret);
}

function onCancel(): void {
  value.value = '';
  if (prompt.value) void store.answer(prompt.value.requestId, null);
}
</script>

<template>
  <Dialog v-if="prompt" :open="true" @update:open="(v) => !v && emit('hide')">
    <DialogContent
      :show-close-button="false"
      data-testid="git-credential-dialog"
      class="flex flex-col p-0 gap-0 w-110 max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Git credentials</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="git-credential-dialog-close"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex flex-col gap-1 px-3 py-2 overflow-auto">
        <p class="m-0 text-subtle" data-testid="git-credential-repo">
          {{ prompt.source }} · {{ prompt.repoLabel }}
        </p>
        <!-- git's own text, rendered verbatim — never reformatted, never parsed. -->
        <p class="font-data whitespace-pre-wrap mb-0.5" data-testid="git-credential-prompt">
          {{ prompt.prompt }}
        </p>
        <Input
          ref="inputField"
          v-model="value"
          :type="prompt.masked ? 'password' : 'text'"
          class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
          data-testid="git-credential-input"
          @keydown.enter="onSubmit"
        />
      </div>

      <DialogFooter>
        <span v-if="more > 0" class="mr-auto text-kira-sm text-muted-foreground" data-testid="git-credential-more">
          {{ more }} more waiting
        </span>
        <span class="flex items-center gap-1 ml-auto">
          <Button variant="dialog" size="kira-lg" data-testid="git-credential-cancel" @click="onCancel">
            Cancel
          </Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="git-credential-submit"
            @click="onSubmit"
          >
            Continue
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
