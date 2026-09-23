<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { computed } from 'vue';
import { patchHttpRequestTabState } from '../../api/tabs';
import { useSettingsStore } from '../../state/settings';
import {
  HTTP_VERSIONS,
  MAX_REDIRECTS_RANGE,
  MAX_RESPONSE_MB_RANGE,
  REQUEST_TIMEOUT_MS_RANGE,
} from '../../state/settingsDomain';
import type { HttpRequestTabRecord } from '../../state/tabDomain';

// P90 §2.6: one row per api settings leaf, in SPEC's own order — a control bound to
// tab.state.settings.<leaf>, an "Inherit" checkbox (checked === the leaf is null), and helper text
// naming the inherited value straight off settingsStore.api. No resolver function shared with Go —
// the rule is one `??` per leaf, and writing it twice as a function would be the drift risk, not
// the fix (§2.6's own reasoning).
const props = defineProps<{ tab: HttpRequestTabRecord }>();
const settingsStore = useSettingsStore();

function patch(fields: Partial<HttpRequestTabRecord['state']['settings']>): void {
  patchHttpRequestTabState(props.tab.id, { settings: { ...props.tab.state.settings, ...fields } });
}

const settings = computed(() => props.tab.state.settings);
const global = computed(() => settingsStore.api);

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
  settingsStore.openSettingsAt('Api');
}
</script>

