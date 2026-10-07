import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { hydrateThenSubscribe } from '../state/hydrateThenSubscribe';

// The quick-command store both apps define from their own `control` calls (createKeepAwakeStore's
// precedent). A list-changed broadcast replaces `records` wholesale, so a command added in one
// window shows up in every other.
export interface CustomScriptsControl {
  customScriptsList(): Promise<CustomScript[]>;
  customScriptsCreate(fields: CustomScriptFields): Promise<CustomScript>;
  customScriptsUpdate(id: string, fields: CustomScriptFields): Promise<CustomScript>;
  customScriptsRemove(id: string): Promise<void>;
  onCustomScriptsChanged(cb: (scripts: CustomScript[]) => void): () => void;
}

export function createCustomScriptsStore(control: CustomScriptsControl) {
  return defineStore('customScripts', () => {
    const state = reactive({ records: [] as CustomScript[] });

    let unsubscribe: (() => void) | null = null;

    async function hydrateCustomScripts(): Promise<void> {
      unsubscribe?.();
      unsubscribe = null;
      unsubscribe = await hydrateThenSubscribe({
        snapshot: () => control.customScriptsList(),
        subscribe: (cb) => control.onCustomScriptsChanged(cb),
        apply: (records) => {
          state.records = records;
        },
      });
    }

    async function createCustomScript(fields: CustomScriptFields): Promise<void> {
      await control.customScriptsCreate(fields);
    }

    async function updateCustomScript(id: string, fields: CustomScriptFields): Promise<void> {
      await control.customScriptsUpdate(id, fields);
    }

    async function removeCustomScript(id: string): Promise<void> {
      await control.customScriptsRemove(id);
    }

    return {
      ...toRefs(state),
      hydrateCustomScripts,
      createCustomScript,
      updateCustomScript,
      removeCustomScript,
    };
  });
}
