// P18 D18: the palette Studio's connection colours and (this phase) an environment's colour both
// draw from — one palette *by construction*, not two lists that happen to match. Promoted out of
// domain/connection.ts, which keeps connectionColorSchema/ConnectionColor/
// CONNECTION_COLOR_CHOICES as re-exported aliases of the names here, with its existing comments
// intact — zero call-site churn in Studio, an honest name for the shared thing.
import { z } from 'zod';

export const paletteColorSchema = /*#__PURE__*/ z.enum([
  'none',
  'red',
  'orange',
  'amber',
  'olive',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'magenta',
  'grey',
]); // matches --kira-conn-* in tokens.css. 'none' is a real, stored value (the design system's own
// default — "no colour is the default, the rail slot stays reserved either way") rather than the
// field being nullable, so no DB/schema change is needed to add it.
export type PaletteColor = z.infer<typeof paletteColorSchema>;

/** P42 D34/D35: the *offered* subset, not the storable one — paletteColorSchema above stays whole
 *  on purpose (F27: a row saved with a retired colour must keep parsing, listing and painting its
 *  own rail, or "trim the palette" silently deletes rows on next launch). Six hues chosen for a
 *  42° minimum adjacent OKLCH hue gap (F28/F28a) at the app's one fixed lightness/chroma
 *  (`oklch(0.72 0.09 h)`) — roughly double the full eleven-hue ring's own worst gap (25.6°,
 *  blue↔indigo), which is what makes a 2px rail or a 5px status dot legible at all. Retired from
 *  the picker: `orange`, `olive`, `teal`, `indigo`, `violet`. */
export const PALETTE_COLOR_CHOICES: readonly PaletteColor[] = [
  'none',
  'red',
  'amber',
  'green',
  'cyan',
  'blue',
  'magenta',
  'grey',
];
