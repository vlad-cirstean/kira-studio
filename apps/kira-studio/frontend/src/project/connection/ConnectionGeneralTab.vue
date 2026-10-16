<script setup lang="ts">
import { PALETTE_COLOR_CHOICES } from '@shared/domain/color';
import {
  AWS_STYLE_KINDS,
  FILE_KINDS,
  MIN_SERVER_VERSION,
  SECRET_OPTION_KEYS,
} from '@shared/domain/connection';
import { canRoundTripToFields, formatConnectionUri, parseConnectionUri } from '@shared/domain/uri';
import CodiconIcon from '@theme/CodiconIcon.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { TabsContent } from '@theme/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { colourLabel } from '@theme/connColor';
import { t } from '@theme/i18n';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import SwatchRadio from '@theme/SwatchRadio.vue';
import { computed, ref } from 'vue';
import { control } from '../../bridge/control';
import { useConnectionDialogStore } from '../../state/connections';
import CredentialPastePanel from '../credentialPaste/CredentialPastePanel.vue';
import type { PasteField } from '../credentialPaste/parse';
import { injectConnectionForm } from './form';
import { injectConnectionReveal } from './reveal';

const connectionDialogStore = useConnectionDialogStore();
const { errorFor, errorId, invalidAttrs } = injectConnectionForm();
const { showPassword, revealed, onEyeClick, onPasswordInput, setUri } = injectConnectionReveal();

const draft = computed(() => connectionDialogStore.draft);
const connectionColors = PALETTE_COLOR_CHOICES;

const MODE_ITEMS = computed(
  () =>
    [
      { value: 'fields', label: t('studio.common.fields.label'), testid: 'mode-fields' },
      {
        value: 'uri',
        label: t('studio.project.connectionDialog.mode.uri.label'),
        testid: 'mode-uri',
      },
    ] as const,
);

// SQS/S3 have no host/port: fields mode repurposes `database` for the AWS region and `username`
// for a named profile. A file kind (SQLite) carries the absolute path in `database`.
const isAwsStyle = computed(() => !!draft.value && AWS_STYLE_KINDS.has(draft.value.kind));
const isFileStyle = computed(() => !!draft.value && FILE_KINDS.has(draft.value.kind));
const minVersionNote = computed(() =>
  draft.value ? MIN_SERVER_VERSION[draft.value.kind] : undefined,
);

// Only the mode-flip messages: nothing derives display from the URI, which stays masked.
const uriNote = ref('');

function setMode(mode: 'fields' | 'uri'): void {
  const d = draft.value;
  if (!d || mode === d.mode) return;
  uriNote.value = '';

  if (mode === 'uri') {
    // The password stays in the draft; Go folds it into the stored URI on Save.
    d.uri = formatConnectionUri({ ...d, password: null });
    d.mode = 'uri';
    return;
  }

  if (d.uri === null) {
    uriNote.value = t('studio.project.connectionDialog.uriNote.hidden.hint');
    return;
  }
  // URI -> fields flips only when it round-trips; otherwise stay in URI mode and say why.
  const parsed = parseConnectionUri(d.uri);
  if (!parsed || !canRoundTripToFields(parsed, d.kind)) {
    uriNote.value = parsed
      ? t('studio.project.connectionDialog.uriNote.notRepresentable.hint')
      : t('studio.project.connectionDialog.uriNote.unparsable.hint');
    return;
  }
  const secretKey = Object.keys(parsed.params).find((k) => SECRET_OPTION_KEYS.has(k.toLowerCase()));
  if (secretKey) {
    uriNote.value = t('studio.project.connectionDialog.uriNote.secretParam.hint', {
      param: secretKey,
    });
    return;
  }
  d.host = parsed.host;
  d.port = parsed.port;
  d.database = parsed.database;
  d.username = parsed.username;
  if (parsed.password) d.password = parsed.password;
  d.options = parsed.params;
  d.mode = 'fields';
  // Fields mode is authoritative: a stale URI (which can carry a password) must not linger.
  d.uri = null;
}

// Parse on the way in; a non-numeric value falls back to null instead of entering a numeric field.
function setPort(value: string): void {
  const d = draft.value;
  if (!d) return;
  const n = Number.parseFloat(value);
  d.port = Number.isNaN(n) ? null : n;
}

const pasteOpen = ref(false);
const pasteAllowed = computed<readonly PasteField[]>(() => {
  const kind = draft.value?.kind;
  if (kind && AWS_STYLE_KINDS.has(kind)) return ['region', 'profile'];
  if (kind === 'mongodb') return ['host', 'port', 'database', 'username', 'password', 'authSource'];
  return ['host', 'port', 'database', 'username', 'password'];
});

