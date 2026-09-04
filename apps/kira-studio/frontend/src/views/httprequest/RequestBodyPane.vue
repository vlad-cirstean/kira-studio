<script setup lang="ts">
import type { HttpBodyMode, HttpRawLanguage } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed, ref } from 'vue';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import { patchHttpRequestTabState } from '../../state/tabs';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import { beautifyFor, canBeautify } from '../shared/celleditor/formats';
import {
  BODY_MODE_OPTIONS,
  contentTypeCaption,
  editorLanguageForRaw,
  RAW_LANGUAGE_OPTIONS,
  userContentTypeHeader,
} from './body';

// P3 C5/D9: extracted from HttpRequestView.vue's own inline block (P2) — the mode selector, the
// raw-language select, the auto-Content-Type caption and the per-mode editor host all live here
// now so HttpRequestView.vue stays a layout shell. C7-C10 each add one more mode's editor below;
// C5 lands `raw` (D9's caption/Beautify rules) plus the six-way selector all six modes will use.
const props = defineProps<{ tab: HttpRequestTabRecord }>();

function setBodyMode(mode: HttpBodyMode): void {
  patchHttpRequestTabState(props.tab.id, { bodyMode: mode });
}

function onRawLanguageChange(e: Event): void {
  const rawLanguage = (e.target as HTMLSelectElement).value as HttpRawLanguage;
  patchHttpRequestTabState(props.tab.id, { rawLanguage });
  beautifyError.value = null;
}

function onBodyChange(text: string): void {
  patchHttpRequestTabState(props.tab.id, { body: text });
  beautifyError.value = null;
}

// D9: Beautify offered exactly where formats.ts's own canBeautify says a lossless reformatter
// exists (json/xml) — reused, not re-derived (§3: no new beautify logic).
const beautifyFormat = computed<'json' | 'xml' | null>(() => {
  const lang = props.tab.state.rawLanguage;
  if (lang !== 'json' && lang !== 'xml') return null;
  return canBeautify(lang) ? lang : null;
});

const beautifyError = ref<string | null>(null);
function onBeautifyBody(): void {
  const fmt = beautifyFormat.value;
  if (!fmt) return;
  const result = beautifyFor(fmt, props.tab.state.body, 'indented');
  if (result.ok) {
    patchHttpRequestTabState(props.tab.id, { body: result.text });
    beautifyError.value = null;
  } else {
    beautifyError.value = result.reason ?? 'could not format this body';
  }
}

const editorLanguage = computed(() => editorLanguageForRaw(props.tab.state.rawLanguage));

// D9: the honest alternative to Postman's greyed "hidden headers" list — states exactly what D7's
// Content-Type precedence will do, without ever injecting a synthetic row into state.headers.
const caption = computed(() =>
  contentTypeCaption(
    props.tab.state.bodyMode,
    props.tab.state.rawLanguage,
    userContentTypeHeader(props.tab.state.headers),
  ),
);
</script>

<template>
  <div class="body-pane">
    <div class="body-mode-row p-toolbar">
      <SegmentedControl
        :model-value="tab.state.bodyMode"
        :options="BODY_MODE_OPTIONS"
        data-testid="http-body-mode"
        @update:model-value="setBodyMode"
      />
      <select
        v-if="tab.state.bodyMode === 'raw'"
        class="p-select bordered"
        data-testid="http-body-raw-language"
        :value="tab.state.rawLanguage"
        @change="onRawLanguageChange"
      >
        <option v-for="opt in RAW_LANGUAGE_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <span class="p-push" />
      <IconButton
        v-if="tab.state.bodyMode === 'raw' && beautifyFormat"
        icon="expand-all"
        v-tooltip="'Beautify'"
        data-testid="http-body-beautify"
        @click="onBeautifyBody"
      />
    </div>

    <div v-if="caption" class="p-xs dim body-caption" data-testid="http-body-content-type-caption">
      {{ caption }}
    </div>

    <MessageStrip v-if="beautifyError" tone="err" data-testid="http-body-beautify-error">
      {{ beautifyError }}
    </MessageStrip>

    <CodeMirrorHost
      v-if="tab.state.bodyMode === 'raw'"
      :doc="tab.state.body"
      :language="editorLanguage"
      :read-only="false"
      @update:doc="onBodyChange"
    />
  </div>
</template>

<style scoped>
.body-pane {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.body-mode-row {
  gap: var(--kira-s-2);
  overflow-x: auto;
}

.body-caption {
  padding: 0 var(--kira-s-3) var(--kira-s-2);
}
</style>
