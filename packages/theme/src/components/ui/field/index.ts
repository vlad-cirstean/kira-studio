import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

// P110 B11: replaces workbench.css's own `.field`/`.field.checkbox` pair (`.field` -> vertical,
// `.field.checkbox` -> horizontal). gap-1/gap-1.5 are --kira-s-2/--kira-s-3 (4px/6px).
export const fieldVariants = cva('flex text-kira-md', {
  variants: {
    orientation: {
      vertical: 'flex-col gap-1',
      horizontal: 'flex-row items-center gap-1.5',
    },
  },
  defaultVariants: {
    orientation: 'vertical',
  },
});

export type FieldVariants = VariantProps<typeof fieldVariants>;

export { default as Field } from './Field.vue';
export { default as FieldContent } from './FieldContent.vue';
export { default as FieldDescription } from './FieldDescription.vue';
export { default as FieldError } from './FieldError.vue';
export { default as FieldGroup } from './FieldGroup.vue';
export { default as FieldLabel } from './FieldLabel.vue';
export { default as FieldLegend } from './FieldLegend.vue';
export { default as FieldSeparator } from './FieldSeparator.vue';
export { default as FieldSet } from './FieldSet.vue';
export { default as FieldTitle } from './FieldTitle.vue';