function onPasteApply(values: Partial<Record<PasteField, string>>): void {
  const d = draft.value;
  pasteOpen.value = false;
  if (!d) return;
  const aws = AWS_STYLE_KINDS.has(d.kind);
  const database = aws ? values.region : values.database;
  const username = aws ? values.profile : values.username;
  if (values.host !== undefined) d.host = values.host;
  if (values.port !== undefined) d.port = Number(values.port);
  if (database !== undefined) d.database = database;
  if (username !== undefined) d.username = username;
  if (values.password !== undefined) onPasswordInput(values.password);
  if (values.authSource !== undefined) d.options = { ...d.options, authSource: values.authSource };
}

async function onBrowseDatabaseFile(): Promise<void> {
  const d = draft.value;
  if (!d) return;
  const res = await control.filesChooseOpen({
    filters: [
      {
        name: t('studio.project.connectionDialog.sqliteFilter.label'),
        extensions: ['sqlite', 'sqlite3', 'db', 'db3'],
      },
      { name: t('studio.common.allFiles.label'), extensions: ['*'] },
    ],
    title: t('studio.project.connectionDialog.databasePicker.title'),
  });
  if (!res.canceled && res.file) d.database = res.file.path;
}
</script>

<template>
  <TabsContent v-if="draft" value="General" class="flex flex-col gap-3 p-3">
    <div class="flex gap-2 items-start">
      <Field class="flex-2">
        <FieldLabel>{{ t('common.field.name.label') }}</FieldLabel>
        <Input
          v-model="draft.name"
          v-bind="invalidAttrs('name')"
          class="font-ui"
          data-testid="connection-name"
        />
        <FieldError
          v-if="errorFor('name')"
          :id="errorId('name')"
          data-testid="connection-name-error"
          >{{
            errorFor('name')
          }}</FieldError
        >
      </Field>
      <Field class="flex-none">
        <FieldLabel>{{ t('common.field.colour.label') }}</FieldLabel>
        <fieldset
          class="color-picker m-0 flex h-6.5 flex-wrap items-center gap-1 border-0 p-0"
          :aria-label="t('studio.project.connectionDialog.colour.aria')"
        >
          <Tooltip v-for="color in connectionColors" :key="color">
            <TooltipTrigger as-child>
              <SwatchRadio
                name="connection-color"
                :value="color"
                :color="color"
                :checked="draft.color === color"
                @change="draft.color = color"
              />
            </TooltipTrigger>
            <TooltipContent>{{ colourLabel(color) }}</TooltipContent>
          </Tooltip>
        </fieldset>
      </Field>
    </div>

    <FieldDescription v-if="minVersionNote" data-testid="connection-min-version">{{
      minVersionNote
    }}</FieldDescription>

    <div class="flex items-end gap-2">
      <Field class="flex-1">
        <FieldLabel>{{ t('common.mode.label') }}</FieldLabel>
        <SecondaryTabs
          variant="segmented"
          size="kira-lg"
          :model-value="draft.mode"
          :items="MODE_ITEMS"
          @update:model-value="(v) => setMode(v as 'fields' | 'uri')"
        />
      </Field>
      <Popover v-if="draft.mode === 'fields' && !isFileStyle" v-model:open="pasteOpen">
        <PopoverTrigger as-child>
          <Button variant="dialog" size="kira-lg" data-testid="connection-paste-credentials">
            <CodiconIcon name="clippy" :size="13" />
            {{ t('studio.project.connectionDialog.pasteCredentials.label') }}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" class="w-96" data-testid="connection-paste-popover">
          <CredentialPastePanel
            :kind="draft.kind"
            :allowed="pasteAllowed"
            @apply="onPasteApply"
            @cancel="pasteOpen = false"
          />
        </PopoverContent>
      </Popover>
    </div>

    <template v-if="draft.mode === 'fields' && isFileStyle">
      <Field class="flex-1">
        <FieldLabel>{{ t('studio.project.connectionDialog.databaseFile.label') }}</FieldLabel>
        <div class="flex items-center gap-1">
          <div class="flex-1 min-w-0">
            <Input
              :model-value="draft.database ?? ''"
              v-bind="invalidAttrs('database')"
              class="font-data"
              data-testid="connection-database"
              @update:model-value="draft.database = String($event)"
            />
          </div>
          <Button
            variant="dialog"
            size="kira-lg"
            data-testid="connection-browse"
            @click="onBrowseDatabaseFile"
          >
            {{ t('studio.common.browse.label') }}
          </Button>
        </div>
        <FieldError v-if="errorFor('database')" :id="errorId('database')">{{
          errorFor('database')
        }}</FieldError>
      </Field>
    </template>
    <template v-else-if="draft.mode === 'fields'">
      <div v-if="!isAwsStyle" class="flex gap-2 items-start">
        <Field class="flex-1">
          <FieldLabel>{{ t('studio.project.connectionDialog.host.label') }}</FieldLabel>
          <Input
            :model-value="draft.host ?? ''"
            v-bind="invalidAttrs('host')"
            class="font-data"
            data-testid="connection-host"
            @update:model-value="draft.host = String($event)"
          />
          <FieldError v-if="errorFor('host')" :id="errorId('host')">{{
            errorFor('host')
          }}</FieldError>
        </Field>
        <Field class="flex-none basis-24">
          <FieldLabel>{{ t('common.port.label') }}</FieldLabel>
          <NumberStepperInput
            :model-value="draft.port != null ? String(draft.port) : ''"
            v-bind="invalidAttrs('port')"
            data-testid="connection-port"
            @update:model-value="(v: string | number) => setPort(String(v))"
          />
          <FieldError v-if="errorFor('port')" :id="errorId('port')">{{
            errorFor('port')
          }}</FieldError>
        </Field>
      </div>
      <div v-if="isAwsStyle" class="flex gap-2 items-start">
        <Field class="flex-1">
          <FieldLabel>{{ t('studio.project.connectionDialog.region.label') }}</FieldLabel>
          <Input
            :model-value="draft.database ?? ''"
            v-bind="invalidAttrs('database')"
            class="font-data"
            data-testid="connection-database"
            @update:model-value="draft.database = String($event)"
          />
          <FieldError v-if="errorFor('database')" :id="errorId('database')">{{
            errorFor('database')
          }}</FieldError>
        </Field>
        <Field class="flex-1">
          <FieldLabel>{{ t('studio.project.connectionDialog.awsProfile.label') }}</FieldLabel>
          <Input
            :model-value="draft.username ?? ''"
            class="font-data"
            data-testid="connection-username"
            @update:model-value="draft.username = String($event)"
          />
        </Field>
      </div>
      <template v-else>
        <Field class="flex-1">
          <FieldLabel>{{ t('studio.project.connectionDialog.database.label') }}</FieldLabel>
          <Input
            :model-value="draft.database ?? ''"
            v-bind="invalidAttrs('database')"
            class="font-data"
            data-testid="connection-database"
            @update:model-value="draft.database = String($event)"
          />
          <FieldError v-if="errorFor('database')" :id="errorId('database')">{{
            errorFor('database')
          }}</FieldError>
        </Field>
        <div class="flex gap-2 items-start">
          <Field class="flex-1">
            <FieldLabel>{{ t('common.user.label') }}</FieldLabel>
            <Input
              :model-value="draft.username ?? ''"
              class="font-data"
              data-testid="connection-username"
              @update:model-value="draft.username = String($event)"
            />
          </Field>
          <Field class="flex-1">
            <FieldLabel>{{ t('studio.project.connectionDialog.password.label') }}</FieldLabel>
            <div class="flex items-center gap-1">
              <div class="flex-1 min-w-0">
                <Input
                  :model-value="draft.password ?? ''"
                  :type="showPassword ? 'text' : 'password'"
                  class="font-data"
                  :placeholder="revealed ? undefined : t('studio.project.connectionDialog.unchanged.placeholder')"
                  data-testid="connection-password"
                  @update:model-value="(v) => onPasswordInput(String(v))"
                />
              </div>
              <TooltipIconButton
                :icon="showPassword ? 'eye-closed' : 'eye'"
                :label="showPassword ? t('studio.project.connectionDialog.hidePassword.label') : t('studio.project.connectionDialog.showPassword.label')"
                @click="onEyeClick"
              />
            </div>
          </Field>
        </div>
      </template>
    </template>
    <template v-else>
      <Field class="flex-1">
        <FieldLabel>{{ t('studio.project.connectionDialog.mode.uri.label') }}</FieldLabel>
        <div class="flex items-center gap-1">
          <div class="flex-1 min-w-0">
            <Input
              :model-value="draft.uri ?? ''"
              v-bind="invalidAttrs('uri')"
              :type="showPassword ? 'text' : 'password'"
              class="font-data"
              :placeholder="revealed ? undefined : t('studio.project.connectionDialog.unchanged.placeholder')"
              data-testid="connection-uri"
              @update:model-value="(v) => setUri(String(v))"
            />
          </div>
          <TooltipIconButton
            :icon="showPassword ? 'eye-closed' : 'eye'"
            :label="showPassword ? t('studio.project.connectionDialog.hideUri.label') : t('studio.project.connectionDialog.showUri.label')"
            @click="onEyeClick"
          />
        </div>
        <FieldError v-if="errorFor('uri')" :id="errorId('uri')">{{ errorFor('uri') }}</FieldError>
      </Field>
      <FieldDescription class="font-data" data-testid="connection-uri-note">{{
        uriNote
      }}</FieldDescription>
    </template>
  </TabsContent>
</template>
