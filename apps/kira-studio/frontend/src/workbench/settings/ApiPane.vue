<script setup lang="ts">
import {
  HTTP_VERSIONS,
  MAX_REDIRECTS_RANGE,
  MAX_RESPONSE_MB_RANGE,
  REQUEST_TIMEOUT_MS_RANGE,
  type Settings,
} from '@shared/domain/settings';
import Checkbox from '@theme/primitives/Checkbox.vue';
import IconButton from '@theme/primitives/IconButton.vue';
import TextField from '@theme/primitives/TextField.vue';
import { computed } from 'vue';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Api'"` branch — P90 §2.7's own global Api section.
const props = defineProps<SettingsPaneProps>();

function onHttpVersionChange(e: Event): void {
  props.draft.api.httpVersion = (e.target as HTMLSelectElement).value as Settings['api']['httpVersion'];
}
function onRequestTimeoutMsInput(e: Event): void {
  props.draft.api.requestTimeoutMs = Number((e.target as HTMLInputElement).value);
}
function onMaxResponseMbInput(e: Event): void {
  props.draft.api.maxResponseMb = Number((e.target as HTMLInputElement).value);
}
function onSslVerifyChange(checked: boolean): void {
  props.draft.api.sslVerify = checked;
}
function onFollowRedirectsChange(checked: boolean): void {
  props.draft.api.followRedirects = checked;
}
function onMaxRedirectsInput(e: Event): void {
  props.draft.api.maxRedirects = Number((e.target as HTMLInputElement).value);
}
function onDisableCookieJarChange(checked: boolean): void {
  props.draft.api.disableCookieJar = checked;
}

const requestTimeoutMsError = computed<string | null>(() => {
  const v = props.draft.api.requestTimeoutMs;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < REQUEST_TIMEOUT_MS_RANGE.min || v > REQUEST_TIMEOUT_MS_RANGE.max) {
    return `${REQUEST_TIMEOUT_MS_RANGE.min}–${REQUEST_TIMEOUT_MS_RANGE.max.toLocaleString()} ms`;
  }
  return null;
});
props.registerFieldError('api.requestTimeoutMs', requestTimeoutMsError);

const maxResponseMbError = computed<string | null>(() => {
  const v = props.draft.api.maxResponseMb;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < MAX_RESPONSE_MB_RANGE.min || v > MAX_RESPONSE_MB_RANGE.max) {
    return `${MAX_RESPONSE_MB_RANGE.min}–${MAX_RESPONSE_MB_RANGE.max} MB`;
  }
  return null;
});
props.registerFieldError('api.maxResponseMb', maxResponseMbError);

const maxRedirectsError = computed<string | null>(() => {
  const v = props.draft.api.maxRedirects;
  if (!Number.isFinite(v)) return 'Enter a number.';
  if (v < MAX_REDIRECTS_RANGE.min || v > MAX_REDIRECTS_RANGE.max) {
    return `${MAX_REDIRECTS_RANGE.min}–${MAX_REDIRECTS_RANGE.max}`;
  }
  return null;
});
props.registerFieldError('api.maxRedirects', maxRedirectsError);
</script>

