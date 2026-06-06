import { describe, it, expect } from 'vitest';
import { rankedKids, houseCup, type ViewHouse } from './leaderboard-view';

const houses: ViewHouse[] = [
  {
    house: 'Smith',
    kids: [
      { name: 'Mia', avatar: '🦊', pct: 92, streak: 6, choresDone: 11, badges: [] },
      { name: 'Sam', avatar: '🐢', pct: 70, streak: 1, choresDone: 5, badges: [] },
    ],
  },
  {
    house: 'Jones',
    kids: [{ name: 'Leo', avatar: '🐻', pct: 92, streak: 9, choresDone: 8, badges: [] }],
  },
];

describe('rankedKids', () => {
  it('flattens all houses and ranks by pct, then streak', () => {
    const ranked = rankedKids(houses);
    expect(ranked.map((k) => k.name)).toEqual(['Leo', 'Mia', 'Sam']);
    expect(ranked[0].rank).toBe(1);
    expect(ranked[0].house).toBe('Jones');
    expect(ranked[2].rank).toBe(3);
  });
});

describe('houseCup', () => {
  it('returns the house with the highest average pct', () => {
    const cup = houseCup(houses);
    expect(cup?.house).toBe('Jones');
    expect(cup?.avgPct).toBe(92);
  });

  it('returns null for no houses', () => {
    expect(houseCup([])).toBeNull();
  });
});
