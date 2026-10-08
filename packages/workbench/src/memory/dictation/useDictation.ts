import type { DictationErrorCode, DictationFrame } from '@shared/domain/dictation';
import { tryOnScopeDispose, useEventListener } from '@vueuse/core';
import { storeToRefs } from 'pinia';
import { computed, nextTick, type Ref } from 'vue';
import { type DictationSession, useMemoryModule } from '../module';
import { useDictationStore } from './store';

type TextInput = HTMLInputElement | HTMLTextAreaElement;

const ERROR_TEXT: Partial<Record<DictationErrorCode, string>> = {
  busy: 'Another dictation is already running.',
  notInstalled: 'The speech model is not installed.',
};

export interface DictationTarget {
  /** Names the input in the dictation store. */
  id: string;
  model: Ref<string>;
  input: () => TextInput | null;
  maxLength?: number;
}

// P216: starts, stops and cancels one microphone session and writes its live text into `model`.
// The text goes where the caret was when dictation started; the user sends manually.
export function useDictation(target: DictationTarget) {
  const { control } = useMemoryModule();
  const store = useDictationStore();
  const { phase, level, error, active, target: activeTarget } = storeToRefs(store);

  const mine = computed(() => activeTarget.value === target.id);
  const recording = computed(() => mine.value && active.value);
  const blocked = computed(() => active.value && !mine.value);

  let session: DictationSession | null = null;
  let generation = 0;
  let before = '';
  let after = '';
  let caret = 0;

  function apply(text: string): void {
    const gapBefore = before !== '' && text !== '' && !/\s$/.test(before) ? ' ' : '';
    const gapAfter = after !== '' && text !== '' && !/^\s/.test(after) ? ' ' : '';
    let inserted = text;
    if (target.maxLength !== undefined) {
      const room =
        target.maxLength - (before.length + gapBefore.length + gapAfter.length + after.length);
      if (inserted.length > room) {
        inserted = inserted.slice(0, Math.max(0, room));
        stop();
      }
    }
    caret = (before + gapBefore + inserted).length;
    target.model.value = before + gapBefore + inserted + gapAfter + after;
  }

  function placeCaret(): void {
    const pos = caret;
    void nextTick(() => {
      const el = target.input();
      if (!el) return;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

  function onFrame(frame: DictationFrame): void {
    switch (frame.type) {
      case 'state':
        store.setPhase(frame.state, frame.level);
        break;
      case 'text':
        apply(frame.text);
        break;
      case 'final':
        apply(frame.text);
        store.end();
        placeCaret();
        break;
      case 'error':
        if (frame.text !== '') apply(frame.text);
        store.fail(ERROR_TEXT[frame.code] ?? (frame.message || 'Dictation failed.'));
        placeCaret();
        break;
    }
  }

  function onClose(): void {
    if (store.active) store.fail('Dictation stopped unexpectedly.');
    else store.end();
    session = null;
    placeCaret();
  }

  function start(): void {
    if (store.active) return;
    const el = target.input();
    const value = target.model.value;
    const from = el?.selectionStart ?? value.length;
    const to = el?.selectionEnd ?? from;
    before = value.slice(0, from);
    after = value.slice(to);
    caret = from;
    store.begin(target.id);
    const id = ++generation;
    session = control.dictationOpen({
      onFrame: (frame) => id === generation && onFrame(frame),
      onClose: () => id === generation && onClose(),
    });
  }

  function stop(): void {
    session?.stop();
  }

  /** Discards the session; text already in the input stays. */
  function cancel(): void {
    if (!session) return;
    const s = session;
    session = null;
    generation++;
    s.cancel();
    store.end();
    placeCaret();
  }

  function toggle(): void {
    if (recording.value) stop();
    else start();
  }

  // Escape stops the dictation first; the dialog or panel behind it only sees a second Escape.
  useEventListener(
    window,
    'keydown',
    (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !recording.value) return;
      e.stopPropagation();
      e.preventDefault();
      cancel();
    },
    { capture: true },
  );
  tryOnScopeDispose(() => {
    if (recording.value) cancel();
  });

  return { phase, level, error, mine, recording, blocked, start, stop, cancel, toggle };
}