<template>
  <div class="settings-pane" v-show="active">
    <label class="field">
      <div class="field-head">
        <span>HTTP version</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-api-httpVersion"
          :disabled="isAtDefault('api', 'httpVersion')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('api', 'httpVersion')"
        />
      </div>
      <select
        class="p-select bordered md"
        data-testid="settings-api-httpVersion"
        :value="draft.api.httpVersion"
        @change="onHttpVersionChange"
      >
        <option v-for="v in HTTP_VERSIONS" :key="v" :value="v">HTTP/{{ v }}</option>
      </select>
    </label>

    <label class="field">
      <div class="field-head">
        <span>Request timeout (ms)</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-api-requestTimeoutMs"
          :disabled="isAtDefault('api', 'requestTimeoutMs')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('api', 'requestTimeoutMs')"
        />
      </div>
      <TextField
        type="number"
        :min="REQUEST_TIMEOUT_MS_RANGE.min"
        :max="REQUEST_TIMEOUT_MS_RANGE.max"
        size="md"
        :invalid="!!requestTimeoutMsError"
        data-testid="settings-api-requestTimeoutMs"
        :model-value="String(draft.api.requestTimeoutMs)"
        @input="onRequestTimeoutMsInput"
      />
      <span
        v-if="requestTimeoutMsError"
        class="field-error"
        data-testid="settings-api-requestTimeoutMs-error"
      >
        {{ requestTimeoutMsError }}
      </span>
      <span v-else class="helper-text">0 = no timeout.</span>
    </label>

    <label class="field">
      <div class="field-head">
        <span>Max response size (MB)</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-api-maxResponseMb"
          :disabled="isAtDefault('api', 'maxResponseMb')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('api', 'maxResponseMb')"
        />
      </div>
      <TextField
        type="number"
        :min="MAX_RESPONSE_MB_RANGE.min"
        :max="MAX_RESPONSE_MB_RANGE.max"
        size="md"
        :invalid="!!maxResponseMbError"
        data-testid="settings-api-maxResponseMb"
        :model-value="String(draft.api.maxResponseMb)"
        @input="onMaxResponseMbInput"
      />
      <span
        v-if="maxResponseMbError"
        class="field-error"
        data-testid="settings-api-maxResponseMb-error"
      >
        {{ maxResponseMbError }}
      </span>
      <span v-else class="helper-text">0 = unlimited. A larger body is truncated, not refused.</span>
    </label>

    <div class="field checkbox-row">
      <label class="field checkbox">
        <Checkbox
          :model-value="draft.api.sslVerify"
          data-testid="settings-api-sslVerify"
          @update:model-value="onSslVerifyChange"
        />
        <span>Verify SSL certificates</span>
      </label>
      <IconButton
        icon="discard"
        class="p-push"
        data-testid="settings-reset-api-sslVerify"
        :disabled="isAtDefault('api', 'sslVerify')"
        v-tooltip="'Reset to default'"
        @click="resetLeaf('api', 'sslVerify')"
      />
    </div>
    <p v-if="!draft.api.sslVerify" class="field-error" data-testid="settings-api-sslVerify-warning">
      Turning certificate verification off lets any server present any certificate.
      Anything on the network between you and the server can then read and modify every
      request and response, including credentials. Leave this on unless you are testing
      against a server with a self-signed certificate you control.
    </p>

    <div class="field checkbox-row">
      <label class="field checkbox">
        <Checkbox
          :model-value="draft.api.followRedirects"
          data-testid="settings-api-followRedirects"
          @update:model-value="onFollowRedirectsChange"
        />
        <span>Follow redirects</span>
      </label>
      <IconButton
        icon="discard"
        class="p-push"
        data-testid="settings-reset-api-followRedirects"
        :disabled="isAtDefault('api', 'followRedirects')"
        v-tooltip="'Reset to default'"
        @click="resetLeaf('api', 'followRedirects')"
      />
    </div>

    <label class="field">
      <div class="field-head">
        <span>Max redirects</span>
        <IconButton
          icon="discard"
          data-testid="settings-reset-api-maxRedirects"
          :disabled="isAtDefault('api', 'maxRedirects')"
          v-tooltip="'Reset to default'"
          @click="resetLeaf('api', 'maxRedirects')"
        />
      </div>
      <TextField
        type="number"
        :min="MAX_REDIRECTS_RANGE.min"
        :max="MAX_REDIRECTS_RANGE.max"
        size="md"
        :disabled="!draft.api.followRedirects"
        :invalid="!!maxRedirectsError"
        data-testid="settings-api-maxRedirects"
        :model-value="String(draft.api.maxRedirects)"
        @input="onMaxRedirectsInput"
      />
      <span
        v-if="maxRedirectsError"
        class="field-error"
        data-testid="settings-api-maxRedirects-error"
      >
        {{ maxRedirectsError }}
      </span>
      <span v-else-if="!draft.api.followRedirects" class="helper-text">
        Follow redirects is off — this has no effect.
      </span>
    </label>

    <div class="field checkbox-row">
      <label class="field checkbox">
        <Checkbox
          :model-value="draft.api.disableCookieJar"
          data-testid="settings-api-disableCookieJar"
          @update:model-value="onDisableCookieJarChange"
        />
        <span>Disable cookie jar</span>
        <span class="helper-text"
          >Off keeps a session cookie a server sets and replays it on later requests to
          the same host.</span
        >
      </label>
      <IconButton
        icon="discard"
        class="p-push"
        data-testid="settings-reset-api-disableCookieJar"
        :disabled="isAtDefault('api', 'disableCookieJar')"
        v-tooltip="'Reset to default'"
        @click="resetLeaf('api', 'disableCookieJar')"
      />
    </div>
  </div>
</template>
