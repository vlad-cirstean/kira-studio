// Work colours: `Task.color` is an index into this 20-slot table, assigned server-side.
const PALETTE = [
  '#e07a4f',
  '#e3a53c',
  '#c9c23a',
  '#8cc152',
  '#4db86c',
  '#35b5a0',
  '#38a8cc',
  '#4a8ee6',
  '#6e79ea',
  '#9a6ee2',
  '#c566d8',
  '#e062a8',
  '#e35f79',
  '#b88458',
  '#94a35a',
  '#58a08e',
  '#7b92b8',
  '#a57ec0',
  '#d58c8c',
  '#a3aab4',
] as const;

export function taskColor(slot: number): string {
  return PALETTE[((slot % PALETTE.length) + PALETTE.length) % PALETTE.length] as string;
}
