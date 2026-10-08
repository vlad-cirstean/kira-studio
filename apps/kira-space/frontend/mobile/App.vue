<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from './state/auth';

const router = useRouter();
const { phase } = storeToRefs(useAuthStore());

// Pairing, revoke and a lost cookie move the app between the pairing screen and the shell.
watch(phase, (p) => {
  if (p === 'paired') void router.replace({ name: 'home' });
  else if (p !== 'checking') void router.replace({ name: 'pair' });
});
</script>

<template>
  <RouterView />
</template>
