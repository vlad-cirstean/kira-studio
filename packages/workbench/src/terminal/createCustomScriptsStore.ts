import type {
  CustomScript,
  CustomScriptFields,
  QuickCommandsSnapshot,
  ScriptCollection,
} from '@shared/domain/scripts';
import { defineStore } from 'pinia';
import { reactive, toRefs } from 'vue';
import { hydrateThenSubscribe } from '../state/hydrateThenSubscribe';

// The quick-command store both apps define from their own `control` calls (createKeepAwakeStore's
// precedent). A snapshot broadcast replaces `collections` and `records` wholesale, so a command added in one
// window shows up in every other.
export interface CustomScriptsControl {
  customScriptsList(): Promise<QuickCommandsSnapshot>;
  customScriptsCreate(fields: CustomScriptFields): Promise<CustomScript>;
  customScriptsUpdate(id: string, fields: CustomScriptFields): Promise<CustomScript>;
  customScriptsRemove(id: string): Promise<void>;
  customScriptsCreateCollection(name: string): Promise<ScriptCollection>;
  customScriptsRenameCollection(id: string, name: string): Promise<void>;
  customScriptsDeleteCollection(id: string): Promise<void>;
  customScriptsMove(id: string, collectionId: string | null): Promise<void>;
  onCustomScriptsChanged(cb: (snapshot: QuickCommandsSnapshot) => void): () => void;
}

/** A Go nil slice crosses the bridge as null; coerce both arrays so the store always holds arrays. */
export function quickCommandsSnapshotOf(raw: unknown): QuickCommandsSnapshot {
  const r = (raw ?? {}) as Partial<QuickCommandsSnapshot>;
  return { collections: r.collections ?? [], scripts: r.scripts ?? [] };
}

export function createCustomScriptsStore(control: CustomScriptsControl) {
  return defineStore('customScripts', () => {
    const state = reactive({
      collections: [] as ScriptCollection[],
      records: [] as CustomScript[],
    });

    let unsubscribe: (() => void) | null = null;

    async function hydrateCustomScripts(): Promise<void> {
      unsubscribe?.();
      unsubscribe = null;
      unsubscribe = await hydrateThenSubscribe({
        snapshot: () => control.customScriptsList(),
        subscribe: (cb) => control.onCustomScriptsChanged(cb),
        apply: (snapshot) => {
          state.collections = snapshot.collections;
          state.records = snapshot.scripts;
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

    function createCollection(name: string): Promise<ScriptCollection> {
      return control.customScriptsCreateCollection(name);
    }

    async function renameCollection(id: string, name: string): Promise<void> {
      await control.customScriptsRenameCollection(id, name);
    }

    async function removeCollection(id: string): Promise<void> {
      await control.customScriptsDeleteCollection(id);
    }

    async function moveScript(id: string, collectionId: string | null): Promise<void> {
      await control.customScriptsMove(id, collectionId);
    }

    return {
      ...toRefs(state),
      hydrateCustomScripts,
      createCustomScript,
      updateCustomScript,
      removeCustomScript,
      createCollection,
      renameCollection,
      removeCollection,
      moveScript,
    };
  });
}
