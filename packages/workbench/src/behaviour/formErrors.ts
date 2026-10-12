import { computed, nextTick, reactive, ref, useId, watch } from 'vue';

export interface FormErrorRule {
  /** The field's current value; the first change after mount reveals its error. */
  value: () => unknown;
  /** The error text, or `null` when the value is valid. */
  error: () => string | null;
  /** Tab or section that holds the field; `onTab` opens it before focus. */
  tab?: string;
}

export interface FormErrorsOptions {
  /** Opens the tab that holds the first invalid field on a failed submit. */
  onTab?: (tab: string) => void;
}

/**
 * One validation timing for every form: a field's error shows after its first change or after a
 * submit attempt. A failed submit reveals every error, opens the first invalid field's tab and
 * focuses that field. Bind `invalidAttrs(field)` on the control and render the error with
 * `id="errorId(field)"`.
 */
export function useFormErrors<F extends string>(
  rules: Record<F, FormErrorRule>,
  opts: FormErrorsOptions = {},
) {
  const prefix = useId();
  const fields = Object.keys(rules) as F[];
  const touched = reactive(Object.fromEntries(fields.map((f) => [f, false]))) as Record<F, boolean>;
  const submitted = ref(false);

  for (const field of fields) {
    watch(rules[field].value, () => {
      touched[field] = true;
    });
  }

  const errorId = (field: F): string => `${prefix}-${field}-error`;

  function errorFor(field: F): string | null {
    if (!submitted.value && !touched[field]) return null;
    return rules[field].error();
  }

  function invalidAttrs(field: F): { 'aria-invalid'?: true; 'aria-describedby'?: string } {
    return errorFor(field) === null
      ? {}
      : { 'aria-invalid': true, 'aria-describedby': errorId(field) };
  }

  const hasErrors = computed(() => fields.some((f) => rules[f].error() !== null));

  /** Call on submit. Returns `true` when every field is valid. */
  async function submit(): Promise<boolean> {
    submitted.value = true;
    const first = fields.find((f) => rules[f].error() !== null);
    if (first === undefined) return true;
    const tab = rules[first].tab;
    if (tab !== undefined) opts.onTab?.(tab);
    await nextTick();
    document.querySelector<HTMLElement>(`[aria-describedby="${errorId(first)}"]`)?.focus();
    return false;
  }

  function reset(): void {
    submitted.value = false;
    for (const field of fields) touched[field] = false;
  }

  return { errorFor, errorId, invalidAttrs, hasErrors, submit, reset };
}
