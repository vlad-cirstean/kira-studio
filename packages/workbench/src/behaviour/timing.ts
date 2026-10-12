/** Every debounce, poll, tick and feedback duration in app code, in ms. One table so the same kind
 *  of wait is the same number everywhere. */
export const TIMING = {
  /** Search and filter input. */
  search: 150,
  /** Parse and validate previews of pasted or typed text. */
  preview: 250,
  /** UI-state writes. */
  persist: 150,
  /** Notes autosave. */
  autosave: 600,
  /** Whole tab-state serialisation (large payload, so slower than `persist`). */
  tabsSave: 1000,
  /** "Copied" feedback on the copy control. */
  copiedFeedback: 1500,
  /** First-letter type-ahead buffer reset. */
  typeahead: 500,
  /** Live-region clear-then-set gap. */
  reannounce: 100,
  /** Hover info popup delay. */
  hoverInfo: 400,
  pollFast: 5000,
  pollSlow: 60000,
  /** QueryState shows its loading state only after this wait, so fast loads do not flash. */
  spinnerDelay: 300,
  /** Scroll-position persistence. */
  scrollPersist: 300,
  /** How long an agent paste waits for the terminal to settle. */
  agentPasteWait: 10000,
  clockTick: 1000,
  clockTickSlow: 30000,
} as const;
