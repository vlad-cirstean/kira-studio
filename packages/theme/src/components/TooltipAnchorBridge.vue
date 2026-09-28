<script setup lang="ts">
// P104 §6.4: a one-file bridge onto reka-ui's *public* injectTooltipRootContext() -- the one seam
// AttributeTooltip.vue needs to drive a TooltipRoot by hand, for the one case with no real Vue
// element to wrap in a TooltipTrigger (SlickGrid's own header-cell DOM). Mounted as a plain child
// inside <TooltipRoot>'s default slot; renders nothing itself.
import { injectTooltipRootContext, useId } from 'reka-ui';

const rootContext = injectTooltipRootContext();
// TooltipTrigger normally lazily assigns this id on first mount (reka-ui's own TooltipTrigger.js);
// there is no TooltipTrigger here, so this bridge does the same assignment by hand.
rootContext.contentId ||= useId(undefined, 'reka-tooltip-content');

defineExpose({
  contentId: rootContext.contentId,
  onTriggerChange: rootContext.onTriggerChange,
  onTriggerEnter: rootContext.onTriggerEnter,
  onTriggerLeave: rootContext.onTriggerLeave,
  onOpen: rootContext.onOpen,
  onClose: rootContext.onClose,
});
</script>

<template></template>
