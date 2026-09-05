<script setup lang="ts">
import {
  BODY_MODE_OPTIONS,
  CODE_LANGUAGE_OPTIONS,
  contentTypeCaption,
  editorLanguageForCode,
  type HttpBodySelection,
  userContentTypeHeader,
} from '@kira/api-core';
import type { HttpCodeLanguage } from '@shared/domain/http';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed, ref } from 'vue';
import { patchHttpRequestTabState } from '../../api/tabs';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import { beautifyFor, canBeautify } from '../shared/celleditor/formats';
import BinaryBodyPicker from './BinaryBodyPicker.vue';
import FormDataTable from './FormDataTable.vue';
import UrlEncodedTable from './UrlEncodedTable.vue';
import type { VariableSupport } from './variableCompletion';

// C5/D9: extracted from HttpRequestView.vue's own inline block (P2) — the mode selector, the code-
// language select, the auto-Content-Type caption and the per-mode editor host all live here now so
// HttpRequestView.vue stays a layout shell. `raw` is a plain-text buffer with no sub-selector;
// `code` keeps the language selector raw used to carry, narrowed to its four syntax-highlighted
// languages.
const props = defineProps<{
  tab: HttpRequestTabRecord;
  /** P15b D4: HttpRequestView.vue's own variableSupport(...) — rangeHighlights colours both
   *  editable editor hosts below (raw and code/JSON) with `{{variable}}` references exactly like
   *  the URL/header fields (N3); the rest is forwarded to the urlencoded/form-data value cells. */
  variables?: VariableSupport;
}>();

// P15 D6: JSON is a UI-level segment over the same `bodyMode`/`codeLanguage` storage — no schema,
// wire or Go change (§5 of the plan spells out why: the entire delta below is presentation).
const selection = computed<HttpBodySelection>(() =>
  props.tab.state.bodyMode === 'code' && props.tab.state.codeLanguage === 'json'
    ? 'json'
    : props.tab.state.bodyMode,
);

function setSelection(next: HttpBodySelection): void {
  if (next === 'json') {
    patchHttpRequestTabState(props.tab.id, { bodyMode: 'code', codeLanguage: 'json' });
    return;
  }
  if (next === 'code' && props.tab.state.codeLanguage === 'json') {
    // Otherwise `selection` above would snap straight back to 'json' and this segment would be
    // unclickable — Code always means a non-JSON language now that JSON has its own segment.
    patchHttpRequestTabState(props.tab.id, { bodyMode: 'code', codeLanguage: 'javascript' });
    return;
  }
  patchHttpRequestTabState(props.tab.id, { bodyMode: next });
}

function onCodeLanguageChange(e: Event): void {
  const codeLanguage = (e.target as HTMLSelectElement).value as HttpCodeLanguage;
  patchHttpRequestTabState(props.tab.id, { codeLanguage });
  beautifyError.value = null;
}

function onRawChange(text: string): void {
  patchHttpRequestTabState(props.tab.id, { body: text });
}

function onCodeChange(text: string): void {
  patchHttpRequestTabState(props.tab.id, { code: text });
  beautifyError.value = null;
}

// D9: Beautify offered exactly where formats.ts's own canBeautify says a lossless reformatter
// exists (json/xml) — reused, not re-derived (§3: no new beautify logic).
const beautifyFormat = computed<'json' | 'xml' | null>(() => {
  const lang = props.tab.state.codeLanguage;
  if (lang !== 'json' && lang !== 'xml') return null;
  return canBeautify(lang) ? lang : null;
});

const beautifyError = ref<string | null>(null);
function onBeautifyBody(): void {
  const fmt = beautifyFormat.value;
  if (!fmt) return;
  const result = beautifyFor(fmt, props.tab.state.code, 'indented');
  if (result.ok) {
    patchHttpRequestTabState(props.tab.id, { code: result.text });
    beautifyError.value = null;
  } else {
    beautifyError.value = result.reason ?? 'could not format this body';
  }
}

const editorLanguage = computed(() => editorLanguageForCode(props.tab.state.codeLanguage));

// D9: the honest alternative to Postman's greyed "hidden headers" list — states exactly what D7's
// Content-Type precedence will do, without ever injecting a synthetic row into state.headers.
const caption = computed(() =>
  contentTypeCaption(
    props.tab.state.bodyMode,
    props.tab.state.codeLanguage,
    userContentTypeHeader(props.tab.state.headers),
  ),
);
</script>

<template>
  <div class="body-pane">
    <div class="body-mode-row p-toolbar">
      <SegmentedControl
        :model-value="selection"
        :options="BODY_MODE_OPTIONS"
        data-testid="http-body-mode"
        @update:model-value="setSelection"
      />
      <select
        v-if="tab.state.bodyMode === 'code' && tab.state.codeLanguage !== 'json'"
        class="p-select bordered"
        data-testid="http-body-code-language"
        :value="tab.state.codeLanguage"
        @change="onCodeLanguageChange"
      >
        <option v-for="opt in CODE_LANGUAGE_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <span class="p-push" />
      <IconButton
        v-if="tab.state.bodyMode === 'code' && beautifyFormat"
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
      language="plain"
      :read-only="false"
      :range-highlights="variables?.rangeHighlights"
      auto-close-brackets
      @update:doc="onRawChange"
    />
    <CodeMirrorHost
      v-else-if="tab.state.bodyMode === 'code'"
      :doc="tab.state.code"
      :language="editorLanguage"
      :read-only="false"
      :range-highlights="variables?.rangeHighlights"
      auto-close-brackets
      @update:doc="onCodeChange"
    />
    <UrlEncodedTable v-else-if="tab.state.bodyMode === 'urlencoded'" :tab="tab" :variables="variables" />
    <FormDataTable v-else-if="tab.state.bodyMode === 'formdata'" :tab="tab" :variables="variables" />
    <BinaryBodyPicker v-else-if="tab.state.bodyMode === 'file'" :tab="tab" />
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
