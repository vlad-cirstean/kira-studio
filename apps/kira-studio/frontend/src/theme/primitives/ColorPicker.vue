<script setup lang="ts">
import { PALETTE_COLOR_CHOICES, type PaletteColor } from '@shared/domain/color';
// P104 §3: "a swatch grid of Buttons" -- each swatch is now a real ui/button Button (focus-visible
// ring, keyboard semantics) with its round-swatch look as a class override; the tooltip directive
// becomes the real Tooltip trio, keeping each swatch's own aria-label (already present) since a
// color swatch is an icon-only trigger.
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';

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
  <div class="color-picker flex h-6.5 flex-wrap items-center gap-1" role="radiogroup" :aria-label="label">
    <Tooltip v-for="color in colors" :key="color">
      <TooltipTrigger as-child>
        <Button
          variant="ghost"
          class="swatch h-4 w-4 shrink-0 cursor-pointer rounded-full border-0 bg-transparent p-0 hover:bg-transparent"
          :class="{ 'outline outline-2 outline-offset-2 outline-fg': modelValue === color, none: color === 'none' }"
          :style="color === 'none' ? undefined : { background: `var(--kira-conn-${color})` }"
          :aria-label="color === 'none' ? 'No colour' : color"
          role="radio"
          :aria-checked="modelValue === color"
          :data-testid="`color-${color}`"
          @click="emit('update:modelValue', color)"
        />
      </TooltipTrigger>
      <TooltipContent>{{ color === 'none' ? 'No colour' : color }}</TooltipContent>
    </Tooltip>
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
