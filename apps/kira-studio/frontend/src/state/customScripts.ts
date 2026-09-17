import type { CustomScript, CustomScriptFields } from '@shared/domain/scripts';
import { reactive } from 'vue';
import { control } from '../bridge/control';

// P85 §9.3: state/, not repo/state/ — TabStrip.vue (workbench/) and SettingsDialog.vue
// (workbench/) both read this, the same layering argument state/terminals.ts's own header
// comment makes for P83.

export const customScriptsState = reactive({ records: [] as CustomScript[] });

let unsubscribeChanged: (() => void) | null = null;

// main.ts's boot Promise.all, beside hydrateCodeRepos(). Installs a control.onCustomScriptsChanged
// subscription that replaces records wholesale — state/settings.ts's hydrateSettings/
// onSettingsChanged pair, verbatim in shape, and connections.ts's own onConnectionsChanged is the
// precedent for why this is needed at all: without it, a script added in one window never appears
// in another window's dropdown.
export async function hydrateCustomScripts(): Promise<void> {
  customScriptsState.records = await control.customScriptsList();

  unsubscribeChanged?.();
  unsubscribeChanged = control.onCustomScriptsChanged((records) => {
    customScriptsState.records = records;
  });
}

export async function createCustomScript(fields: CustomScriptFields): Promise<void> {
  await control.customScriptsCreate(fields);
}

export async function updateCustomScript(id: string, fields: CustomScriptFields): Promise<void> {
  await control.customScriptsUpdate(id, fields);
}

export async function removeCustomScript(id: string): Promise<void> {
  await control.customScriptsRemove(id);
}
