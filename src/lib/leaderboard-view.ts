// Pure, client-safe view helpers over a board's houses. No server imports — usable
// in both the page server load and the Svelte component.

export interface ViewKid {
  name: string;
  avatar: string;
  pct: number;
  streak: number;
  choresDone: number;
  badges: string[];
}

export interface ViewHouse {
  house: string;
  kids: ViewKid[];
}

export interface RankedKid extends ViewKid {
  house: string;
  rank: number;
}

export interface CupResult {
  house: string;
  avgPct: number;
}

/** All kids across the league, ranked by pct desc, then streak desc, then name. */
export function rankedKids(houses: ViewHouse[]): RankedKid[] {
  const flat = houses.flatMap((h) =>
    h.kids.map((k) => ({ ...k, house: h.house }))
  );
  flat.sort(
    (a, b) => b.pct - a.pct || b.streak - a.streak || a.name.localeCompare(b.name)
  );
  return flat.map((k, i) => ({ ...k, rank: i + 1 }));
}

/** The house holding the Cup on this viewer's board: highest average kid pct. */
export function houseCup(houses: ViewHouse[]): CupResult | null {
  if (houses.length === 0) return null;
  const scored = houses.map((h) => ({
    house: h.house,
    avgPct: h.kids.length
      ? Math.round(h.kids.reduce((s, k) => s + k.pct, 0) / h.kids.length)
      : 0,
  }));
  scored.sort((a, b) => b.avgPct - a.avgPct || a.house.localeCompare(b.house));
  return scored[0];
}
