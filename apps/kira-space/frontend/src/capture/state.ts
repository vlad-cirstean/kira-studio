import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { CaptureItem } from './wire';

// This window's item, set once at boot and replaced by a push; a window with an item is a capture popup.
export const useCaptureWindowStore = defineStore('captureWindow', () => {
  const item = ref<CaptureItem | null>(null);
  return { item };
});
