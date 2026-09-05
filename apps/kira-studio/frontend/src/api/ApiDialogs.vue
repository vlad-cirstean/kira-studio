<script setup lang="ts">
// P12 D9/F19: the module's own front door for the host — App.vue used to import all seven of
// these dialogs and their five store bindings individually (eleven import lines); this is that
// list, once, so App.vue's own knowledge of the module shrinks to one component. Each dialog still
// guards itself on its own store's `open` flag exactly as before — this is a template-only
// reduction, not a behaviour change.
import CopyAsCurlDialog from './CopyAsCurlDialog.vue';
import DynamicValuesDialog from './DynamicValuesDialog.vue';
import EditRawRequestDialog from './EditRawRequestDialog.vue';
import EnvironmentsDialog from './EnvironmentsDialog.vue';
import ImportCurlDialog from './ImportCurlDialog.vue';
import SaveRequestDialog from './SaveRequestDialog.vue';
import { saveDialogState } from './state/collections';
import { copyAsCurlDialogState, importCurlDialogState } from './state/curl';
import { dynamicValuesDialogState } from './state/dynamicValues';
import { editRawDialogState } from './state/raw';
import { environmentsDialogState } from './state/variables';
</script>

<template>
  <SaveRequestDialog v-if="saveDialogState.open" />
  <EnvironmentsDialog v-if="environmentsDialogState.open" />
  <DynamicValuesDialog v-if="dynamicValuesDialogState.open" />
  <ImportCurlDialog v-if="importCurlDialogState.open" />
  <CopyAsCurlDialog v-if="copyAsCurlDialogState.open" />
  <EditRawRequestDialog v-if="editRawDialogState.open" />
</template>
