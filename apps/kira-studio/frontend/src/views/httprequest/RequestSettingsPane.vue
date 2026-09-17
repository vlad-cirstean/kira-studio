<script setup lang="ts">
import {
  HTTP_VERSIONS,
  MAX_REDIRECTS_RANGE,
  MAX_RESPONSE_MB_RANGE,
  REQUEST_TIMEOUT_MS_RANGE,
} from '@shared/domain/settings';
import type { HttpRequestTabRecord } from '@shared/domain/tabs';
import { computed } from 'vue';
import { patchHttpRequestTabState } from '../../api/tabs';
import { openSettingsAt, settingsState } from '../../state/settings';
import Checkbox from '../../theme/primitives/Checkbox.vue';
import TextField from '../../theme/primitives/TextField.vue';

// P90 §2.6: one row per api settings leaf, in SPEC's own order — a control bound to
// tab.state.settings.<leaf>, an "Inherit" checkbox (checked === the leaf is null), and helper text
// naming the inherited value straight off settingsState.api. No resolver function shared with Go —
// the rule is one `??` per leaf, and writing it twice as a function would be the drift risk, not
// the fix (§2.6's own reasoning).
const props = defineProps<{ tab: HttpRequestTabRecord }>();

function patch(fields: Partial<HttpRequestTabRecord['state']['settings']>): void {
  patchHttpRequestTabState(props.tab.id, { settings: { ...props.tab.state.settings, ...fields } });
}

const settings = computed(() => props.tab.state.settings);
const global = computed(() => settingsState.api);

function onHttpVersionChange(e: Event): void {
  patch({ httpVersion: (e.target as HTMLSelectElement).value as (typeof HTTP_VERSIONS)[number] });
}
function onHttpVersionInherit(inherit: boolean): void {
  patch({ httpVersion: inherit ? null : global.value.httpVersion });
}

function onRequestTimeoutMsInput(e: Event): void {
  patch({ requestTimeoutMs: Number((e.target as HTMLInputElement).value) });
}
function onRequestTimeoutMsInherit(inherit: boolean): void {
  patch({ requestTimeoutMs: inherit ? null : global.value.requestTimeoutMs });
}

function onMaxResponseMbInput(e: Event): void {
  patch({ maxResponseMb: Number((e.target as HTMLInputElement).value) });
}
function onMaxResponseMbInherit(inherit: boolean): void {
  patch({ maxResponseMb: inherit ? null : global.value.maxResponseMb });
}

function onSslVerifyChange(checked: boolean): void {
  patch({ sslVerify: checked });
}
function onSslVerifyInherit(inherit: boolean): void {
  patch({ sslVerify: inherit ? null : global.value.sslVerify });
}

function onFollowRedirectsChange(checked: boolean): void {
  patch({ followRedirects: checked });
}
function onFollowRedirectsInherit(inherit: boolean): void {
  patch({ followRedirects: inherit ? null : global.value.followRedirects });
}

function onMaxRedirectsInput(e: Event): void {
  patch({ maxRedirects: Number((e.target as HTMLInputElement).value) });
}
function onMaxRedirectsInherit(inherit: boolean): void {
  patch({ maxRedirects: inherit ? null : global.value.maxRedirects });
}

function onDisableCookieJarChange(checked: boolean): void {
  patch({ disableCookieJar: checked });
}
function onDisableCookieJarInherit(inherit: boolean): void {
  patch({ disableCookieJar: inherit ? null : global.value.disableCookieJar });
}

const effectiveFollowRedirects = computed(
  () => settings.value.followRedirects ?? global.value.followRedirects,
);

function onEditGlobalDefaults(): void {
  openSettingsAt('Api');
}
</script>

