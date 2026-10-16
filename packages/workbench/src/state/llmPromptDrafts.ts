import type { LlmPromptChange, LlmPromptProblem, LlmPromptView } from '@shared/domain/llmPrompts';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useSaveLlmPrompts } from '../llmPrompts/queries';

interface Draft {
  text: string;
  /** Hash of the effective text the draft started from; the server refuses a stale one. */
  baseHash: string;
}

// Unsaved prompt edits and their base hashes. Settings keeps one Save for the whole dialog, so the
// edits wait here until the shell's footer Save runs `save`.
export const useLlmPromptDraftsStore = defineStore('llmPromptDrafts', () => {
  const drafts = ref<Record<string, Draft>>({});
  const problems = ref<Record<string, readonly LlmPromptProblem[]>>({});

  const dirty = computed(() => Object.keys(drafts.value).length > 0);
  const valid = computed(() => Object.values(problems.value).every((list) => list.length === 0));

  function draftFor(id: string): string | undefined {
    return drafts.value[id]?.text;
  }

  /** The text the editor shows: the draft, else the saved text. */
  function textOf(view: LlmPromptView): string {
    return drafts.value[view.id]?.text ?? view.text;
  }

  /** Text equal to the saved text drops the draft. */
  function setText(view: LlmPromptView, text: string): void {
    if (text === view.text) {
      discardOne(view.id);
      return;
    }
    drafts.value[view.id] = { text, baseHash: drafts.value[view.id]?.baseHash ?? view.hash };
  }

  function setProblems(id: string, list: readonly LlmPromptProblem[]): void {
    if (list.length === 0 && !(id in problems.value)) return;
    problems.value[id] = list;
  }

  function discardOne(id: string): void {
    delete drafts.value[id];
    delete problems.value[id];
  }

  function discard(): void {
    drafts.value = {};
    problems.value = {};
  }

  /** Sends every draft as one batch; the drafts clear only when the batch is saved. */
  async function save(send: (changes: LlmPromptChange[]) => Promise<unknown>): Promise<void> {
    const changes = Object.entries(drafts.value).map(([id, d]) => ({
      id,
      text: d.text,
      baseHash: d.baseHash,
    }));
    if (changes.length === 0) return;
    await send(changes);
    discard();
  }

  return { dirty, valid, draftFor, textOf, setText, setProblems, discardOne, discard, save };
});

/** The `extra` prop SettingsShell takes: the dialog's single Save also saves prompt drafts. */
export function useLlmPromptsShellExtra() {
  const store = useLlmPromptDraftsStore();
  const saving = useSaveLlmPrompts();
  return computed(() => ({
    isDirty: store.dirty,
    isValid: store.valid,
    save: () => store.save((changes) => saving.mutateAsync(changes)),
    discard: () => store.discard(),
  }));
}
