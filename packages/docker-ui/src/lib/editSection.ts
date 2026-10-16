import type { InjectionKey } from 'vue';

/** Provided by the In place tab: a field there whose mode resolves to recreate says so. */
export const inPlaceSectionKey: InjectionKey<true> = Symbol('docker-edit-in-place');
