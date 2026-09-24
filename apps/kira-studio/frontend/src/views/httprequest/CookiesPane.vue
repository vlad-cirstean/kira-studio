<script setup lang="ts">
import type { HttpCookieWire, HttpResponseWire } from '@shared/domain/http';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@theme/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed, ref } from 'vue';
import { useSettingsStore } from '../../state/settings';
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
const settingsStore = useSettingsStore();

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
  // P108 F7: clearCookies now empties every open tab's own list itself (Go's ClearJar is
  // process-wide) — this only still gates on request mode being properly wired up, same as the
  // other two actions.
  if (!props.tabId) return;
  await cookiesStore.clearCookies();
}
async function onRetry(): Promise<void> {
  if (!props.tabId || !props.url) return;
  await cookiesStore.fetchCookiesNow(props.tabId, props.url);
}

function onEditGlobalDefaults(): void {
  settingsStore.openSettingsAt('Api');
}

// --- response mode ---

const sentCookies = computed(() => props.response?.sentCookies ?? []);
const receivedCookies = computed(() => props.response?.receivedCookies ?? []);
const showHopIndex = computed(() => (props.response?.timeline?.hops.length ?? 0) > 1);
</script>

<template>
  <div v-if="mode === 'request'" class="cookies-pane" data-testid="http-request-cookies">
    <Alert v-if="disableCookieJar" class="empty-state" data-testid="http-cookies-jar-off">
      <CodiconIcon name="circle-slash" :size="24" class="text-subtle" />
      <AlertTitle class="text-kira-md text-muted-foreground font-normal">
        The cookie jar is off for this request
      </AlertTitle>
      <button type="button" class="hint-link" data-testid="http-cookies-edit-defaults" @click="onEditGlobalDefaults">
        Edit global defaults…
      </button>
    </Alert>
    <template v-else>
      <div class="cookies-toolbar">
        <InputGroup>
          <InputGroupAddon>
            <CodiconIcon name="search" :size="13" />
          </InputGroupAddon>
          <InputGroupInput v-model="filter" placeholder="Filter cookies" data-testid="http-cookies-filter" />
          <InputGroupAddon v-if="filter" align="inline-end">
            <InputGroupButton @click="filter = ''">
              <CodiconIcon name="close" :size="13" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <Button
          variant="dialog"
          size="kira"
          class="clear-all-button"
          :disabled="requestCookies.length === 0"
          data-testid="http-cookies-clear-all"
          @click="onClearAll"
        >
          Clear all
        </Button>
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
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="toolbar"
                size="kira-icon"
                aria-label="Remove cookie"
                :data-testid="`http-cookies-remove-${c.name}`"
                @click="onRemove(c.name)"
              >
                <CodiconIcon name="close" :size="13" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Remove</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <Alert v-else class="empty-state" data-testid="http-cookies-empty">
        <CodiconIcon name="symbol-key" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md text-muted-foreground font-normal">No cookies for this request's URL</AlertTitle>
        <button type="button" class="hint-link" data-testid="http-cookies-retry" @click="onRetry">Refresh</button>
      </Alert>
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
      <Alert v-else class="empty-state" data-testid="http-response-cookies-empty">
        <CodiconIcon name="symbol-key" :size="24" class="text-subtle" />
        <AlertTitle class="text-kira-md text-muted-foreground font-normal">This response carries no cookies</AlertTitle>
      </Alert>
    </template>
    <Alert v-else class="empty-state">
      <CodiconIcon name="arrow-right" :size="24" class="text-subtle" />
      <AlertTitle class="text-kira-md text-muted-foreground font-normal">Send a request to see the response</AlertTitle>
    </Alert>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.cookies-pane {
  @apply flex flex-1 min-h-0 flex-col overflow-auto;
}

.cookies-toolbar {
  @apply flex items-center gap-1;
}

.clear-all-button {
  @apply shrink-0;
}

.cookies-count {
  @apply px-1.5 pt-1 pb-0;
}

.cookies-list {
  @apply flex flex-1 min-h-0 flex-col gap-0.5 overflow-auto p-1.5;
}

.cookie-row {
  @apply items-start justify-between gap-1;
}

.cookie-body {
  @apply flex min-w-0 flex-1 flex-col;
}

/* AutocompleteField.vue's own hover-panel shape (P71 §8.2): a value line, then a muted second
   line for everything that isn't the value itself. */
.cookie-attributes {
  @apply text-muted-foreground text-kira-xs font-[family-name:var(--kira-font-data)];
}

.cookies-group {
  @apply pt-1.5;
}

.cookies-group-head {
  @apply m-0 px-1.5 py-0 text-muted-foreground text-kira-sm;
}

.hint-link {
  @apply mt-1 cursor-pointer border-0 bg-none p-0 text-kira-sm text-primary;
}

.empty-state {
  @apply flex flex-1 min-h-0 flex-col items-center justify-center gap-2 border-0 bg-transparent text-center;
}
</style>