<template>
  <div class="settings-pane" data-testid="http-settings-pane">
    <Label class="field">
      <div class="field-head">
        <span>HTTP version</span>
        <Label class="inherit">
          <Checkbox
            :model-value="settings.httpVersion === null"
            data-testid="http-settings-httpVersion-inherit"
            @update:model-value="(v) => onHttpVersionInherit(v === true)"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
          Inherit
        </Label>
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
    </Label>

    <Label class="field">
      <div class="field-head">
        <span>Request timeout (ms)</span>
        <Label class="inherit">
          <Checkbox
            :model-value="settings.requestTimeoutMs === null"
            data-testid="http-settings-requestTimeoutMs-inherit"
            @update:model-value="(v) => onRequestTimeoutMsInherit(v === true)"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
          Inherit
        </Label>
      </div>
      <Input
        type="number"
        :min="REQUEST_TIMEOUT_MS_RANGE.min"
        :max="REQUEST_TIMEOUT_MS_RANGE.max"
        :disabled="settings.requestTimeoutMs === null"
        data-testid="http-settings-requestTimeoutMs"
        :model-value="String(settings.requestTimeoutMs ?? global.requestTimeoutMs)"
        @input="onRequestTimeoutMsInput"
      />
      <span class="helper-text">
        Global: {{ global.requestTimeoutMs === 0 ? 'no timeout' : `${global.requestTimeoutMs} ms` }}
      </span>
    </Label>

    <Label class="field">
      <div class="field-head">
        <span>Max response size (MB)</span>
        <Label class="inherit">
          <Checkbox
            :model-value="settings.maxResponseMb === null"
            data-testid="http-settings-maxResponseMb-inherit"
            @update:model-value="(v) => onMaxResponseMbInherit(v === true)"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
          Inherit
        </Label>
      </div>
      <Input
        type="number"
        :min="MAX_RESPONSE_MB_RANGE.min"
        :max="MAX_RESPONSE_MB_RANGE.max"
        :disabled="settings.maxResponseMb === null"
        data-testid="http-settings-maxResponseMb"
        :model-value="String(settings.maxResponseMb ?? global.maxResponseMb)"
        @input="onMaxResponseMbInput"
      />
      <span class="helper-text">
        Global: {{ global.maxResponseMb === 0 ? 'unlimited' : `${global.maxResponseMb} MB` }}
      </span>
    </Label>

    <div class="field checkbox-row">
      <Label class="field checkbox">
        <Checkbox
          :model-value="settings.sslVerify ?? global.sslVerify"
          :disabled="settings.sslVerify === null"
          data-testid="http-settings-sslVerify"
          @update:model-value="(v) => onSslVerifyChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Verify SSL certificates</span>
      </Label>
      <Label class="inherit">
        <Checkbox
          :model-value="settings.sslVerify === null"
          data-testid="http-settings-sslVerify-inherit"
          @update:model-value="(v) => onSslVerifyInherit(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        Inherit
      </Label>
    </div>
    <span class="helper-text">Global: {{ global.sslVerify ? 'on' : 'off' }}</span>

    <div class="field checkbox-row">
      <Label class="field checkbox">
        <Checkbox
          :model-value="settings.followRedirects ?? global.followRedirects"
          :disabled="settings.followRedirects === null"
          data-testid="http-settings-followRedirects"
          @update:model-value="(v) => onFollowRedirectsChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Follow redirects</span>
      </Label>
      <Label class="inherit">
        <Checkbox
          :model-value="settings.followRedirects === null"
          data-testid="http-settings-followRedirects-inherit"
          @update:model-value="(v) => onFollowRedirectsInherit(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        Inherit
      </Label>
    </div>
    <span class="helper-text">Global: {{ global.followRedirects ? 'on' : 'off' }}</span>

    <Label class="field">
      <div class="field-head">
        <span>Max redirects</span>
        <Label class="inherit">
          <Checkbox
            :model-value="settings.maxRedirects === null"
            data-testid="http-settings-maxRedirects-inherit"
            @update:model-value="(v) => onMaxRedirectsInherit(v === true)"
          >
            <CodiconIcon name="check" :size="10" />
          </Checkbox>
          Inherit
        </Label>
      </div>
      <Input
        type="number"
        :min="MAX_REDIRECTS_RANGE.min"
        :max="MAX_REDIRECTS_RANGE.max"
        :disabled="settings.maxRedirects === null || !effectiveFollowRedirects"
        data-testid="http-settings-maxRedirects"
        :model-value="String(settings.maxRedirects ?? global.maxRedirects)"
        @input="onMaxRedirectsInput"
      />
      <span v-if="!effectiveFollowRedirects" class="helper-text">
        Follow redirects is off — this has no effect.
      </span>
      <span v-else class="helper-text">Global: {{ global.maxRedirects }}</span>
    </Label>

    <div class="field checkbox-row">
      <Label class="field checkbox">
        <Checkbox
          :model-value="settings.disableCookieJar ?? global.disableCookieJar"
          :disabled="settings.disableCookieJar === null"
          data-testid="http-settings-disableCookieJar"
          @update:model-value="(v) => onDisableCookieJarChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Disable cookie jar</span>
      </Label>
      <Label class="inherit">
        <Checkbox
          :model-value="settings.disableCookieJar === null"
          data-testid="http-settings-disableCookieJar-inherit"
          @update:model-value="(v) => onDisableCookieJarInherit(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        Inherit
      </Label>
    </div>
    <span class="helper-text">Global: {{ global.disableCookieJar ? 'off' : 'on' }}</span>

    <button type="button" class="hint-link" data-testid="http-settings-edit-global" @click="onEditGlobalDefaults">
      Edit global defaults…
    </button>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.settings-pane {
  @apply flex flex-1 min-h-0 flex-col gap-1.5 overflow-auto p-1.5;
}

.field {
  @apply flex flex-col gap-1 text-kira-sm;
}

.field > span:first-child {
  @apply text-muted;
}

.field-head {
  @apply flex items-center justify-between gap-1;
}

.field.checkbox {
  @apply flex-row items-center gap-1.5;
}

.checkbox-row {
  @apply flex-row items-center justify-between;
}

.inherit {
  @apply flex items-center gap-1 text-muted text-kira-xs;
}

.helper-text {
  @apply text-subtle text-kira-xs leading-normal;
}

.hint-link {
  @apply self-start cursor-pointer border-0 bg-none p-0 text-kira-sm text-primary;
}
</style>
