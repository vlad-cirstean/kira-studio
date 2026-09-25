import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Alert } from '@theme/components/ui/alert/Alert.vue';
export { default as AlertAction } from '@theme/components/ui/alert/AlertAction.vue';
export { default as AlertDescription } from '@theme/components/ui/alert/AlertDescription.vue';
export { default as AlertTitle } from '@theme/components/ui/alert/AlertTitle.vue';

export const alertVariants = cva(
  'grid gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:text-current *:[svg:not([class*=size-])]:size-4 group/alert relative w-full',
  {
    variants: {
      variant: {
        default: 'bg-card text-card-foreground',
        destructive:
          'text-destructive bg-card *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-current',
        // P108 F15: `warn`/`note` fold in the `.strip-warn`/`.strip-note` (+ `-text`) tone classes
        // that used to be hand-copied, byte-for-byte, into 12 separate `<style scoped>` blocks
        // (ImportReportStrip.vue's own D16 comment named it "the same tone vocabulary
        // RawExchangePane.vue's own dynamic-tone strip uses" — it was never actually shared code,
        // just a convention). Same tokens, same destructive-style
        // `*:data-[slot=alert-description]:…` targeting.
        warn: 'bg-warn/10 border-warn/20 *:data-[slot=alert-description]:text-warn-text *:[svg]:text-current',
        note: 'bg-info/8 border-info/20 *:data-[slot=alert-description]:text-note-text *:[svg]:text-current',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export type AlertVariants = VariantProps<typeof alertVariants>;
