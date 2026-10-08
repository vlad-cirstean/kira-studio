<script setup lang="ts">
import { Alert } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@theme/components/ui/tabs';
import { useFetch } from '@vueuse/core';
import { computed } from 'vue';

// Served over plain HTTP: the one page that must load before the phone trusts the certificate.
interface SetupInfo {
  fingerprint: string;
  appUrls: string[];
}
const { data, error } = useFetch('/setup-info').json<SetupInfo>();
const info = computed(() => data.value);
const platform = /iPhone|iPad|iPod/.test(navigator.userAgent) ? 'ios' : 'android';
// The app lives on the same host, over HTTPS; the first listed URL is the most reachable one.
const appUrl = computed(() => {
  const url = info.value?.appUrls.find((u) => u.includes(location.hostname)) ?? info.value?.appUrls[0];
  return url ?? null;
});
</script>

<template>
  <main class="mx-auto flex min-h-full w-full max-w-md flex-col gap-4 px-4 py-8" data-testid="setup-page">
    <h1 class="m-0 text-kira-xl font-semibold">Set up Kira Space Agents</h1>
    <p class="m-0 text-muted-foreground">
      Install the certificate once so this phone can open Kira Space over a secure connection. Then
      open the app and ask the computer for access.
    </p>
    <Alert v-if="error" variant="destructive" data-testid="setup-error">
      Cannot reach Kira Space. Is the computer awake and on this network?
    </Alert>

    <Tabs :default-value="platform">
      <TabsList>
        <TabsTrigger value="ios" data-testid="setup-tab-ios">iPhone</TabsTrigger>
        <TabsTrigger value="android" data-testid="setup-tab-android">Android</TabsTrigger>
      </TabsList>
      <TabsContent value="ios" class="flex flex-col gap-2 pt-2">
        <ol class="m-0 flex list-decimal flex-col gap-1 pl-5">
          <li>Tap Download profile and allow it.</li>
          <li>Open Settings, then Profile Downloaded, and tap Install.</li>
          <li>Open Settings, General, About, Certificate Trust Settings. Turn on Kira Space local CA.</li>
        </ol>
        <Button as="a" href="/kira-space-ca.mobileconfig" variant="dialog-primary" size="kira-lg" data-testid="setup-download-ios">
          Download profile
        </Button>
      </TabsContent>
      <TabsContent value="android" class="flex flex-col gap-2 pt-2">
        <ol class="m-0 flex list-decimal flex-col gap-1 pl-5">
          <li>Tap Download certificate.</li>
          <li>Open Settings and search for CA certificate.</li>
          <li>Choose Install anyway, then pick the downloaded file.</li>
        </ol>
        <Button as="a" href="/kira-space-ca.crt" variant="dialog-primary" size="kira-lg" data-testid="setup-download-android">
          Download certificate
        </Button>
      </TabsContent>
    </Tabs>

    <section v-if="info" class="flex flex-col gap-1" data-testid="setup-fingerprint-block">
      <span class="text-muted-foreground">Certificate fingerprint. It must match Kira Space on the computer.</span>
      <code class="font-data break-all text-kira-sm select-all" data-testid="setup-fingerprint">{{ info.fingerprint }}</code>
    </section>

    <Button v-if="appUrl" as="a" :href="appUrl" variant="dialog" size="kira-lg" data-testid="setup-open-app">
      Open Kira Space
    </Button>
  </main>
</template>
