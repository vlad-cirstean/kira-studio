import type { HttpResponseView } from '@shared/domain/http';
import { useTimeoutFn } from '@vueuse/core';
import { computed, type Ref, ref, shallowRef, watch } from 'vue';
import { formatBodyInWorker } from './prettyBody';
import { formatBody, type PrettyFormat, type PrettyResult } from './prettyBodyCore';

// Bodies up to this size format inline: a worker round trip would only add a pending flash.
const SYNC_BODY_CHARS = 65_536;
// Show the "Formatting…" caption only for waits long enough to notice.
const CAPTION_DELAY_MS = 200;

interface BodySource {
  body: string;
  bodyEncoding: string;
}

/**
 * One format pass per received body (worker for large ones). Pretty text is held only while the
 * Pretty view is selected (P21 finding 7): switching to Raw drops it, switching back re-requests it.
 */
export function useResponseBody(response: Ref<BodySource | null>, view: Ref<HttpResponseView>) {
  // `undefined` while the pass is pending.
  const format = ref<PrettyFormat | null | undefined>(undefined);
  const text = shallowRef<string | null>(null);
  const slow = ref(false);
  let seq = 0;

  const { start: startCaptionTimer, stop: stopCaptionTimer } = useTimeoutFn(
    () => {
      slow.value = true;
    },
    CAPTION_DELAY_MS,
    { immediate: false },
  );

  function apply(r: PrettyResult): void {
    stopCaptionTimer();
    slow.value = false;
    format.value = r.format;
    text.value = view.value === 'pretty' ? (r.text ?? null) : null;
  }

  function request(body: string, wantText: boolean): void {
    const id = ++seq;
    slow.value = false;
    stopCaptionTimer();
    if (body.length <= SYNC_BODY_CHARS) {
      apply(formatBody(body, wantText));
      return;
    }
    startCaptionTimer();
    void formatBodyInWorker(body, wantText)
      .catch(() => (id === seq ? formatBody(body, wantText) : null))
      .then((r) => {
        if (r && id === seq) apply(r);
      });
  }

  watch(
    response,
    (r) => {
      seq++;
      text.value = null;
      format.value = undefined;
      stopCaptionTimer();
      slow.value = false;
      if (!r) return;
      if (r.bodyEncoding === 'base64') {
        format.value = null;
        return;
      }
      request(r.body, view.value === 'pretty');
    },
    { immediate: true },
  );

  watch(view, (v) => {
    const r = response.value;
    if (v === 'raw') {
      text.value = null;
      return;
    }
    if (!r || r.bodyEncoding === 'base64') return;
    if (format.value === undefined || (format.value !== null && text.value === null)) {
      request(r.body, true);
    }
  });

  /** Pretty view is waiting on its text. */
  const pending = computed(
    () =>
      response.value !== null &&
      response.value.bodyEncoding !== 'base64' &&
      view.value === 'pretty' &&
      (format.value === undefined || (format.value !== null && text.value === null)),
  );
  const formatting = computed(() => pending.value && slow.value);
  const bodyText = computed(() => {
    const r = response.value;
    if (!r) return '';
    return view.value === 'pretty' && text.value !== null ? text.value : r.body;
  });

  return { format, bodyText, pending, formatting };
}
