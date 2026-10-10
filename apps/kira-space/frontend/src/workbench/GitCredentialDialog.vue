<script setup lang="ts">
import type { RoutedPrompt } from '@shared/domain/prompts';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
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
    <DialogContent size="sm" data-testid="git-credential-dialog">
      <DialogHeader closable close-testid="git-credential-dialog-close">
        <DialogTitle>Git credentials</DialogTitle>
      </DialogHeader>

      <DialogBody>
        <p class="m-0 text-subtle" data-testid="git-credential-repo">
          {{ prompt.source }} · {{ prompt.repoLabel }}
        </p>
        <!-- git's own text, rendered verbatim — never reformatted, never parsed. -->
        <p class="m-0 font-data whitespace-pre-wrap" data-testid="git-credential-prompt">
          {{ prompt.prompt }}
        </p>
        <Input
          ref="inputField"
          v-model="value"
          :type="prompt.masked ? 'password' : 'text'"
          class="w-full font-data"
          data-testid="git-credential-input"
          @keydown.enter="onSubmit"
        />
      </DialogBody>

      <DialogFooter>
        <template v-if="more > 0" #start>
          <span class="text-kira-sm text-muted-foreground" data-testid="git-credential-more">
            {{ more }} more waiting
          </span>
        </template>
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
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
