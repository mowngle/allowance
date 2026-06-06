import { describe, it, expect } from 'vitest';
import { canPostCheers, listKidCheerPerms, setKidCheerPerm } from './cheers';
import { seedFamily, seedKid } from './test/seed';
import { db, schema } from './db';
import { eq } from 'drizzle-orm';

describe('cheer permissions', () => {
  it('defaults to false and flips with setKidCheerPerm', async () => {
    const fam = seedFamily();
    const kid = seedKid(fam, 'Mia');
    expect(await canPostCheers(kid)).toBe(false);
    await setKidCheerPerm(kid, true);
    expect(await canPostCheers(kid)).toBe(true);
    await setKidCheerPerm(kid, false);
    expect(await canPostCheers(kid)).toBe(false);
  });

  it('only kids can post (a parent id is always false)', async () => {
    const fam = seedFamily();
    const parentId = crypto.randomUUID();
    db.insert(schema.persons)
      .values({ id: parentId, familyId: fam, name: 'Dad', role: 'parent', createdAt: Date.now() })
      .run();
    await db
      .update(schema.persons)
      .set({ canPostCheers: true })
      .where(eq(schema.persons.id, parentId))
      .run();
    expect(await canPostCheers(parentId)).toBe(false);
  });

  it('lists kids with their permission flags', async () => {
    const fam = seedFamily();
    const a = seedKid(fam, 'Mia');
    const b = seedKid(fam, 'Sam');
    await setKidCheerPerm(a, true);
    const perms = await listKidCheerPerms(fam);
    expect(perms).toHaveLength(2);
    expect(perms.find((p) => p.id === a)?.canPostCheers).toBe(true);
    expect(perms.find((p) => p.id === b)?.canPostCheers).toBe(false);
  });
});
