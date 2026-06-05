import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/server/db';
import { seedFamily, seedKid } from './seed';

describe('test harness', () => {
  it('has a migrated in-memory DB and isolates rows per test', () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    const kids = db.select().from(schema.persons).all();
    expect(kids).toHaveLength(1);
    expect(kids[0].id).toBe(kid);
    expect(kids[0].canPostCheers).toBe(false);
  });

  it('starts empty (previous test wiped)', () => {
    expect(db.select().from(schema.persons).all()).toHaveLength(0);
  });
});
