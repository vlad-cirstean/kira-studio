<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './state/auth';

const router = useRouter();
const { phase } = storeToRefs(useAuthStore());

// Pairing, revoke and a lost cookie move the app between the pairing screen and the shell. The
// first check settles through the router guard, so a reload keeps its route (a terminal link).
watch(phase, (p, prev) => {
  if (prev === 'checking') return;
  if (p === 'paired') void router.replace({ name: 'home' });
  else if (p !== 'checking') void router.replace({ name: 'pair' });
});
</script>

<template>
  <RouterView />
</template>
