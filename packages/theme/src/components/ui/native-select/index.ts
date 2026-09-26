import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as NativeSelect } from '@theme/components/ui/native-select/NativeSelect.vue';

// P110 B24: fetched from shadcn-vue.com/r/styles/reka-nova/native-select.json (P99 §4.2's
// direct-curl procedure), then fully restyled -- the registry's own default look is
// appearance-none plus a manually-positioned ChevronDownIcon requiring a wrapper div, but this
// app targets a single pinned Electron/Chromium build (base.css's own precedent, primitives.css's
// former .p-select comment) so it keeps Chromium's Customizable Select API instead: a bare
// <select appearance:base-select>, no wrapper, no manual icon -- the browser draws
// ::picker-icon/::picker(select) itself, themed below. `[appearance:base-select]`,
// `[&::picker(select)]:…`, `[&::picker-icon]:…` are §1.2's own allowlisted arbitrary values,
// confined to this file only.
export const nativeSelectVariants = cva(
  // P61: WebKit's `appearance: base-select` box carries its own intrinsic min-height floor
  // (font-metric-driven, ~24px at this font-size/line-height) that wins over an authored height
  // even under box-sizing: border-box -- since Playwright 1.63's bundled WebKit, this floor sits
  // above --kira-control-h and breaks the height match with every other control. min-h-0 removes
  // the floor so the authored height governs again, on every appearance: base-select engine, not
  // just the newer one.
  'min-h-0 inline-flex shrink-0 items-center gap-1 pr-1 pl-1.5 rounded-kira-sm text-muted-foreground text-kira-md cursor-pointer [appearance:base-select] [&::picker-icon]:text-muted-foreground [&::picker(select)]:[appearance:base-select] [&::picker(select)]:mt-0.5 [&::picker(select)]:p-0.5 [&::picker(select)]:bg-elevated [&::picker(select)]:border [&::picker(select)]:border-border-strong [&::picker(select)]:rounded-kira-sm [&::picker(select)]:shadow-kira [&_option]:py-1 [&_option]:px-1.5 [&_option]:rounded-kira-sm [&_option]:text-fg [&_option]:bg-transparent [&_option:hover]:bg-hover [&_option:checked]:bg-select [&_option:checked]:text-fg focus-visible:border-focus disabled:text-disabled disabled:cursor-default',
  {
    variants: {
      variant: {
        default: '',
        // Original .p-select.bordered's own padding-right, calc(--kira-s-2 + 14px) = 18px, has no
        // default-scale match -- pr-4 (16px)/pr-5 (20px) tie at ±2px, chose pr-5 for reliable
        // clearance from the picker-icon arrow.
        bordered: 'border border-border-strong bg-field text-fg pr-5 aria-invalid:border-error',
      },
      size: {
        kira: 'h-control',
        'kira-lg': 'h-control-lg',
      },
    },
    defaultVariants: {
      variant: 'bordered',
      size: 'kira',
    },
  },
);

export type NativeSelectVariants = VariantProps<typeof nativeSelectVariants>;
