import type { TaskAction, Tone } from './board/actions';

// Literal tint, text and solid per tone: tones encode state, not theme, so they stay literal
// (scripts/check-ade-colours.sh allowlist). `[background, foreground, solid]`.
export const TONE: Record<Tone, [string, string, string]> = {
  amber: ['rgba(232,163,61,0.14)', '#f0b85c', '#e8a33d'],
  red: ['rgba(239,107,91,0.14)', '#f28b7d', '#ef6b5b'],
  green: ['rgba(108,197,138,0.14)', '#7fd49b', '#6cc58a'],
  blue: ['rgba(122,167,255,0.14)', '#93b6ff', '#7aa7ff'],
  purple: ['rgba(163,113,247,0.16)', '#c3a3fb', '#a371f7'],
  grey: ['#23252b', '#b4b6bd', '#6b6f7a'],
};

/** Ink on a tone solid; fixed with the solid, a themed ink loses contrast under another theme. */
export const TONE_INK: Record<Tone, string> = {
  amber: '#15161a',
  red: '#15161a',
  green: '#15161a',
  blue: '#15161a',
  purple: '#ffffff',
  grey: '#15161a',
};

/** Tag pill colours (tint background, tone text). */
export function tagStyle(tone: Tone): Record<string, string> {
  return { background: TONE[tone][0], color: TONE[tone][1] };
}

/** Solid button colours (tone solid, fixed ink). */
export function solidStyle(tone: Tone): Record<string, string> {
  return { background: TONE[tone][2], color: TONE_INK[tone] };
}

/** Solid of the Claude launch buttons (`▶ Run`), a brand colour rather than a state tone. */
const CLAUDE_SOLID = '#d97757';

/** Solid button colours of a task action: its tone, or Claude's for a launch. */
export function actionStyle(tone: TaskAction['tone']): Record<string, string> {
  return tone === 'claude' ? { background: CLAUDE_SOLID, color: TONE_INK.amber } : solidStyle(tone);
}
