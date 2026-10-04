<script setup lang="ts">
import { computed } from 'vue';
import AdeConfirmDialog from './AdeConfirmDialog.vue';
import { useForcePush } from './queries';

// Force push with lease for one branch; the backend refuses a stale lease and the message shows here.
const props = defineProps<{ target: { branchId: string; branchName: string; repo: string } | null }>();
const emit = defineEmits<{ close: [] }>();

const forcePush = useForcePush();
const title = computed(() =>
  props.target ? `Force push ${props.target.branchName} (repo ${props.target.repo}) with lease?` : '',
);

async function run(): Promise<string | null> {
  if (!props.target) return null;
  const res = await forcePush.mutateAsync({ branchId: props.target.branchId });
  return res.error ? res.error.message : null;
}
</script>

<template>
  <AdeConfirmDialog
    :open="target !== null"
    :title="title"
    text="Replaces the remote branch with your local one; refused when someone else pushed since your last fetch."
    yes-label="Force push"
    no-label="Cancel"
    :run="run"
    @close="emit('close')"
  />
</template>
