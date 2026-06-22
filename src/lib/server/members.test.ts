import { describe, it, expect } from 'vitest';
import { seedFamily } from './test/seed';
import {
  listMembers, addKid, addParent, editMember, archiveMember, restoreMember, completeSetup,
} from './members';
import { isSetupComplete } from './setup';

describe('members module', () => {
  it('adds a kid (trims name, stores birthdate, active by default)', async () => {
    const fam = seedFamily();
    const id = await addKid({ familyId: fam, name: '  Mia  ', birthdate: '2016-05-01' });
    const { kids } = await listMembers(fam);
    expect(kids).toHaveLength(1);
    expect(kids[0]).toMatchObject({ id, name: 'Mia', birthdate: '2016-05-01', active: true });
  });

  it('rejects a kid with a malformed birthdate', async () => {
    const fam = seedFamily();
    await expect(addKid({ familyId: fam, name: 'Mia', birthdate: '05/01/2016' })).rejects.toThrow(/YYYY-MM-DD/);
  });

  it('rejects an empty name', async () => {
    const fam = seedFamily();
    await expect(addParent({ familyId: fam, name: '   ' })).rejects.toThrow(/Name is required/);
  });

  it('adds a co-parent with no birthdate and no PIN', async () => {
    const fam = seedFamily();
    const id = await addParent({ familyId: fam, name: 'Mom' });
    const { parents } = await listMembers(fam);
    expect(parents.find((p) => p.id === id)).toMatchObject({ name: 'Mom', birthdate: null, active: true, hasPin: false });
  });

  it('edits a kid name and birthdate', async () => {
    const fam = seedFamily();
    const id = await addKid({ familyId: fam, name: 'Mia', birthdate: '2016-05-01' });
    await editMember({ id, familyId: fam, name: 'Mia Rose', birthdate: '2015-04-02' });
    const { kids } = await listMembers(fam);
    expect(kids[0]).toMatchObject({ name: 'Mia Rose', birthdate: '2015-04-02' });
  });

  it('archives and restores a kid', async () => {
    const fam = seedFamily();
    const id = await addKid({ familyId: fam, name: 'Mia', birthdate: '2016-05-01' });
    await archiveMember({ id, familyId: fam });
    expect((await listMembers(fam)).kids[0].active).toBe(false);
    await restoreMember({ id, familyId: fam });
    expect((await listMembers(fam)).kids[0].active).toBe(true);
  });

  it('refuses to archive the only active parent', async () => {
    const fam = seedFamily();
    const p = await addParent({ familyId: fam, name: 'Dad' });
    await expect(archiveMember({ id: p, familyId: fam })).rejects.toThrow(/only parent/i);
  });

  it('allows archiving a parent when another active parent remains', async () => {
    const fam = seedFamily();
    const p1 = await addParent({ familyId: fam, name: 'Dad' });
    await addParent({ familyId: fam, name: 'Mom' });
    await expect(archiveMember({ id: p1, familyId: fam })).resolves.toBeUndefined();
  });

  it('treats an id from another family as not found', async () => {
    const famA = seedFamily('A');
    const famB = seedFamily('B');
    const id = await addKid({ familyId: famA, name: 'Mia', birthdate: '2016-05-01' });
    await expect(editMember({ id, familyId: famB, name: 'X' })).rejects.toThrow(/not found/i);
  });

  it('completeSetup makes isSetupComplete true', async () => {
    expect(await isSetupComplete()).toBe(false);
    await completeSetup();
    expect(await isSetupComplete()).toBe(true);
  });
});
