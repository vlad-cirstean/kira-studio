/** `SearchBox.vue`'s own `aria-controls` names this id (P11 W20 a11y pass) — the combobox
 *  pattern's own required-attribute, missing until then. A stable export rather than two files
 *  independently agreeing on the same string literal. Lives in its own module, not
 *  `SearchResults.vue`'s `<script setup>`, which cannot carry a named export. */
export const SEARCH_LISTBOX_ID = 'kv-search-listbox';
