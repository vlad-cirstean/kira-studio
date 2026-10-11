import { createI18n } from 'vue-i18n';
import en from './en.json';
import { pseudoMessages } from './pseudo';
import type { CopyLocale, MessageKey, MessageParams } from './types';

export { default as CatalogText } from './CatalogText.vue';
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

// `count` formats with locale digit grouping and also selects the plural branch.
export function t(key: MessageKey, params?: MessageParams): string {
  const g = i18n.global;
  if (params && typeof params.count === 'number') {
    const { count, ...rest } = params;
    return g.t(key, { ...rest, count: g.n(count) }, count);
  }
  return params ? g.t(key, params) : g.t(key);
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
