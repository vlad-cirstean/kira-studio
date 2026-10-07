import { defineStore } from 'pinia';
import { ref } from 'vue';
import { useLayoutStore } from '../../state/layout';
import { useModeStore } from '../../state/mode';

export const useReposDialogStore = defineStore('reposDialog', () => {
  const open = ref(false);

  /** The dialog lives in the Git panel: switch to the Git module and unhide the panel first. */
  function show(): void {
    useModeStore().setMode('git');
    const layout = useLayoutStore();
    if (!layout.panel.project.visible) layout.toggleProjectPanel();
    open.value = true;
  }

  return { open, show };
});
