/** Ends every agent step prompt, added by the app and not editable (SPEC2 section 5.1.2); mirrors
 *  Go `claudeheadless.FinishStepSuffix`. */
export const FINISH_STEP_SUFFIX =
  'When this step is done, call the finish_step tool with status "done" and a one-line summary. If it failed, call it with status "failed" and say what failed and give the reason. If you need a decision from me, call it with status "needs_input" and your question.';

const MAX_BRANCH_SLUG = 40;

/** Branch-name slug of a task title; mirrors Go `slug` (internal/ade/setup.go). */
export function branchSlug(title: string): string {
  const out = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BRANCH_SLUG)
    .replace(/-+$/g, '');
  return out === '' ? 'task' : out;
}

export interface RunMessageInput {
  /** Display title, the value of `{task}`. */
  title: string;
  jira: { key: string; url: string } | null;
  /** Agent stage being run. */
  stage: { steps: readonly { name: string; prompt: string }[] };
}

/** Default Run dialog text; mirrors Go `composePrompt` without the suffix. Per-run placeholders
 *  (`{repo}` `{branch}` `{worktree}`) stay literal for the server to fill per run. */
export function defaultRunMessage(i: RunMessageInput): string {
  const first = i.stage.steps[0];
  const jira = i.jira?.key ?? '';
  const prompt = (first?.prompt ?? '').replaceAll('{task}', i.title).replaceAll('{jira}', jira);
  const lines = [`Task: ${i.title}`];
  if (i.jira?.key) lines.push(`- Jira: ${i.jira.key} ${i.jira.url}`);
  lines.push('- Repo: {repo} · Branch: {branch} · Worktree: {worktree}');
  lines.push(`Step 1/${i.stage.steps.length}: ${first?.name ?? ''}`);
  return `${lines.join('\n')}\n${prompt}`.replace(/\n+$/, '');
}
