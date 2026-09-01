// P31 D9/F11: document.fonts.check() returns true for a nonexistent family — measured in the
// built app, it is useless for detecting a fallback. A canvas measurement is the honest test:
// measure the *primary* family the user actually typed (the first entry — everything after it is
// their own fallback plumbing, not the thing being checked) against a name guaranteed never to
// exist. Identical widths mean the primary family did not resolve to anything of its own.

const PROBE_TEXT = 'mmmmmmmmmmlliWWW0123456789 The quick brown fox';
const PROBE_SIZE = '72px'; // large enough that a genuinely different face measures differently
const BOGUS_PROBE_FAMILY = '"Kira Nonexistent Probe Font 9x7q"';

let measureCtx: CanvasRenderingContext2D | null = null;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  const canvas = document.createElement('canvas');
  measureCtx = canvas.getContext('2d');
  return measureCtx;
}

function measuredWidth(ctx: CanvasRenderingContext2D, font: string): number {
  ctx.font = font;
  return ctx.measureText(PROBE_TEXT).width;
}

// The first entry in a comma-separated family list — quotes included, exactly as `ctx.font`
// wants it — since the browser's own font-string parsing must see the same value verbatim.
function primaryFamily(stack: string): string {
  return stack.split(',')[0]?.trim() || stack.trim();
}

/** Which CSS generic a `stack`'s own trailing fallback measurably resolved to, for the "falls
 *  back to ___" message — cosmetic only, never the availability determination itself. */
export function resolveFontFallback(stack: string): 'serif' | 'monospace' | 'sans-serif' | null {
  const ctx = getMeasureCtx();
  if (!ctx) return null;
  const target = measuredWidth(ctx, `${PROBE_SIZE} ${stack}`);
  if (target === measuredWidth(ctx, `${PROBE_SIZE} serif`)) return 'serif';
  if (target === measuredWidth(ctx, `${PROBE_SIZE} monospace`)) return 'monospace';
  if (target === measuredWidth(ctx, `${PROBE_SIZE} sans-serif`)) return 'sans-serif';
  return null;
}

/** True when the *primary* family in `stack` — the first entry, what the user actually chose —
 *  resolves to a real, distinct face. A trailing generic the user added themselves (`, monospace`)
 *  is deliberate fallback plumbing, not evidence the primary choice is missing, so it plays no
 *  part in this check. Never blocks on a missing canvas capability. */
export function fontStackAvailable(stack: string): boolean {
  const ctx = getMeasureCtx();
  if (!ctx) return true;
  const primary = primaryFamily(stack);
  const target = measuredWidth(ctx, `${PROBE_SIZE} ${primary}`);
  const bogus = measuredWidth(ctx, `${PROBE_SIZE} ${BOGUS_PROBE_FAMILY}`);
  return target !== bogus;
}
