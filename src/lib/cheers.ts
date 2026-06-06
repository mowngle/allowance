// Canned cross-home cheer phrases. Kids only ever PICK from this list (never type),
// so nothing unmoderatable leaves a house. Client-safe (no server imports).

export interface CheerPhrase {
  id: string;
  text: string;
}

export const CHEER_PHRASES: CheerPhrase[] = [
  { id: 'nice-streak', text: 'Nice streak! 🔥' },
  { id: 'catch-me', text: 'Catch me if you can 😎' },
  { id: 'gg', text: 'GG 👏' },
  { id: 'comeback', text: 'Comeback szn 📈' },
  { id: 'cup-coming', text: 'Cup is coming home 🏆' },
];

export function phraseText(id: string): string | null {
  return CHEER_PHRASES.find((p) => p.id === id)?.text ?? null;
}
