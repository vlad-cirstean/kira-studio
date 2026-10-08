<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Alert } from '@theme/components/ui/alert';
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
import { useMobileTerminalsStore } from '../../state/mobileTerminals';
import { MOBILE_PORT_RANGE } from '../../state/settingsDomain';
import MobileQr from './MobileQr.vue';
import type { SettingsPaneProps } from './types';

// Bypasses draft/Save like ConnectedEditorsPane: enabling, trusting a network, port changes and
// revoke are actions on a running server, not settings leaves.
defineProps<SettingsPaneProps>();

// '' is NaN, not 0, so an emptied field fails the whole-number check.
function parseIntField(raw: string): number {
  const text = raw.trim();
  return text === '' ? Number.NaN : Number(text);
}

const relativeTime = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
function expiresIn(at: number): string {
  const hours = Math.round((at - Date.now()) / 3_600_000);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour');
  return relativeTime.format(Math.round(hours / 24), 'day');
}

const store = useMobileAccessStore();
const phones = useMobileTerminalsStore();
const confirmDialogStore = useConfirmDialogStore();
const switchId = useId();
const agentInputId = useId();
const portId = useId();

const portDraft = ref(String(store.status.port));
watch(
  () => store.status.port,
  (port) => {
    portDraft.value = String(port);
  },
);

const portError = computed(() => {
  const port = parseIntField(portDraft.value);
  if (!Number.isInteger(port)) return 'Enter a whole number.';
  if (port < MOBILE_PORT_RANGE.min || port > MOBILE_PORT_RANGE.max) {
    return `Ports run from ${MOBILE_PORT_RANGE.min} to ${MOBILE_PORT_RANGE.max}.`;
  }
  return null;
});
const portChanged = computed(() => parseIntField(portDraft.value) !== store.status.port);

const { busy: toggling, run: onToggle } = useBusyAction((on: boolean) => store.setEnabled(on));
const { busy: togglingAgentInput, run: onToggleAgentInput } = useBusyAction((on: boolean) =>
  store.setAgentInput(on),
);
const { run: onSetPermissions } = useBusyAction(
  (id: string, write: boolean, agentInput: boolean) =>
    store.setDevicePermissions(id, { write, agentInput }),
);
const { busy: applying, run: onApplyPort } = useBusyAction(() =>
  store.setPort(parseIntField(portDraft.value)),
);
const { busy: trusting, run: runTrust } = useBusyAction(() => store.trustNetwork());
const { run: runForget } = useBusyAction(() => store.forgetNetwork());

const current = computed(() => store.status.current);
const trusted = computed(() => store.status.trusted);
const canTrust = computed(() => {
  const now = current.value;
  const was = trusted.value;
  if (!now) return false;
  return (
    !was ||
    was.subnet !== now.subnet ||
    was.routerIp !== now.routerIp ||
    was.routerMac !== now.routerMac
  );
});

async function onTrust(): Promise<void> {
  const now = current.value;
  if (!now) return;
  const ok = await confirmDialogStore.confirmDialog(
    `Trust ${now.subnet} (router ${now.routerMac})? The phone talks to Kira Space over plain HTTP: anyone on this network can read what it shows. Turn this on only on a network you control, such as your home Wi-Fi.`,
    { confirmLabel: 'Trust' },
  );
  if (ok) await runTrust();
}

async function onForget(): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    'Forget the trusted network? The phone server stops until you trust a network again.',
    { danger: true, confirmLabel: 'Forget' },
  );
  if (ok) await runForget();
}

async function onRevoke(id: string, label: string): Promise<void> {
  const ok = await confirmDialogStore.confirmDialog(
    `Revoke access for "${label || id}"? It will need to be re-approved.`,
    { danger: true, confirmLabel: 'Revoke' },
  );
  if (ok) await store.revoke(id);
}

const activeDevices = computed(() =>
  store.devices.filter((d) => !d.revokedAt && d.expiresAt > Date.now()),
);
</script>

