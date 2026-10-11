import type en from './en.json';

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type Catalog = typeof en;
export type MessageKey = Leaves<Catalog>;
export type PlainKey = MessageKey;
export type MessageParams = Record<string, string | number>;
export type CopyLocale = 'en' | 'pseudo';
