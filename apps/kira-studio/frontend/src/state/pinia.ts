import { createPinia } from 'pinia';

// P98: the app's one Pinia instance, exported rather than created inline in main.ts so a unit
// test can `setActivePinia(pinia)` before touching a store defined outside a component.
export const pinia = createPinia();
