import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { HostViewTarget } from './wire';

// This window's target, set once at boot; a window with a target is a host view window.
export const useHostViewWindowStore = defineStore('hostViewWindow', () => {
  const target = ref<HostViewTarget | null>(null);
  return { target };
});
