import { expect, reviewTest } from '../ui/fixtures';
import { HUNK_COMMENT, openHunkDiff, renderedLine, t } from '../ui/support/reviewHunkDiff';

// P413: the review diff's compact gutter with a hunk row, a commented line, an open thread with a
// long body and the hover add mark.

reviewTest('review diff gutter and open thread', async ({ relaunch }) => {
  const comment = {
    ...HUNK_COMMENT,
    range: { start: 99, end: 99 },
    body: Array.from(
      { length: 6 },
      (_, i) => `Review note ${i + 1}: keep this branch free of the fallback.`,
    ).join('\n'),
  };
  const { page, modified } = await openHunkDiff(relaunch, { comments: [comment] });
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(renderedLine(modified, 'CHANGED 100')).toHaveCount(1, { timeout: 15_000 });
  await modified.locator('.kira-review-ln-comment').click();
  await expect(page.locator(t('review-thread'))).toBeVisible();
  await renderedLine(modified, 'line 102').hover();
  await expect(page.locator(t('repo-diff-editor'))).toHaveScreenshot('review-diff-gutter.png');
});
