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
import {
  type VariableSupport,
  variableCompletionSource,
  variableHoverSource,
} from '../../api/state/variableCompletion';
import { patchHttpRequestTabState } from '../../api/tabs';
import CodeMirrorHost from '../../editor/CodeMirrorHost.vue';
import type { RangeHighlight } from '../../editor/variableHighlight';
import IconButton from '../../theme/primitives/IconButton.vue';
import MessageStrip from '../../theme/primitives/MessageStrip.vue';
import SegmentedControl from '../../theme/primitives/SegmentedControl.vue';
import { beautifyFor, canBeautify } from '../shared/celleditor/formats';
import BinaryBodyPicker from './BinaryBodyPicker.vue';
import FormDataTable from './FormDataTable.vue';
import UrlEncodedTable from './UrlEncodedTable.vue';

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
  /** P16 D13: HttpRequestView.vue's own #toolbar-2 filter box, forwarded to whichever body mode
   *  is a row table (urlencoded, form-data) — a no-op for the raw/code/binary modes below. */
  filterQuery?: string;
  /** P22b D7: HttpRequestView.vue's own persisted description-column toggle, forwarded the same
   *  way — a no-op for the raw/code/binary modes below. */
  showDescriptions?: boolean;
  /** P28 D11: the hoisted find bar's own ranges for whichever of the two text editors is showing.
   *  This pane's `rangeHighlights` compartment was already spoken for by P15b's {{variable}}
   *  colouring (F12 in the response pane's own comment names that as the reason the find bar could
   *  never reach the request body), so the two sources are merged below rather than one replacing
   *  the other. */
  findHighlights?: (doc: string) => readonly RangeHighlight[];
}>();

/** P28 D11: variable ranges first, find ranges second — a match's class wins on overlap, which is
 *  what a user searching for text that happens to sit inside a {{reference}} expects to see.
 *  rangeHighlightPlugin sorts and validates whatever it is handed, so no ordering guarantee is
 *  required of this concatenation beyond that intent. Identity changes whenever either source
 *  does, which is what makes CodeMirrorHost's own watch repaint. */
const bodyHighlights = computed<((doc: string) => readonly RangeHighlight[]) | undefined>(() => {
  const vars = props.variables?.rangeHighlights;
  const find = props.findHighlights;
  if (!find) return vars;
  if (!vars) return find;
  return (doc: string) => [...vars(doc), ...find(doc)];
});

/** The two editable text buffers this pane can show, in the order the find bar numbers them —
 *  exactly one is mounted at a time, so this is a one-element list or empty. */
const findableDoc = computed<string | null>(() => {
  if (props.tab.state.bodyMode === 'raw') return props.tab.state.body;
  if (props.tab.state.bodyMode === 'code') return props.tab.state.code;
  return null;
});
// The mounted editor host, so the find bar can scroll a match into view — exactly one of the two
// is ever mounted, so whichever ref is non-null is the live one.
const rawHostRef = ref<{ scrollRangeIntoView(from: number, to: number): void } | null>(null);
const codeHostRef = ref<{ scrollRangeIntoView(from: number, to: number): void } | null>(null);
const findHost = computed(() => rawHostRef.value ?? codeHostRef.value);
defineExpose({ findableDoc, findHost });

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
      ref="rawHostRef"
      language="plain"
      :read-only="false"
      :range-highlights="bodyHighlights"
      :hover-source="variables && variableHoverSource(variables.hoverAt)"
      :autocomplete="!!variables"
      :completion-sources="variables && [variableCompletionSource(variables.candidates)]"
      auto-close-brackets
      @update:doc="onRawChange"
    />
    <CodeMirrorHost
      v-else-if="tab.state.bodyMode === 'code'"
      :doc="tab.state.code"
      ref="codeHostRef"
      :language="editorLanguage"
      :read-only="false"
      :range-highlights="bodyHighlights"
      :hover-source="variables && variableHoverSource(variables.hoverAt)"
      :autocomplete="!!variables"
      :completion-sources="variables && [variableCompletionSource(variables.candidates)]"
      auto-close-brackets
      @update:doc="onCodeChange"
    />
    <UrlEncodedTable
      v-else-if="tab.state.bodyMode === 'urlencoded'"
      :tab="tab"
      :variables="variables"
      :filter-query="filterQuery"
      :show-descriptions="showDescriptions"
    />
    <FormDataTable
      v-else-if="tab.state.bodyMode === 'formdata'"
      :tab="tab"
      :variables="variables"
      :filter-query="filterQuery"
      :show-descriptions="showDescriptions"
    />
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
