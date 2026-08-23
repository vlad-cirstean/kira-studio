<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import { computed } from 'vue';

// P16 design system: the products' own logos, redrawn to 16px as currentColor
// paths so they take the connection colour and obey the icon law — not the
// vendored trademarked marks (docs/design/kira-design-system, "The engine
// marks are drawn here, not vendored"). 1:1 with parts/_icons.html's i-*
// engine symbols.
const props = defineProps<{ kind: ConnectionKind; size?: number }>();

const iconSize = computed(() => props.size ?? 16);
</script>

<template>
  <svg class="icon" :width="iconSize" :height="iconSize" viewBox="0 0 16 16" aria-hidden="true">
    <path
      v-if="kind === 'postgres'"
      fill="currentColor"
      fill-rule="evenodd"
      d="M8 1.6c-1.85 0-3.4.75-4.35 2-.75-.5-1.6-.4-2 .3-.4.75.05 1.6.9 1.95-.15.5-.2 1-.2 1.5 0 2.5 1.85 4.4 5.65 4.4s5.65-1.9 5.65-4.4c0-.5-.05-1-.2-1.5.85-.35 1.3-1.2.9-1.95-.4-.7-1.25-.8-2-.3C11.4 2.35 9.85 1.6 8 1.6zM5.1 5.6a.85.85 0 1 0 1.7 0 .85.85 0 1 0-1.7 0z"
    />
    <template v-if="kind === 'postgres'">
      <path
        fill="currentColor"
        d="M6.8 10.3c0 2.2.45 4.4 2.85 4.4 1.65 0 2.6-1.05 2.6-2.2 0-.65-.28-1.2-.75-1.55l-1.1 1.15c.27.22.38.38.38.6 0 .42-.32.7-.8.7-.9 0-1.18-.95-1.18-3.1z"
      />
      <path fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" d="M6.15 11 5.25 13.3" />
    </template>

    <path
      v-if="kind === 'mariadb'"
      fill="currentColor"
      fill-rule="evenodd"
      d="M2.1 6.95c.28-1.75 1.3-3.1 2.85-3.8.62-.28 1.12.03 1.22.7.18 1.15.85 2.05 1.98 2.85 1.85 1.32 3.42 2.85 4.85 4.55.6.7 1.28 1.15 2.05 1.35.6.15.75.62.3 1.02-.75.65-1.85 1-3.25 1.1-2.6.2-4.95.05-7.1-.45-.65-.15-.85-.65-.5-1.2.5-.8.6-1.6.3-2.4-.25-.65-.72-1.12-1.38-1.55-.92-.62-1.5-1.15-1.32-2.17zm2.05-1.85a.65.65 0 1 0 1.3 0 .65.65 0 1 0-1.3 0z"
    />

    <template v-if="kind === 'mongodb'">
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="M8 1C5.85 3.7 3.85 6.3 3.85 9.1c0 2.45 1.6 4.35 3.55 4.75h1.2c1.95-.4 3.55-2.3 3.55-4.75C12.15 6.3 10.15 3.7 8 1zm.05 2.25c.52 1.4.75 2.55.75 3.85v6.1h-.62V7.1c0-1.3-.2-2.4-.66-3.65z"
      />
      <path fill="currentColor" d="M7.42 13.6h1.16l-.2 1.45h-.76z" />
    </template>

    <template v-if="kind === 'redis'">
      <path fill="currentColor" d="M8 1.5 15 4.3 8 7.1 1 4.3z" />
      <path fill="currentColor" d="M1 6.05 8 8.85l7-2.8v1.6L8 10.45 1 7.65z" />
      <path fill="currentColor" d="M1 9.4 8 12.2l7-2.8V11L8 13.8 1 11z" />
    </template>

    <template v-if="kind === 'kafka'">
      <path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" d="M5.2 2.4v11.2" />
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.45"
        stroke-linecap="round"
        d="m5.3 8.15 5-3.6m-5 3.9 5.1 3.5"
      />
      <circle cx="5.2" cy="8" r="1.75" fill="currentColor" />
      <circle cx="11.4" cy="3.7" r="1.95" fill="currentColor" />
      <circle cx="11.5" cy="12.4" r="1.95" fill="currentColor" />
    </template>

    <template v-if="kind === 'sqs'">
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="M6.6 3.9h7.1c.72 0 1.3.58 1.3 1.3v5.6c0 .72-.58 1.3-1.3 1.3H6.6c-.72 0-1.3-.58-1.3-1.3V5.2c0-.72.58-1.3 1.3-1.3zm.5 1.55v5.1h6.1v-5.1l-3.05 2.45z"
      />
      <path
        fill="none"
        stroke="currentColor"
        stroke-width="1.3"
        stroke-linecap="round"
        d="M1.2 5.9h2.5M1.2 8.1h2.5M1.2 10.3h2.5"
      />
    </template>

    <path
      v-if="kind === 's3'"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      stroke-linejoin="round"
      d="M2.95 3.5l.9 9.25c.06.63.6 1.1 1.24 1.1h5.82c.64 0 1.18-.47 1.24-1.1l.9-9.25"
    />
    <ellipse v-if="kind === 's3'" cx="8" cy="3.4" rx="5.05" ry="1.7" fill="none" stroke="currentColor" stroke-width="1.2" />
  </svg>
</template>
