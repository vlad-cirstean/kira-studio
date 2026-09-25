import type { VariantProps } from 'class-variance-authority';
import { cva } from 'class-variance-authority';

export { default as Button } from '@theme/components/ui/button/Button.vue';

export const buttonVariants = cva(
  'focus-visible:border-focus focus-visible:ring-focus/50 aria-invalid:ring-error/20 dark:aria-invalid:ring-error/40 aria-invalid:border-error dark:aria-invalid:border-error/50 rounded-lg border border-transparent bg-clip-padding text-sm font-medium focus-visible:ring-3 aria-invalid:ring-3 active:not-aria-[haspopup]:translate-y-px [&_svg:not([class*=size-])]:size-4 group/button inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-all outline-none select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a]:hover:bg-primary/80',
        outline:
          'border-border bg-bg hover:bg-field hover:text-fg dark:bg-border-strong/30 dark:border-border-strong dark:hover:bg-border-strong/50 aria-expanded:bg-field aria-expanded:text-fg',
        secondary:
          'bg-field text-fg hover:bg-field/80 aria-expanded:bg-field aria-expanded:text-fg',
        ghost:
          'hover:bg-field hover:text-fg dark:hover:bg-field/50 aria-expanded:bg-field aria-expanded:text-fg',
        destructive:
          'bg-error/10 hover:bg-error/20 focus-visible:ring-error/20 dark:focus-visible:ring-error/40 dark:bg-error/20 text-error focus-visible:border-error/40 dark:hover:bg-error/30',
        link: 'text-primary underline-offset-4 hover:underline',
        // P104 §3: AppButton's `kind`/`variant` vocabulary, collapsed onto this cva's own
        // `variant` axis instead of a second wrapper prop layer (§0's "no hand-rolled fallback").
        // Geometry stays on the `kira`/`kira-lg`/`kira-icon` sizes below (design-system tokens,
        // runtime-adjustable via @theme's --spacing-control* -- see base.css §7.2), never this
        // set's own fixed h-8/h-7 scale, which would shift every control's height against those
        // tokens.
        toolbar: 'rounded-kira-sm text-muted-foreground hover:bg-hover hover:text-fg',
        'toolbar-primary':
          'rounded-kira-sm bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-45',
        dialog: 'justify-center rounded-kira-sm border border-border-strong bg-field text-fg',
        'dialog-primary':
          'justify-center rounded-kira-sm border border-primary bg-primary text-primary-foreground disabled:opacity-45',
        'dialog-danger':
          'justify-center rounded-kira-sm border border-error bg-error/10 text-error hover:bg-error/20 disabled:opacity-45',
        danger: 'rounded-kira-sm text-error hover:bg-hover',
        // P110 B13: TitleBar.vue's own action row -- `aria-pressed` replaces `.is-on`'s own class
        // toggle, fixing the state's previously unexposed accessibility gap.
        title:
          'rounded-kira-sm border border-transparent bg-transparent text-muted-foreground hover:bg-hover wails-no-drag aria-pressed:bg-elevated aria-pressed:border-border-strong aria-pressed:text-fg aria-pressed:hover:bg-hover',
      },
      size: {
        default:
          'h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: 'h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*=size-])]:size-3',
        sm: 'h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*=size-])]:size-3.5',
        lg: 'h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-8',
        'icon-xs':
          'size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*=size-])]:size-3',
        'icon-sm':
          'size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-9',
        // P104 §3: AppButton/IconButton's own runtime-adjustable control heights (base.css's
        // --spacing-control*, an @theme-indirected --kira-control-h*) -- never this set's fixed
        // h-8/h-7 steps, which don't track the Appearance density setting.
        kira: 'h-control gap-1.5 px-3 text-kira-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        'kira-lg':
          'h-control-lg gap-1.5 px-3 text-kira-sm has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        'kira-icon': 'size-control',
        // P110 B13
        title: 'size-5.5',
        'title-labelled': 'h-5.5 px-1 gap-1 text-kira-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);
export type ButtonVariants = VariantProps<typeof buttonVariants>;