<template>
  <div class="contents" v-show="active">
    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="switchId">View Agents from a phone on my trusted network</Label>
      </div>
      <Switch
        :id="switchId"
        :model-value="store.status.enabled"
        :disabled="toggling"
        data-testid="mobile-access-enabled"
        @update:model-value="(v) => onToggle(v === true)"
      />
      <FieldDescription>
        A phone on your trusted home network pairs once, then sees the board, backlog and plan. Each
        phone can also change the backlog and move or start tasks, and reply to agents. The server
        runs only while this computer is on that network.
      </FieldDescription>
      <FieldError v-if="store.status.error" data-testid="mobile-access-error">
        {{ store.status.error }}
      </FieldError>
    </Field>

    <Alert variant="warn" data-testid="mobile-access-plaintext-warning">
      The phone talks to Kira Space over plain HTTP. Anyone on the same network can read the board,
      backlog and terminal output it shows, and can copy the phone's access and act as that phone
      until it expires or you revoke it. Turn this on only on a network you control, such as your
      home Wi-Fi.
    </Alert>

    <section class="flex flex-col gap-1" data-testid="mobile-access-network">
      <h3 class="m-0 text-kira-sm font-semibold">Trusted network</h3>
      <p v-if="trusted" class="m-0 text-kira-sm" data-testid="mobile-access-trusted">
        {{ trusted.subnet }}, router {{ trusted.routerIp }} ({{ trusted.routerMac }}), trusted on
        {{ trusted.interface }}
        <template v-if="store.status.trustedAt">
          on {{ new Date(store.status.trustedAt).toLocaleDateString() }}
        </template>
      </p>
      <p v-else class="m-0 text-subtle text-kira-sm" data-testid="mobile-access-trusted">
        No trusted network.
      </p>
      <p v-if="current" class="m-0 text-subtle text-kira-sm" data-testid="mobile-access-current">
        This computer: {{ current.address }} on {{ current.subnet }}, router {{ current.routerIp }}
        ({{ current.routerMac }})
      </p>
      <p v-else class="m-0 text-subtle text-kira-sm" data-testid="mobile-access-current">
        This computer is not on a private local network.
      </p>
      <div class="flex gap-2">
        <Button
          variant="dialog"
          size="kira-lg"
          :disabled="trusting || !canTrust"
          data-testid="mobile-access-trust"
          @click="onTrust"
        >
          Trust this network
        </Button>
        <Button
          v-if="trusted"
          variant="dialog"
          size="kira-lg"
          data-testid="mobile-access-forget"
          @click="onForget"
        >
          Forget
        </Button>
      </div>
      <p
        v-if="store.status.enabled && !store.status.running && store.status.stopDetail"
        class="m-0 text-kira-sm"
        data-testid="mobile-access-stopped-reason"
      >
        {{ store.status.stopDetail }}
      </p>
    </section>

    <section v-if="store.status.running" class="flex flex-col gap-1" data-testid="mobile-access-step-app">
      <h3 class="m-0 text-kira-sm font-semibold">Open the app</h3>
      <figure class="m-0 flex flex-col gap-0.5">
        <MobileQr :url="store.status.appUrl" />
        <figcaption class="font-data text-kira-sm break-all select-all">{{ store.status.appUrl }}</figcaption>
      </figure>
    </section>

    <Field>
      <div class="flex items-center justify-between gap-1">
        <Label :for="agentInputId">Let phones reply to agents and control their terminals</Label>
      </div>
      <Switch
        :id="agentInputId"
        :model-value="store.status.agentInput"
        :disabled="togglingAgentInput"
        data-testid="mobile-access-agent-input"
        @update:model-value="(v) => onToggleAgentInput(v === true)"
      />
      <FieldDescription>
        Anyone holding a phone with this on can type into Claude Code and run commands as you. Each
        phone also needs its own Agent input switch below. Turning this off ends every phone
        terminal now.
      </FieldDescription>
    </Field>

    <Field>
      <Label :for="portId">Port</Label>
      <NumberStepperInput
        :id="portId"
        :min="MOBILE_PORT_RANGE.min"
        :max="MOBILE_PORT_RANGE.max"
        data-testid="mobile-access-port"
        :model-value="portDraft"
        @input="(e: Event) => (portDraft = (e.target as HTMLInputElement).value)"
      />
      <FieldError v-if="portError" data-testid="mobile-access-port-error">{{ portError }}</FieldError>
      <Button
        variant="dialog"
        size="kira-lg"
        class="self-start"
        :disabled="applying || !!portError || !portChanged"
        data-testid="mobile-access-apply-port"
        @click="onApplyPort"
      >
        Apply port
      </Button>
    </Field>

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
            <span
              class="text-subtle text-kira-sm leading-normal"
              :data-testid="`mobile-device-expires-${device.id}`"
            >
              Access expires {{ expiresIn(device.expiresAt) }}
            </span>
            <span
              v-if="phones.countFor(device.id) > 0"
              class="text-kira-sm leading-normal"
              :data-testid="`mobile-device-terminals-${device.id}`"
            >
              Controlling {{ phones.countFor(device.id) }} terminal{{ phones.countFor(device.id) === 1 ? '' : 's' }}
            </span>
          </span>
          <span class="flex shrink-0 items-center gap-2">
            <Label class="flex items-center gap-1 text-kira-sm">
              Changes
              <Switch
                :model-value="device.canWrite"
                :data-testid="`mobile-device-write-${device.id}`"
                @update:model-value="
                  (v) => onSetPermissions(device.id, v === true, device.canAgentInput)
                "
              />
            </Label>
            <Label class="flex items-center gap-1 text-kira-sm">
              Agent input
              <Switch
                :model-value="device.canAgentInput"
                :disabled="!store.status.agentInput"
                :data-testid="`mobile-device-agent-input-${device.id}`"
                @update:model-value="(v) => onSetPermissions(device.id, device.canWrite, v === true)"
              />
            </Label>
            <TooltipIconButton
              icon="trash"
              label="Revoke"
              variant="danger"
              :data-testid="`mobile-device-revoke-${device.id}`"
              @click="onRevoke(device.id, device.label)"
            />
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
