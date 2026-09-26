<script setup lang="ts">
// P113 F7: the picker's section-header div (label, uppercase, tracking-wide) repeated verbatim
// across BranchPicker.vue (x2), GlobalStashList.vue, StackList.vue, StashList.vue, TagList.vue and
// WorktreeList.vue. `justify-between` is in the shared class unconditionally — with no default-slot
// content it has no visible effect (a single flex child sits at the start either way), so the two
// sites that render a trailing action (GlobalStashList's "save to global stash",
// WorktreeList's "create worktree") get it for free instead of needing a variant prop.
defineProps<{ label: string }>();
</script>

<template>
  <div
    class="kv:flex kv:items-center kv:justify-between kv:h-control-sm kv:px-2 kv:text-sm kv:font-semibold kv:text-muted-foreground kv:uppercase kv:tracking-wider"
  >
    <span>{{ label }}</span>
    <slot />
  </div>
</template>