<template>
  <div class="settings-pane" data-testid="http-settings-pane">
    <label class="field">
      <div class="field-head">
        <span>HTTP version</span>
        <label class="inherit">
          <Checkbox
            :model-value="settings.httpVersion === null"
            data-testid="http-settings-httpVersion-inherit"
            @update:model-value="onHttpVersionInherit"
          />
          Inherit
        </label>
      </div>
      <select
        class="p-select bordered md"
        data-testid="http-settings-httpVersion"
        :disabled="settings.httpVersion === null"
        :value="settings.httpVersion ?? global.httpVersion"
        @change="onHttpVersionChange"
      >
        <option v-for="v in HTTP_VERSIONS" :key="v" :value="v">HTTP/{{ v }}</option>
      </select>
      <span class="helper-text">Global: HTTP/{{ global.httpVersion }}</span>
    </label>

    <label class="field">
      <div class="field-head">
        <span>Request timeout (ms)</span>
        <label class="inherit">
          <Checkbox
            :model-value="settings.requestTimeoutMs === null"
            data-testid="http-settings-requestTimeoutMs-inherit"
            @update:model-value="onRequestTimeoutMsInherit"
          />
          Inherit
        </label>
      </div>
      <TextField
        type="number"
        :min="REQUEST_TIMEOUT_MS_RANGE.min"
        :max="REQUEST_TIMEOUT_MS_RANGE.max"
        size="md"
        :disabled="settings.requestTimeoutMs === null"
        data-testid="http-settings-requestTimeoutMs"
        :model-value="String(settings.requestTimeoutMs ?? global.requestTimeoutMs)"
        @input="onRequestTimeoutMsInput"
      />
      <span class="helper-text">
        Global: {{ global.requestTimeoutMs === 0 ? 'no timeout' : `${global.requestTimeoutMs} ms` }}
      </span>
    </label>

    <label class="field">
      <div class="field-head">
        <span>Max response size (MB)</span>
        <label class="inherit">
          <Checkbox
            :model-value="settings.maxResponseMb === null"
            data-testid="http-settings-maxResponseMb-inherit"
            @update:model-value="onMaxResponseMbInherit"
          />
          Inherit
        </label>
      </div>
      <TextField
        type="number"
        :min="MAX_RESPONSE_MB_RANGE.min"
        :max="MAX_RESPONSE_MB_RANGE.max"
        size="md"
        :disabled="settings.maxResponseMb === null"
        data-testid="http-settings-maxResponseMb"
        :model-value="String(settings.maxResponseMb ?? global.maxResponseMb)"
        @input="onMaxResponseMbInput"
      />
      <span class="helper-text">
        Global: {{ global.maxResponseMb === 0 ? 'unlimited' : `${global.maxResponseMb} MB` }}
      </span>
    </label>

    <div class="field checkbox-row">
      <label class="field checkbox">
        <Checkbox
          :model-value="settings.sslVerify ?? global.sslVerify"
          :disabled="settings.sslVerify === null"
          data-testid="http-settings-sslVerify"
          @update:model-value="onSslVerifyChange"
        />
        <span>Verify SSL certificates</span>
      </label>
      <label class="inherit">
        <Checkbox
          :model-value="settings.sslVerify === null"
          data-testid="http-settings-sslVerify-inherit"
          @update:model-value="onSslVerifyInherit"
        />
        Inherit
      </label>
    </div>
    <span class="helper-text">Global: {{ global.sslVerify ? 'on' : 'off' }}</span>

    <div class="field checkbox-row">
      <label class="field checkbox">
        <Checkbox
          :model-value="settings.followRedirects ?? global.followRedirects"
          :disabled="settings.followRedirects === null"
          data-testid="http-settings-followRedirects"
          @update:model-value="onFollowRedirectsChange"
        />
        <span>Follow redirects</span>
      </label>
      <label class="inherit">
        <Checkbox
          :model-value="settings.followRedirects === null"
          data-testid="http-settings-followRedirects-inherit"
          @update:model-value="onFollowRedirectsInherit"
        />
        Inherit
      </label>
    </div>
    <span class="helper-text">Global: {{ global.followRedirects ? 'on' : 'off' }}</span>

    <label class="field">
      <div class="field-head">
        <span>Max redirects</span>
        <label class="inherit">
          <Checkbox
            :model-value="settings.maxRedirects === null"
            data-testid="http-settings-maxRedirects-inherit"
            @update:model-value="onMaxRedirectsInherit"
          />
          Inherit
        </label>
      </div>
      <TextField
        type="number"
        :min="MAX_REDIRECTS_RANGE.min"
        :max="MAX_REDIRECTS_RANGE.max"
        size="md"
        :disabled="settings.maxRedirects === null || !effectiveFollowRedirects"
        data-testid="http-settings-maxRedirects"
        :model-value="String(settings.maxRedirects ?? global.maxRedirects)"
        @input="onMaxRedirectsInput"
      />
      <span v-if="!effectiveFollowRedirects" class="helper-text">
        Follow redirects is off — this has no effect.
      </span>
      <span v-else class="helper-text">Global: {{ global.maxRedirects }}</span>
    </label>

    <div class="field checkbox-row">
      <label class="field checkbox">
        <Checkbox
          :model-value="settings.disableCookieJar ?? global.disableCookieJar"
          :disabled="settings.disableCookieJar === null"
          data-testid="http-settings-disableCookieJar"
          @update:model-value="onDisableCookieJarChange"
        />
        <span>Disable cookie jar</span>
      </label>
      <label class="inherit">
        <Checkbox
          :model-value="settings.disableCookieJar === null"
          data-testid="http-settings-disableCookieJar-inherit"
          @update:model-value="onDisableCookieJarInherit"
        />
        Inherit
      </label>
    </div>
    <span class="helper-text">Global: {{ global.disableCookieJar ? 'off' : 'on' }}</span>

    <button class="hint-link" data-testid="http-settings-edit-global" @click="onEditGlobalDefaults">
      Edit global defaults…
    </button>
  </div>
</template>

<style scoped>
.settings-pane {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-3);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  font-size: var(--kira-t-sm);
}

.field > span:first-child {
  color: var(--kira-fg-muted);
}

.field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--kira-s-2);
}

.field.checkbox {
  flex-direction: row;
  align-items: center;
  gap: var(--kira-s-3);
}

.checkbox-row {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.inherit {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  font-size: var(--kira-t-xs);
  color: var(--kira-fg-muted);
}

.helper-text {
  color: var(--kira-fg-subtle);
  font-size: var(--kira-t-xs);
  line-height: 1.5;
}

.hint-link {
  align-self: flex-start;
  background: none;
  border: none;
  padding: 0;
  color: var(--kira-accent);
  cursor: pointer;
  font-size: var(--kira-t-sm);
}
</style>
