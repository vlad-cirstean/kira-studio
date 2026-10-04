/** Ends every agent step prompt, added by the app and not editable (SPEC2 section 5.1.2); mirrors
 *  Go `adeagent.FinishStepSuffix`. */
export const FINISH_STEP_SUFFIX =
  'When this step is done, call the finish_step tool with status "done" and a one-line summary. If it failed, call it with status "failed" and say what failed. If you need a decision from me, call it with status "needs_input" and your question.';
