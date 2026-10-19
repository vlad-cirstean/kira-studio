import {
  CONNECTION_THROTTLE_RANGE,
  connectionInputSchema,
  PRECONNECT_DELAY_RANGE,
} from '@shared/domain/connection';
import { t } from '@theme/i18n';
import { useFormErrors } from '@workbench/behaviour/formErrors';
import { computed, type InjectionKey, inject } from 'vue';
import { useConnectionDialogStore } from '../../state/connections';

export type DetailTab = 'General' | 'Advanced' | 'Pre-connect' | 'MCP' | 'Privacy';

type FieldName =
  | 'name'
  | 'host'
  | 'port'
  | 'database'
  | 'uri'
  | 'preconnect'
  | 'preconnectDelaySec'
  | 'throttlePerSec'
  | 'mcpDescription';

/** Field errors for the connection draft: schema issues plus the throttle and delay ranges. */
export function useConnectionForm(openTab: (tab: DetailTab) => void) {
  const store = useConnectionDialogStore();

  const schemaErrors = computed(() => {
    const out: Partial<Record<string, string>> = {};
    if (!store.draft) return out;
    const parsed = connectionInputSchema.safeParse(store.draft);
    if (parsed.success) return out;
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (typeof key === 'string' && !(key in out)) out[key] = issue.message;
    }
    return out;
  });

  // 0 is unlimited; a non-zero value outside the range is rejected like connections/input.go does.
  const throttleError = computed<string | null>(() => {
    const v = store.draft?.throttlePerSec ?? 0;
    if (!Number.isFinite(v)) return t('common.enterNumber.error');
    if (v !== 0 && (v < CONNECTION_THROTTLE_RANGE.min || v > CONNECTION_THROTTLE_RANGE.max)) {
      return t('studio.project.connectionDialog.throttle.range.status', {
        min: CONNECTION_THROTTLE_RANGE.min,
        max: CONNECTION_THROTTLE_RANGE.max,
      });
    }
    return null;
  });

  const delayError = computed<string | null>(() => {
    const v = store.draft?.preconnectDelaySec ?? 0;
    if (!Number.isInteger(v) || v < PRECONNECT_DELAY_RANGE.min || v > PRECONNECT_DELAY_RANGE.max) {
      return t('studio.project.connectionDialog.preconnectDelay.range.status', {
        min: PRECONNECT_DELAY_RANGE.min,
        max: PRECONNECT_DELAY_RANGE.max,
      });
    }
    return null;
  });

  function schemaRule(field: FieldName, tab: DetailTab) {
    return {
      value: () => (store.draft as Record<string, unknown> | null)?.[field],
      error: () => schemaErrors.value[field] ?? null,
      tab,
    };
  }

  return useFormErrors<FieldName>(
    {
      name: schemaRule('name', 'General'),
      host: schemaRule('host', 'General'),
      port: schemaRule('port', 'General'),
      database: schemaRule('database', 'General'),
      uri: schemaRule('uri', 'General'),
      preconnect: schemaRule('preconnect', 'Pre-connect'),
      preconnectDelaySec: {
        value: () => store.draft?.preconnectDelaySec,
        error: () => delayError.value,
        tab: 'Pre-connect',
      },
      mcpDescription: schemaRule('mcpDescription', 'MCP'),
      throttlePerSec: {
        value: () => store.draft?.throttlePerSec,
        error: () => throttleError.value,
        tab: 'Advanced',
      },
    },
    { onTab: (tab) => openTab(tab as DetailTab) },
  );
}

export type ConnectionForm = ReturnType<typeof useConnectionForm>;
export const CONNECTION_FORM_KEY: InjectionKey<ConnectionForm> = Symbol('connectionForm');

export function injectConnectionForm(): ConnectionForm {
  const form = inject(CONNECTION_FORM_KEY);
  if (!form) throw new Error('connection form not provided');
  return form;
}
