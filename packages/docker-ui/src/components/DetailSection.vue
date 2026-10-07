<script setup lang="ts">
defineProps<{ title: string; flush?: boolean }>();
</script>

<template>
  <section class="min-w-0 rounded-kira border border-border bg-field/40">
    <header class="flex h-control items-center gap-2 border-b border-border px-3 text-kira-sm uppercase tracking-wider text-muted-foreground">
      <h3 class="font-medium">{{ title }}</h3>
      <slot name="actions" />
    </header>
    <div :class="flush ? '' : 'p-3'">
      <slot />
    </div>
  </section>
</template>
