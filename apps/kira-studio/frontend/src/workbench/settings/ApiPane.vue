<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Checkbox } from '@theme/components/ui/checkbox';
import { Field, FieldDescription, FieldError, FieldGroup } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import {
  Tooltip,
  TooltipContent,
  TooltipDisabledTrigger,
  TooltipTrigger,
} from '@theme/components/ui/tooltip';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import { computed, useId } from 'vue';
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

function onHttpVersionChange(value: unknown): void {
  props.draft.api.httpVersion = String(value) as ApiSettings['httpVersion'];
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

// P110 I2-26: `for`/`id` preserves the old <label>-wraps-control implicit association (see
// FontSizeField.vue's own precedent comment) now that the field wrapper is a plain <Field class="items-center"> div.
const httpVersionId = useId();
const requestTimeoutMsId = useId();
const maxResponseMbId = useId();
const sslVerifyId = useId();
const followRedirectsId = useId();
const maxRedirectsId = useId();
const disableCookieJarId = useId();
</script>

<template>
  <div class="contents" v-show="active">
    <Field class="items-center">
      <div class="flex items-center justify-between gap-1">
        <Label :for="httpVersionId" class="text-kira-sm">HTTP version</Label>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('api', 'httpVersion') }">
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
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <NativeSelect
        :id="httpVersionId"
        variant="bordered"
        size="kira-lg"
        data-testid="settings-api-httpVersion"
        :model-value="draft.api.httpVersion"
        @update:model-value="onHttpVersionChange"
      >
        <option v-for="v in HTTP_VERSIONS" :key="v" :value="v">HTTP/{{ v }}</option>
      </NativeSelect>
    </Field>

    <Field class="items-center">
      <div class="flex items-center justify-between gap-1">
        <Label :for="requestTimeoutMsId" class="text-kira-sm">Request timeout (ms)</Label>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('api', 'requestTimeoutMs') }">
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
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <NumberStepperInput
        :id="requestTimeoutMsId"
        :min="REQUEST_TIMEOUT_MS_RANGE.min"
        :max="REQUEST_TIMEOUT_MS_RANGE.max"
        :aria-invalid="!!requestTimeoutMsError || undefined"
        data-testid="settings-api-requestTimeoutMs"
        :model-value="String(draft.api.requestTimeoutMs)"
        @input="onRequestTimeoutMsInput"
      />
      <FieldError
        v-if="requestTimeoutMsError"
        data-testid="settings-api-requestTimeoutMs-error"
      >
        {{ requestTimeoutMsError }}
      </FieldError>
      <FieldDescription v-else>0 = no timeout.</FieldDescription>
    </Field>

    <Field class="items-center">
      <div class="flex items-center justify-between gap-1">
        <Label :for="maxResponseMbId" class="text-kira-sm">Max response size (MB)</Label>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('api', 'maxResponseMb') }">
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
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <NumberStepperInput
        :id="maxResponseMbId"
        :min="MAX_RESPONSE_MB_RANGE.min"
        :max="MAX_RESPONSE_MB_RANGE.max"
        :aria-invalid="!!maxResponseMbError || undefined"
        data-testid="settings-api-maxResponseMb"
        :model-value="String(draft.api.maxResponseMb)"
        @input="onMaxResponseMbInput"
      />
      <FieldError
        v-if="maxResponseMbError"
        data-testid="settings-api-maxResponseMb-error"
      >
        {{ maxResponseMbError }}
      </FieldError>
      <FieldDescription v-else>0 = unlimited. A larger body is truncated, not refused.</FieldDescription>
    </Field>

    <FieldGroup>
      <Field orientation="horizontal">
        <Checkbox
          :id="sslVerifyId"
          class="size-3.5"
          :model-value="draft.api.sslVerify"
          data-testid="settings-api-sslVerify"
          @update:model-value="(v) => onSslVerifyChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <Label :for="sslVerifyId" class="text-kira-sm">Verify SSL certificates</Label>
      </Field>
      <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('api', 'sslVerify') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="ml-auto"
            data-testid="settings-reset-api-sslVerify"
            :disabled="isAtDefault('api', 'sslVerify')"
            aria-label="Reset to default"
            @click="resetLeaf('api', 'sslVerify')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </FieldGroup>
    <FieldError v-if="!draft.api.sslVerify" data-testid="settings-api-sslVerify-warning">
      Turning certificate verification off lets any server present any certificate.
      Anything on the network between you and the server can then read and modify every
      request and response, including credentials. Leave this on unless you are testing
      against a server with a self-signed certificate you control.
    </FieldError>

    <FieldGroup>
      <Field orientation="horizontal">
        <Checkbox
          :id="followRedirectsId"
          class="size-3.5"
          :model-value="draft.api.followRedirects"
          data-testid="settings-api-followRedirects"
          @update:model-value="(v) => onFollowRedirectsChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <Label :for="followRedirectsId" class="text-kira-sm">Follow redirects</Label>
      </Field>
      <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('api', 'followRedirects') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="ml-auto"
            data-testid="settings-reset-api-followRedirects"
            :disabled="isAtDefault('api', 'followRedirects')"
            aria-label="Reset to default"
            @click="resetLeaf('api', 'followRedirects')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </FieldGroup>

    <Field class="items-center">
      <div class="flex items-center justify-between gap-1">
        <Label :for="maxRedirectsId" class="text-kira-sm">Max redirects</Label>
        <Tooltip>
        <TooltipTrigger as-child>
          <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('api', 'maxRedirects') }">
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
          </TooltipDisabledTrigger>
        </TooltipTrigger>
        <TooltipContent>Reset to default</TooltipContent>
        </Tooltip>
      </div>
      <NumberStepperInput
        :id="maxRedirectsId"
        :min="MAX_REDIRECTS_RANGE.min"
        :max="MAX_REDIRECTS_RANGE.max"
        :disabled="!draft.api.followRedirects"
        :aria-invalid="!!maxRedirectsError || undefined"
        data-testid="settings-api-maxRedirects"
        :model-value="String(draft.api.maxRedirects)"
        @input="onMaxRedirectsInput"
      />
      <FieldError
        v-if="maxRedirectsError"
        data-testid="settings-api-maxRedirects-error"
      >
        {{ maxRedirectsError }}
      </FieldError>
      <FieldDescription v-else-if="!draft.api.followRedirects">
        Follow redirects is off — this has no effect.
      </FieldDescription>
    </Field>

    <FieldGroup>
      <Field orientation="horizontal">
        <Checkbox
          :id="disableCookieJarId"
          class="size-3.5"
          :model-value="draft.api.disableCookieJar"
          data-testid="settings-api-disableCookieJar"
          @update:model-value="(v) => onDisableCookieJarChange(v === true)"
        >
          <CodiconIcon name="check" :size="10" />
        </Checkbox>
        <Label :for="disableCookieJarId" class="text-kira-sm">Disable cookie jar</Label>
        <FieldDescription
          >Off keeps a session cookie a server sets and replays it on later requests to
          the same host.</FieldDescription
        >
      </Field>
      <Tooltip>
      <TooltipTrigger as-child>
        <TooltipDisabledTrigger :class="{ 'pointer-events-none': isAtDefault('api', 'disableCookieJar') }">
          <Button
            variant="toolbar"
            size="kira-icon"
          class="ml-auto"
            data-testid="settings-reset-api-disableCookieJar"
            :disabled="isAtDefault('api', 'disableCookieJar')"
            aria-label="Reset to default"
            @click="resetLeaf('api', 'disableCookieJar')"
          >
            <CodiconIcon name="discard" :size="13" />
          </Button>
        </TooltipDisabledTrigger>
      </TooltipTrigger>
      <TooltipContent>Reset to default</TooltipContent>
      </Tooltip>
    </FieldGroup>
  </div>
</template>
