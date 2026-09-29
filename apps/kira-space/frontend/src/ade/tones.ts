import type { ActivityKind } from './activity';
import type { QueueTag } from './useQueue';

// P129 Part 6 §0.22: tone literals moved out of `AdeStackBlock.vue` so the detail panel header
// (action buttons, status chip) can share them without importing a stack component.

/** Mockup `tone()` (line 650-659) — literal tints, one 6-tone palette, never theme tokens (§0
 *  standing decision: tone tints stay literal). `[background, foreground, solid]`. */
export const TONE: Record<QueueTag['tone'], [string, string, string]> = {
  amber: ['rgba(232,163,61,0.14)', '#f0b85c', '#e8a33d'],
  red: ['rgba(239,107,91,0.14)', '#f28b7d', '#ef6b5b'],
  green: ['rgba(108,197,138,0.14)', '#7fd49b', '#6cc58a'],
  blue: ['rgba(122,167,255,0.14)', '#93b6ff', '#7aa7ff'],
  purple: ['rgba(163,113,247,0.16)', '#c3a3fb', '#a371f7'],
  grey: ['#23252b', '#b4b6bd', '#6b6f7a'],
};

/** Ink on a tone solid. Fixed with the solid: a themed ink loses contrast under any other theme. */
export const TONE_INK: Record<QueueTag['tone'], string> = {
  amber: '#15161a',
  red: '#15161a',
  green: '#15161a',
  blue: '#15161a',
  purple: '#ffffff',
  grey: '#15161a',
};

/** Session activity label colour: tone text for the three live kinds, muted otherwise. */
export function activityTextColor(kind: ActivityKind): string {
  if (kind === 'input') return TONE.amber[1];
  if (kind === 'working') return TONE.green[1];
  if (kind === 'waiting') return TONE.blue[1];
  return 'var(--kira-fg-muted)';
}

/** Mockup `chip(t)` (line 661) — the status-chip style every tone-labelled pill in the panel uses
 *  (header status, Branch/Jira/PR link rows, §0.11). */
export function chipStyle(tone: QueueTag['tone']): Record<string, string> {
  const [background, color] = TONE[tone];
  return {
    fontSize: '11px',
    fontWeight: '600',
    padding: '1px 7px',
    borderRadius: '5px',
    background,
    color,
    whiteSpace: 'nowrap',
    flexShrink: '0',
  };
}

/** Start-agent button style shared by `AdePanelHeader`, `AdeAllAgentsRow` and `AdeStackBlock`:
 *  the theme's primary button. */
export const CLAUDE_BUTTON_STYLE: Record<string, string> = {
  background: 'var(--primary)',
  color: 'var(--primary-foreground)',
  border: 'none',
};
