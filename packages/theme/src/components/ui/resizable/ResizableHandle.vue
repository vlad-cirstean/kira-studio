<script setup lang="ts">
import { cn } from '@theme/lib/utils';
import { reactiveOmit } from '@vueuse/core';
import type { SplitterResizeHandleEmits, SplitterResizeHandleProps } from 'reka-ui';
import { SplitterResizeHandle, useForwardPropsEmits } from 'reka-ui';
import type { HTMLAttributes } from 'vue';

// P110 B32/I2-39: fetched from shadcn-vue.com/r/styles/reka-nova/resizable.json (P99 4.2's
// direct-curl procedure). All three registry parts are fetched and used: this handle (B32,
// restyled below) plus ResizablePanel/ResizablePanelGroup (I2-39, kept registry-verbatim aside
// from the @/lib/utils import rewrite) -- every SplitterGroup/SplitterPanel call site now goes
// through the wrapper trio, closing the half-adoption gap named in plan §3.11.4.
//
// The registry's own default classes (a thin bg-border line, no divider/hover treatment) are
// replaced entirely with the P16 design system's own PanelSplitter.vue `divider` look, folded
// off 7 consumers' identical scoped `.cell-splitter`/`.request-splitter`/`.browse-splitter` rules
// (KeyValuePane, HttpRequestView, GrpcRequestView, DataView, StreamView, ConsoleView's own
// row-resize shape; BrowseView's own col-resize mirror) -- one definition per axis here instead of
// 7 pasted copies, keyed off reka's own `data-orientation` attribute (set verbatim from the
// SplitterGroup's own `direction` prop, so "horizontal" = side-by-side panels/col-resize and
// "vertical" = stacked panes/row-resize). The two arbitrary shadow values reproduce the retired
// rules' `box-shadow: inset ... var(--kira-border)` byte-for-byte (real-compile verified) --
// confined to this file per the plan's own allowlist (a centred inset line, cleared on hover/drag,
// --kira-focus fill taking over instead).
//
// WorkbenchShell.vue's own two handles never had this divider (no shadow, idle) -- untouched here,
// out of scope for B36's own workbench-chrome pass. It keeps that exact look by overriding with its
// own data-[orientation=...]:shadow-none (dedups its own way via cn()'s tailwind-merge, confirmed:
// the later class wins per orientation, the earlier default drops out of the rendered string
// entirely) alongside its own narrower width override -- nothing conditional on this file's side.
const props = defineProps<SplitterResizeHandleProps & { class?: HTMLAttributes['class'] }>();
const emits = defineEmits<SplitterResizeHandleEmits>();

const delegatedProps = reactiveOmit(props, 'class');
const forwarded = useForwardPropsEmits(delegatedProps, emits);
</script>

<template>
  <SplitterResizeHandle
    data-slot="resizable-handle"
    v-bind="forwarded"
    :class="
      cn(
        'shrink-0 bg-transparent hover:bg-focus data-[state=drag]:bg-focus',
        'data-[orientation=horizontal]:w-1 data-[orientation=horizontal]:cursor-col-resize',
        'data-[orientation=horizontal]:shadow-[inset_calc(var(--kira-border-width)*-1)_0_0_0_var(--kira-border)]',
        'data-[orientation=horizontal]:hover:shadow-none',
        'data-[orientation=horizontal]:data-[state=drag]:shadow-none',
        'data-[orientation=vertical]:h-1 data-[orientation=vertical]:cursor-row-resize',
        'data-[orientation=vertical]:shadow-[inset_0_calc(var(--kira-border-width)*-1)_0_0_var(--kira-border)]',
        'data-[orientation=vertical]:hover:shadow-none',
        'data-[orientation=vertical]:data-[state=drag]:shadow-none',
        props.class,
      )
    "
  />
</template>
