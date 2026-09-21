<script setup lang="ts">
import type { HttpCookieWire, HttpResponseWire } from '@shared/domain/http';
import { computed, ref } from 'vue';
import { openSettingsAt } from '../../state/settings';
import AppButton from '../../theme/primitives/AppButton.vue';
import EmptyState from '../../theme/primitives/EmptyState.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import PanelSearchBox from '../../theme/primitives/PanelSearchBox.vue';
import { useCookiesStore } from './cookies';

// P90 item 2 (§3): one component, two hosts — HttpRequestView.vue's request segment (what the
// jar would send next) and ResponsePane.vue's response segment (what one exchange actually sent
// and received), same list shape either way (§3's own reasoning for keeping this one component).
const props = defineProps<{
  mode: 'request' | 'response';
  /** request mode only. */
  tabId?: string;
  url?: string;
  disableCookieJar?: boolean;
  /** response mode only — null when there is no response to show cookies for yet. */
  response?: HttpResponseWire | null;
}>();

const cookiesStore = useCookiesStore();

const filter = ref('');

function matches(c: HttpCookieWire, q: string): boolean {
  if (!q) return true;
  return c.name.toLowerCase().includes(q) || c.value.toLowerCase().includes(q);
}

// §3: "Domain=… Path=… Expires=… Secure HttpOnly SameSite=Lax" — attributes with nothing to show
// (an empty Domain/Path from the request-mode jar listing, §2.4's own stated limitation) are
// skipped rather than printed empty.
function attributeLine(c: HttpCookieWire): string {
  const parts: string[] = [];
  if (c.domain) parts.push(`Domain=${c.domain}`);
  if (c.path) parts.push(`Path=${c.path}`);
  if (c.expires) parts.push(`Expires=${c.expires}`);
  if (c.secure) parts.push('Secure');
  if (c.httpOnly) parts.push('HttpOnly');
  if (c.sameSite) parts.push(`SameSite=${c.sameSite[0].toUpperCase()}${c.sameSite.slice(1)}`);
  return parts.join(' ');
}

// --- request mode ---

const rt = computed(() => (props.tabId ? cookiesStore.cookiesRuntime[props.tabId] : undefined));
const requestCookies = computed(() => rt.value?.cookies ?? []);
const filteredRequestCookies = computed(() => {
  const q = filter.value.trim().toLowerCase();
  return requestCookies.value.filter((c) => matches(c, q));
});

async function onRemove(name: string): Promise<void> {
  if (!props.tabId || !props.url) return;
  await cookiesStore.deleteCookie(props.tabId, props.url, name);
}
async function onClearAll(): Promise<void> {
  if (!props.tabId || !props.url) return;
  await cookiesStore.clearCookies(props.tabId, props.url);
}
async function onRetry(): Promise<void> {
  if (!props.tabId || !props.url) return;
  await cookiesStore.fetchCookiesNow(props.tabId, props.url);
}

function onEditGlobalDefaults(): void {
  openSettingsAt('Api');
}

// --- response mode ---

const sentCookies = computed(() => props.response?.sentCookies ?? []);
const receivedCookies = computed(() => props.response?.receivedCookies ?? []);
const showHopIndex = computed(() => (props.response?.timeline?.hops.length ?? 0) > 1);
</script>

