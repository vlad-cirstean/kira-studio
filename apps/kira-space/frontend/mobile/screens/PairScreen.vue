<script setup lang="ts">
import { Alert } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { storeToRefs } from 'pinia';
import { computed, ref, useId } from 'vue';
import { useAuthStore } from '../state/auth';

const auth = useAuthStore();
const { phase, code, message } = storeToRefs(auth);
const labelId = useId();

// A friendly default the user can edit; the desktop prompt shows it next to the code.
function defaultLabel(): string {
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const ua = navigator.userAgent;
  const platform = data?.platform || (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : 'Phone');
  return platform;
}
const label = ref(defaultLabel());

const waiting = computed(() => phase.value === 'requesting');
const notice = computed(() => {
  switch (phase.value) {
    case 'denied':
      return 'Access was denied on the computer.';
    case 'timedOut':
      return 'Nobody answered on the computer in time.';
    case 'revoked':
      return 'This phone was removed in Kira Space. Request access again to reconnect.';
    case 'unreachable':
      return 'Cannot reach Kira Space. Check that the computer is awake and on this network.';
    default:
      return message.value;
  }
});
const insecure = !window.isSecureContext;
</script>

<template>
  <main class="mx-auto flex min-h-full w-full max-w-md flex-col justify-center gap-4 px-4 py-8" data-testid="pair-screen">
    <h1 class="m-0 text-kira-xl font-semibold">Kira Space Agents</h1>
    <p class="m-0 text-muted-foreground">
      View your agents from this phone. It is read-only, and the computer must approve this phone
      first.
    </p>

    <Alert v-if="insecure" variant="warn" data-testid="pair-insecure">
      This page is not secure. Open the setup page from Kira Space on the computer, install the
      certificate, then open the https address.
    </Alert>

    <template v-if="waiting">
      <div class="flex flex-col gap-1 rounded-kira border border-border bg-elevated p-3" data-testid="pair-waiting">
        <span class="text-muted-foreground">Check this code in Kira Space on the computer</span>
        <span class="font-data text-kira-xl tracking-widest" data-testid="pair-code">{{ code }}</span>
      </div>
      <Button variant="dialog" size="kira-lg" data-testid="pair-cancel" @click="auth.cancelRequest()">Cancel</Button>
    </template>

    <template v-else>
      <Alert v-if="notice" variant="destructive" data-testid="pair-notice">{{ notice }}</Alert>
      <div class="flex flex-col gap-1">
        <Label :for="labelId">Name this phone</Label>
        <Input :id="labelId" v-model="label" maxlength="64" autocomplete="off" data-testid="pair-label" />
      </div>
      <Button
        variant="dialog-primary"
        size="kira-lg"
        :disabled="!label.trim()"
        data-testid="pair-request"
        @click="auth.requestAccess(label.trim())"
      >
        Request access
      </Button>
    </template>
  </main>
</template>
