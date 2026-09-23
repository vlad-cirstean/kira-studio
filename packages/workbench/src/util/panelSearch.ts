import { useEventListener } from '@vueuse/core';
import { nextTick, type Ref, ref } from 'vue';

// P104 §3 (PanelShell -> inline composition): the reveal/toggle/type-ahead-redirect behaviour
// PanelShell.vue used to own, factored out so GitPanel.vue/TerminalPanel.vue/ProjectPanel.vue can
// each inline their own header markup without tripling this logic. Ported verbatim from
// PanelShell.vue's own onPanelKeydown/toggleSearch/revealSearch.
//
// P105 §5.1: the keydown listener binds here via VueUse's useEventListener against the caller's
// own root-element ref, instead of each caller wiring `@keydown` on a plain div itself (Biome's
// noStaticElementInteractions/useKeyWithClickEvents flag a non-interactive element carrying a raw
// keyboard listener; this delegated scope genuinely isn't an interactive element).
export function usePanelHeaderSearch(
  rootEl: Ref<HTMLElement | null | undefined>,
  opts: {
    searchable: () => boolean;
    getSearch: () => string;
    setSearch: (value: string) => void;
    searchTestid?: string;
  },
) {
  const testid = opts.searchTestid ?? 'tree-search';
  const showSearch = ref(false);

  function revealSearch(): void {
    if (showSearch.value) return;
    showSearch.value = true;
  }

  function toggleSearch(): void {
    showSearch.value = !showSearch.value;
    if (!showSearch.value) opts.setSearch('');
  }

  // VS Code's own file-explorer "type to search" pattern: a printable keystroke landing on the
  // panel (not already inside a field) redirects into the search box, revealing it first if hidden.
  function onPanelKeydown(e: KeyboardEvent): void {
    if (!opts.searchable()) return;
    if (e.defaultPrevented || e.isComposing) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 || e.key === ' ') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]')) return;
    const container = e.currentTarget as HTMLElement;
    e.preventDefault();
    opts.setSearch(opts.getSearch() + e.key);
    const wasHidden = !showSearch.value;
    revealSearch();
    if (wasHidden) {
      void nextTick(() =>
        container.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)?.focus(),
      );
    } else {
      container.querySelector<HTMLInputElement>(`[data-testid="${testid}"]`)?.focus();
    }
  }

  useEventListener(rootEl, 'keydown', onPanelKeydown);

  return { showSearch, toggleSearch };
}
