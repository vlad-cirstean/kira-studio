<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Button } from '@theme/components/ui/button';
import { Field, FieldDescription, FieldError } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import NumberStepperInput from '@theme/NumberStepperInput.vue';
import { useConfirmDialogStore } from '@workbench/state/confirmDialog';
import { formatRelative } from '@workbench/util/format';
import { useBusyAction } from '@workbench/util/useBusyAction';
import { computed, ref, useId, watch } from 'vue';
import { useMobileAccessStore } from '../../state/mobileAccess';
import { MOBILE_PORT_RANGE } from '../../state/settingsDomain';
import MobileQr from './MobileQr.vue';
import type { SettingsPaneProps } from './types';

// Bypasses draft/Save like ConnectedEditorsPane: enabling, port changes, certificate reset and
// revoke are actions on a running server, not settings leaves.
defineProps<SettingsPaneProps>();

// '' is NaN, not 0, so an emptied field fails the whole-number check.
function parseIntField(raw: string): number {
  const text = raw.trim();
  return text === '' ? Number.NaN : Number(text);
}

const store = useMobileAccessStore();
const confirmDialogStore = useConfirmDialogStore();
const switchId = useId();
const httpsId = useId();
const setupId = useId();

const httpsDraft = ref(String(store.status.httpsPort));
const setupDraft = ref(String(store.status.setupPort));
watch(
  () => [store.status.httpsPort, store.status.setupPort] as const,
  ([https, setup]) => {
    httpsDraft.value = String(https);
    setupDraft.value = String(setup);
  },
);

const portError = computed(() => {
  const https = parseIntField(httpsDraft.value);
  const setup = parseIntField(setupDraft.value);
  for (const n of [https, setup]) {
    if (!Number.isInteger(n)) return 'Enter a whole number.';
    if (n < MOBILE_PORT_RANGE.min || n > MOBILE_PORT_RANGE.max) {
      return `Ports run from ${MOBILE_PORT_RANGE.min} to ${MOBILE_PORT_RANGE.max}.`;
    }
  }
  return https === setup ? 'The two ports must differ.' : null;
});
const portsChanged = computed(
  () =>
    parseIntField(httpsDraft.value) !== store.status.httpsPort ||
    parseIntField(setupDraft.value) !== store.status.setupPort,
);

const { busy: toggling, run: onToggle } = useBusyAction((on: boolean) => store.setEnabled(on));
const { busy: applying, run: onApplyPorts } = useBusyAction(() =>
  store.setPorts(parseIntField(httpsDraft.value), parseIntField(setupDraft.value)),
);

async function onReset(): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    'Reset the certificate? Every phone must install the new certificate again.',
    { danger: true, confirmLabel: 'Reset' },
  );
  if (ok) await store.resetCertificate();
}

async function onRevoke(id: string, label: string): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    `Revoke access for "${label || id}"? It will need to be re-approved.`,
    { danger: true, confirmLabel: 'Revoke' },
  );
  if (ok) await store.revoke(id);
}

// One QR per bound address; a phone cannot reach loopback.
function reachable(urls: string[]): string[] {
  return urls.filter((u) => {
    const host = new URL(u).hostname;
    return host !== 'localhost' && !host.startsWith('127.');
  });
}
const setupUrls = computed(() => reachable(store.status.setupUrls));
const appUrls = computed(() => reachable(store.status.appUrls));
const activeDevices = computed(() => store.devices.filter((d) => !d.revokedAt));
</script>

