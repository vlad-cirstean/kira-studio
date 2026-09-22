<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';

// P18 D18: promoted from project/ColorPicker.vue — api/** may not import project/** (biome.json),
// and an environment (api/**) needs this swatch radiogroup too, exactly the promotion P15 D5 made
// for Checkbox. Unchanged except the aria-label becoming a `label` prop (Studio's own connection
// dialog and the Api module's environment tab want different words for the same control) and the
// prop type moving to the shared PaletteColor (ConnectionColor is now an alias of it).
withDefaults(defineProps<{ modelValue: PaletteColor; label?: string }>(), {
  label: 'Colour',
});
const emit = defineEmits<{ 'update:modelValue': [PaletteColor] }>();

// P42 D34: the offered subset, not the full storable enum — a row already saved with a retired
// colour keeps its own rail regardless (connColor.ts), it just isn't offered here again.
const colors = PALETTE_COLOR_CHOICES;
</script>

<template>
  <div
    class="color-picker flex h-[var(--kira-h-md)] flex-wrap items-center gap-[var(--kira-s-2)]"
    role="radiogroup"
    :aria-label="label"
  >
    <button
      v-for="color in colors"
      :key="color"
      type="button"
      class="swatch h-4 w-4 shrink-0 cursor-pointer rounded-full border-0 p-0"
      :class="{ 'outline outline-2 outline-offset-2 outline-fg': modelValue === color, none: color === 'none' }"
      :style="color === 'none' ? undefined : { background: `var(--kira-conn-${color})` }"
      v-tooltip="color === 'none' ? 'No colour' : color"
      :aria-label="color === 'none' ? 'No colour' : color"
      role="radio"
      :aria-checked="modelValue === color"
      :data-testid="`color-${color}`"
      @click="emit('update:modelValue', color)"
    />
  </div>
</template>

<style scoped>
/* P31 D26/F26: an outlined swatch with a diagonal slash — never a 13th hue standing in for
   "nothing chosen". A plain hollow ring (the previous look) read, beside twelve saturated
   circles on a dark surface, as "a very dark thirteenth colour" rather than "no colour"; the
   slash is the universal "none" mark and unmistakable even at 16px. Ring brightened from
   --kira-fg-disabled to --kira-fg-muted to read as deliberate rather than merely dim.
   .p-conn-dot.none (the 5px rail dot elsewhere) is a status dot, not a choice, and is untouched. */
.swatch.none {
  border: 1.5px solid var(--kira-fg-muted);
  background: linear-gradient(
    to top right,
    transparent calc(50% - 0.75px),
    var(--kira-fg-muted) calc(50% - 0.75px),
    var(--kira-fg-muted) calc(50% + 0.75px),
    transparent calc(50% + 0.75px)
  );
}
</style>