<template>
  <div v-if="mode === 'request'" class="cookies-pane" data-testid="http-request-cookies">
    <EmptyState
      v-if="disableCookieJar"
      icon="circle-slash"
      label="The cookie jar is off for this request"
      data-testid="http-cookies-jar-off"
    >
      <button class="hint-link" data-testid="http-cookies-edit-defaults" @click="onEditGlobalDefaults">
        Edit global defaults…
      </button>
    </EmptyState>
    <template v-else>
      <div class="cookies-toolbar">
        <PanelSearchBox v-model="filter" placeholder="Filter cookies" testid="http-cookies-filter" />
        <AppButton
          kind="dialog"
          class="clear-all-button"
          :disabled="requestCookies.length === 0"
          data-testid="http-cookies-clear-all"
          @click="onClearAll"
        >
          Clear all
        </AppButton>
      </div>
      <span
        v-if="filter.trim()"
        class="p-xs subtle cookies-count"
        data-testid="http-cookies-filtered-count"
      >
        {{ filteredRequestCookies.length }} of {{ requestCookies.length }} cookies
      </span>
      <div v-if="requestCookies.length > 0" class="cookies-list">
        <div v-for="c in filteredRequestCookies" :key="c.name" class="p-kv-row cookie-row">
          <div class="cookie-body">
            <span class="p-kv-name mono">{{ c.name }}</span>
            <span class="p-kv-value mono">{{ c.value }}</span>
            <span v-if="attributeLine(c)" class="cookie-attributes">{{ attributeLine(c) }}</span>
          </div>
          <IconButton
            icon="close"
            aria-label="Remove cookie"
            v-tooltip="'Remove'"
            :data-testid="`http-cookies-remove-${c.name}`"
            @click="onRemove(c.name)"
          />
        </div>
      </div>
      <EmptyState
        v-else
        icon="symbol-key"
        label="No cookies for this request's URL"
        data-testid="http-cookies-empty"
      >
        <button class="hint-link" data-testid="http-cookies-retry" @click="onRetry">Refresh</button>
      </EmptyState>
    </template>
  </div>

  <div v-else class="cookies-pane" data-testid="http-response-cookies">
    <template v-if="response">
      <template v-if="sentCookies.length > 0 || receivedCookies.length > 0">
        <div v-if="sentCookies.length > 0" class="cookies-group">
          <h3 class="cookies-group-head">Sent</h3>
          <div class="cookies-list">
            <div v-for="(c, i) in sentCookies" :key="`sent-${i}`" class="p-kv-row cookie-row">
              <div class="cookie-body">
                <span class="p-kv-name mono">{{ c.name }}</span>
                <span class="p-kv-value mono">{{ c.value }}</span>
                <span class="cookie-attributes">
                  <template v-if="showHopIndex">Hop {{ c.hop }}</template>
                  <template v-if="showHopIndex && attributeLine(c)"> · </template>
                  {{ attributeLine(c) }}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div v-if="receivedCookies.length > 0" class="cookies-group">
          <h3 class="cookies-group-head">Received</h3>
          <div class="cookies-list">
            <div v-for="(c, i) in receivedCookies" :key="`received-${i}`" class="p-kv-row cookie-row">
              <div class="cookie-body">
                <span class="p-kv-name mono">{{ c.name }}</span>
                <span class="p-kv-value mono">{{ c.value }}</span>
                <span class="cookie-attributes">
                  <template v-if="showHopIndex">Hop {{ c.hop }}</template>
                  <template v-if="showHopIndex && attributeLine(c)"> · </template>
                  {{ attributeLine(c) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <EmptyState v-else icon="symbol-key" label="This response carries no cookies" data-testid="http-response-cookies-empty" />
    </template>
    <EmptyState v-else icon="arrow-right" label="Send a request to see the response" />
  </div>
</template>

<style scoped>
.cookies-pane {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.cookies-toolbar {
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
}

.clear-all-button {
  flex-shrink: 0;
}

.cookies-count {
  padding: var(--kira-s-2) var(--kira-s-3) 0;
}

.cookies-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--kira-s-3);
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-1);
}

.cookie-row {
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--kira-s-2);
}

.cookie-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

/* AutocompleteField.vue's own hover-panel shape (P71 §8.2): a value line, then a muted second
   line for everything that isn't the value itself. */
.cookie-attributes {
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-xs);
  font-family: var(--kira-font-data);
}

.cookies-group {
  padding: var(--kira-s-3) 0 0;
}

.cookies-group-head {
  margin: 0;
  padding: 0 var(--kira-s-3);
  font-size: var(--kira-t-sm);
  color: var(--kira-fg-muted);
}

.hint-link {
  margin-top: var(--kira-s-2);
  background: none;
  border: none;
  padding: 0;
  color: var(--kira-accent);
  cursor: pointer;
  font-size: var(--kira-t-sm);
}
</style>
