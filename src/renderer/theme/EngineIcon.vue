<script setup lang="ts">
import type { ConnectionKind } from '@shared/domain/connection';
import {
  siApachekafka,
  siClickhouse,
  siMariadb,
  siMongodb,
  siMysql,
  siPostgresql,
  siRabbitmq,
  siRedis,
  siSqlite,
} from 'simple-icons';
import { computed } from 'vue';

// P16 design system: the products' own marks, imported from simple-icons (see NOTICES.md) and
// drawn in each icon's real brand `hex`, not currentColor. Each mark is authored on a 24x24 grid;
// `translate(2,2) scale(0.5)` maps that onto this component's 16x16 canvas, inset to fit inside the
// 14x14 backdrop chip below it. SQS and S3 have no simple-icons entry (Amazon publishes no
// per-service marks there either, only a generic AWS wordmark), so they stay as original redrawn
// shapes, already authored to fit the chip inset directly (no transform needed) — drawn in a fixed
// color instead of currentColor (SQS: dark navy #232F3E, S3: goldenrod #B8860B), since a backdrop
// chip breaks the assumption that let them adopt whatever text/accent color ambient context set.
// All 11 marks sit on the same #ececec off-white rounded-square backdrop chip: several brand hexes
// (MariaDB, SQLite, Kafka) are otherwise near-invisible on Kira's dark chrome, and per-icon tinted
// chip colors were tried (10%/28% tints of each icon's own hex, then a hand-picked distinct pastel
// per icon) but made the set look inconsistent/arbitrary — one flat chip color for every engine
// reads as a single coherent design instead. Plain #fff read as too bright/harsh against the dark
// chrome and washed out the glyphs sitting on it; #ececec is a deliberately soft, barely-tinted
// off-white instead.
// Unlike Devicon, the 9 simple-icons imports are genuine ES imports (simple-icons
// ships real named exports and "sideEffects": false), so only the 9 referenced consts should end
// up in the bundle.
// 1:1 with parts/_icons.html's i-* engine symbols.
const props = defineProps<{ kind: ConnectionKind; size?: number }>();

const iconSize = computed(() => props.size ?? 16);
</script>

<template>
  <svg class="icon" :width="iconSize" :height="iconSize" viewBox="0 0 16 16" aria-hidden="true">
    <template v-if="kind === 'postgres'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siPostgresql.hex}`" :d="siPostgresql.path" />
    </template>

    <template v-if="kind === 'mariadb'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siMariadb.hex}`" :d="siMariadb.path" />
    </template>

    <template v-if="kind === 'mysql'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siMysql.hex}`" :d="siMysql.path" />
    </template>

    <template v-if="kind === 'sqlite'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siSqlite.hex}`" :d="siSqlite.path" />
    </template>

    <template v-if="kind === 'mongodb'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siMongodb.hex}`" :d="siMongodb.path" />
    </template>

    <template v-if="kind === 'redis'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siRedis.hex}`" :d="siRedis.path" />
    </template>

    <template v-if="kind === 'kafka'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siApachekafka.hex}`" :d="siApachekafka.path" />
    </template>

    <template v-if="kind === 'sqs'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path
        fill="#232F3E"
        fill-rule="evenodd"
        d="M6.6 3.9h7.1c.72 0 1.3.58 1.3 1.3v5.6c0 .72-.58 1.3-1.3 1.3H6.6c-.72 0-1.3-.58-1.3-1.3V5.2c0-.72.58-1.3 1.3-1.3zm.5 1.55v5.1h6.1v-5.1l-3.05 2.45z"
      />
      <path
        fill="none"
        stroke="#232F3E"
        stroke-width="1.3"
        stroke-linecap="round"
        d="M1.2 5.9h2.5M1.2 8.1h2.5M1.2 10.3h2.5"
      />
    </template>

    <template v-if="kind === 'clickhouse'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siClickhouse.hex}`" :d="siClickhouse.path" />
    </template>

    <template v-if="kind === 'rabbitmq'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path transform="translate(2,2) scale(0.5)" :fill="`#${siRabbitmq.hex}`" :d="siRabbitmq.path" />
    </template>

    <template v-if="kind === 's3'">
      <rect x="1" y="1" width="14" height="14" rx="3" fill="#ececec" />
      <path
        fill="none"
        stroke="#B8860B"
        stroke-width="1.2"
        stroke-linejoin="round"
        d="M2.95 3.5l.9 9.25c.06.63.6 1.1 1.24 1.1h5.82c.64 0 1.18-.47 1.24-1.1l.9-9.25"
      />
      <ellipse cx="8" cy="3.4" rx="5.05" ry="1.7" fill="none" stroke="#B8860B" stroke-width="1.2" />
    </template>
  </svg>
</template>
