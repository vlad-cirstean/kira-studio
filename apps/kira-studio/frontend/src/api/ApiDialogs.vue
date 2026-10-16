<script setup lang="ts">
// P12 D9/F19: the module's own front door for the host — App.vue used to import all seven of
// these dialogs and their five store bindings individually (eleven import lines); this is that
// list, once, so App.vue's own knowledge of the module shrinks to one component. Each dialog still
// guards itself on its own store's `open` flag exactly as before — this is a template-only
// reduction, not a behaviour change.
import CopyAsCurlDialog from './CopyAsCurlDialog.vue';
import DynamicValuesDialog from './DynamicValuesDialog.vue';
import EditRawRequestDialog from './EditRawRequestDialog.vue';
import ImportCurlDialog from './ImportCurlDialog.vue';
import SaveRequestDialog from './SaveRequestDialog.vue';
import { useCopyAsCurlStore, useImportCurlStore } from './state/curl';
import { useDynamicValuesStore } from './state/dynamicValues';
import { useEditRawStore } from './state/raw';
import { useSaveRequestDialogStore } from './state/saveRequestDialog';

const dynamicValuesStore = useDynamicValuesStore();
const editRawStore = useEditRawStore();
const saveRequestDialogStore = useSaveRequestDialogStore();
const importCurlStore = useImportCurlStore();
const copyAsCurlStore = useCopyAsCurlStore();
</script>

<template>
  <SaveRequestDialog v-if="saveRequestDialogStore.open" />
  <DynamicValuesDialog v-if="dynamicValuesStore.open" />
  <ImportCurlDialog v-if="importCurlStore.open" />
  <CopyAsCurlDialog v-if="copyAsCurlStore.open" />
  <EditRawRequestDialog v-if="editRawStore.open" />
</template>
