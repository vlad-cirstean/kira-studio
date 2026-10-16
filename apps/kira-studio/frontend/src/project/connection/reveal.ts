import { t } from '@theme/i18n';
import { computed, type InjectionKey, inject, ref, watch } from 'vue';
import { useConnectionDialogStore } from '../../state/connections';
import { revealConnectionSecret } from '../state/connectionReveal';

/** Password and URI visibility. Held above the tabs so it survives a tab switch. */
export function useConnectionReveal() {
  const store = useConnectionDialogStore();
  const isEdit = computed(() => store.mode === 'edit');

  const showPassword = ref(false);
  // A brand-new connection has no stored secret to fetch: what is typed is already revealed.
  // An existing one stays masked until the eye fetches the real secret, gated by local auth.
  const revealed = ref(!isEdit.value);

  // The dialog stays mounted across a draft swap, so reset on a genuinely new draft only.
  watch(
    () => store.draft,
    () => {
      revealed.value = !isEdit.value;
      showPassword.value = false;
    },
  );

  // `target`/`editingId` pin the draft this reveal was requested for; revealConnectionSecret
  // re-checks stillCurrent after every await so a reveal never lands in a different draft.
  async function requestReveal(id: string): Promise<void> {
    const target = store.draft;
    const targetEditingId = store.editingId;
    const stillCurrent = (): boolean =>
      store.draft === target && store.editingId === targetEditingId;

    const result = await revealConnectionSecret(
      id,
      target?.name || t('studio.project.connectionDialog.unnamed.label'),
      target?.mode === 'uri' ? 'uri' : 'fields',
      stillCurrent,
    );
    if (!result) return;
    if (result.outcome === 'error') {
      store.error = result.error;
      return;
    }
    if (target) {
      target.password = result.password;
      if (result.uri !== null) target.uri = result.uri;
    }
    revealed.value = true;
    showPassword.value = true;
  }

  // Not revealed: the eye is the reveal action. Revealed (or never gated): a local mask toggle.
  function onEyeClick(): void {
    if (revealed.value) {
      showPassword.value = !showPassword.value;
      return;
    }
    if (store.editingId) void requestReveal(store.editingId);
  }

  // Typing replaces the masked value, so a deferred reveal must not clobber it afterwards.
  function onPasswordInput(value: string): void {
    if (store.draft) store.draft.password = value;
    revealed.value = true;
  }

  function setUri(value: string): void {
    if (!store.draft) return;
    store.draft.uri = value;
    revealed.value = true;
  }

  return { showPassword, revealed, onEyeClick, onPasswordInput, setUri };
}

export type ConnectionReveal = ReturnType<typeof useConnectionReveal>;
export const CONNECTION_REVEAL_KEY: InjectionKey<ConnectionReveal> = Symbol('connectionReveal');

export function injectConnectionReveal(): ConnectionReveal {
  const reveal = inject(CONNECTION_REVEAL_KEY);
  if (!reveal) throw new Error('connection reveal not provided');
  return reveal;
}