<template>
  <div class="contents" v-show="active">
    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="switchId">View Agents from a phone on this network</Label>
      </div>
      <Switch
        :id="switchId"
        :model-value="store.status.enabled"
        :disabled="toggling"
        data-testid="mobile-access-enabled"
        @update:model-value="(v) => onToggle(v === true)"
      />
      <FieldDescription>
        Read-only. A phone on your local network pairs once, then sees the board, backlog and plan.
        Only private network addresses are served.
      </FieldDescription>
      <FieldError v-if="store.status.error" data-testid="mobile-access-error">
        {{ store.status.error }}
      </FieldError>
    </Field>

    <Field>
      <Label :for="httpsId">App port</Label>
      <NumberStepperInput
        :id="httpsId"
        :min="MOBILE_PORT_RANGE.min"
        :max="MOBILE_PORT_RANGE.max"
        data-testid="mobile-access-https-port"
        :model-value="httpsDraft"
        @input="(e: Event) => (httpsDraft = (e.target as HTMLInputElement).value)"
      />
      <Label :for="setupId">Setup port</Label>
      <NumberStepperInput
        :id="setupId"
        :min="MOBILE_PORT_RANGE.min"
        :max="MOBILE_PORT_RANGE.max"
        data-testid="mobile-access-setup-port"
        :model-value="setupDraft"
        @input="(e: Event) => (setupDraft = (e.target as HTMLInputElement).value)"
      />
      <FieldError v-if="portError" data-testid="mobile-access-port-error">{{ portError }}</FieldError>
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        :disabled="applying || !!portError || !portsChanged"
        data-testid="mobile-access-apply-ports"
        @click="onApplyPorts"
      >
        Apply ports
      </Button>
    </Field>

    <template v-if="store.status.running">
      <section class="flex flex-col gap-1" data-testid="mobile-access-step-certificate">
        <h3 class="m-0 text-kira-sm font-semibold">1. Install the certificate</h3>
        <FieldDescription>
          Scan with the phone's camera and install the profile it downloads. Compare the
          fingerprint on the phone.
        </FieldDescription>
        <div class="flex flex-wrap gap-2">
          <figure v-for="url in setupUrls" :key="url" class="m-0 flex flex-col gap-0.5">
            <MobileQr :url="url" />
            <figcaption class="font-data text-kira-sm break-all select-all">{{ url }}</figcaption>
          </figure>
        </div>
        <p class="m-0 font-data text-kira-sm break-all select-all" data-testid="mobile-access-fingerprint">
          {{ store.status.fingerprint }}
        </p>
        <Button
          variant="dialog"
          size="kira-lg"
          class="self-start"
          data-testid="mobile-access-reset-certificate"
          @click="onReset"
        >
          Reset certificate
        </Button>
      </section>

      <section class="flex flex-col gap-1" data-testid="mobile-access-step-app">
        <h3 class="m-0 text-kira-sm font-semibold">2. Open the app</h3>
        <div class="flex flex-wrap gap-2">
          <figure v-for="url in appUrls" :key="url" class="m-0 flex flex-col gap-0.5">
            <MobileQr :url="url" />
            <figcaption class="font-data text-kira-sm break-all select-all">{{ url }}</figcaption>
          </figure>
        </div>
      </section>
    </template>

    <section class="flex flex-col gap-1">
      <h3 class="m-0 text-kira-sm font-semibold">Paired phones</h3>
      <p v-if="activeDevices.length === 0" class="text-subtle text-kira-sm" data-testid="mobile-devices-empty">
        No phones are paired.
      </p>
      <ul v-else class="m-0 flex list-none flex-col gap-1 p-0">
        <li
          v-for="device in activeDevices"
          :key="device.id"
          class="flex items-center justify-between gap-1"
          :data-testid="`mobile-device-row-${device.id}`"
        >
          <span class="flex min-w-0 flex-col">
            <span class="truncate">{{ device.label || device.id }}</span>
            <span class="text-subtle text-kira-sm leading-normal">
              Last seen {{ formatRelative(device.lastSeenAt) }}<template v-if="device.lastIp"> from {{ device.lastIp }}</template>
            </span>
          </span>
          <TooltipIconButton
            icon="trash"
            label="Revoke"
            variant="danger"
            :data-testid="`mobile-device-revoke-${device.id}`"
            @click="onRevoke(device.id, device.label)"
          />
        </li>
      </ul>
    </section>
  </div>
</template>
