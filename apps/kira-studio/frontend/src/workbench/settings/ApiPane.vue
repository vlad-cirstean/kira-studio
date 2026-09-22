<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Input } from '@theme/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import {
  type ApiSettings,
  HTTP_VERSIONS,
  MAX_REDIRECTS_RANGE,
  MAX_RESPONSE_MB_RANGE,
  REQUEST_TIMEOUT_MS_RANGE,
} from '../../state/settingsDomain';
import type { SettingsPaneProps } from './types';

// P103 Part 2 (§5.5): extracted verbatim from workbench/SettingsDialog.vue's own
// `v-else-if="activeSection === 'Api'"` branch — P90 §2.7's own global Api section.
const props = defineProps<SettingsPaneProps>();

function onHttpVersionChange(e: Event): void {
  props.draft.api.httpVersion = (e.target as HTMLSelectElement).value as ApiSettings['httpVersion'];
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
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('api', 'httpVersion') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-api-httpVersion"
              :disabled="isAtDefault('api', 'httpVersion')"
              aria-label="Reset to default"
              @click="resetLeaf('api', 'httpVersion')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
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
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('api', 'requestTimeoutMs') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-api-requestTimeoutMs"
              :disabled="isAtDefault('api', 'requestTimeoutMs')"
              aria-label="Reset to default"
              @click="resetLeaf('api', 'requestTimeoutMs')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <Input
        type="number"
        :min="REQUEST_TIMEOUT_MS_RANGE.min"
        :max="REQUEST_TIMEOUT_MS_RANGE.max"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        :aria-invalid="!!requestTimeoutMsError || undefined"
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
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('api', 'maxResponseMb') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-api-maxResponseMb"
              :disabled="isAtDefault('api', 'maxResponseMb')"
              aria-label="Reset to default"
              @click="resetLeaf('api', 'maxResponseMb')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <Input
        type="number"
        :min="MAX_RESPONSE_MB_RANGE.min"
        :max="MAX_RESPONSE_MB_RANGE.max"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        :aria-invalid="!!maxResponseMbError || undefined"
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
          class="size-3.5"
          :model-value="draft.api.sslVerify"
          data-testid="settings-api-sslVerify"
          @update:model-value="(v) => onSslVerifyChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Verify SSL certificates</span>
      </label>
      <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('api', 'sslVerify') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="p-push"
            data-testid="settings-reset-api-sslVerify"
            :disabled="isAtDefault('api', 'sslVerify')"
            aria-label="Reset to default"
            @click="resetLeaf('api', 'sslVerify')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
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
          class="size-3.5"
          :model-value="draft.api.followRedirects"
          data-testid="settings-api-followRedirects"
          @update:model-value="(v) => onFollowRedirectsChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Follow redirects</span>
      </label>
      <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('api', 'followRedirects') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="p-push"
            data-testid="settings-reset-api-followRedirects"
            :disabled="isAtDefault('api', 'followRedirects')"
            aria-label="Reset to default"
            @click="resetLeaf('api', 'followRedirects')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>

    <label class="field">
      <div class="field-head">
        <span>Max redirects</span>
        <Tooltip>
        <TooltipTrigger as-child>
          <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('api', 'maxRedirects') }">
            <Button
              variant="toolbar"
              size="kira-icon"
              data-testid="settings-reset-api-maxRedirects"
              :disabled="isAtDefault('api', 'maxRedirects')"
              aria-label="Reset to default"
              @click="resetLeaf('api', 'maxRedirects')"
            >
              <CodiconIcon name="discard" :size="13" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <Input
        type="number"
        :min="MAX_REDIRECTS_RANGE.min"
        :max="MAX_REDIRECTS_RANGE.max"
        class="h-control-lg w-full rounded-kira-sm border-border-strong bg-input px-2 font-data"
        :disabled="!draft.api.followRedirects"
        :aria-invalid="!!maxRedirectsError || undefined"
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
          class="size-3.5"
          :model-value="draft.api.disableCookieJar"
          data-testid="settings-api-disableCookieJar"
          @update:model-value="(v) => onDisableCookieJarChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <span>Disable cookie jar</span>
        <span class="helper-text"
          >Off keeps a session cookie a server sets and replays it on later requests to
          the same host.</span
        >
      </label>
      <Tooltip>
      <TooltipTrigger as-child>
        <span tabindex="0" class="inline-flex" :class="{ 'pointer-events-none': isAtDefault('api', 'disableCookieJar') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="p-push"
            data-testid="settings-reset-api-disableCookieJar"
            :disabled="isAtDefault('api', 'disableCookieJar')"
            aria-label="Reset to default"
            @click="resetLeaf('api', 'disableCookieJar')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
