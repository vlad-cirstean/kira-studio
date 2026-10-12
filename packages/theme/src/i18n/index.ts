import { createI18n } from 'vue-i18n';
import en from './en.json';
import { formatCount } from './number';
import { pseudoMessages } from './pseudo';
import type { CopyLocale, MessageKey, MessageParams } from './types';

export type { CopyLocale, MessageKey, MessageParams, PlainKey } from './types';

export const i18n = createI18n({
  legacy: false,
  globalInjection: false,
  locale: 'en',
  fallbackLocale: 'en',
  missingWarn: false,
  fallbackWarn: false,
  messages: { en },
});

// Every numeric param formats with locale digit grouping; `count` also selects the plural branch.
export function t(key: MessageKey, params?: MessageParams): string {
  const g = i18n.global;
  if (!params) return g.t(key);
  const formatted: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    formatted[name] = typeof value === 'number' ? formatCount(value) : value;
  }
  return typeof params.count === 'number' ? g.t(key, formatted, params.count) : g.t(key, formatted);
}

export function installCopyTestHook(): void {
  let pseudoLoaded = false;
  window.__kiraSetLocale = (locale: CopyLocale) => {
    if (locale === 'pseudo' && !pseudoLoaded) {
      i18n.global.setLocaleMessage('pseudo', pseudoMessages(en));
      pseudoLoaded = true;
    }
    // createI18n infers the locale union from `messages`, which holds only en until pseudo loads.
    i18n.global.locale.value = locale as 'en';
  };
}
