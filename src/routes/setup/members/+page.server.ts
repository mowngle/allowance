// Wizard step 3: add kids and co-parents. No session yet (pre-claim); the only
// family is resolved via getOrInitOnlyFamily. "Done" links to /setup/done.

import type { Actions, PageServerLoad } from './$types';
import { fail, redirect } from '@sveltejs/kit';
import { getOrInitOnlyFamily } from '$lib/server/setup';
import { listMembers, addKid, addParent, editMember, archiveMember, restoreMember } from '$lib/server/members';

export const load: PageServerLoad = async () => {
  const fam = await getOrInitOnlyFamily();
  if (!fam) throw redirect(303, '/setup');
  if (!fam.hasParent) throw redirect(303, '/setup/parent');
  return await listMembers(fam.id);
};

async function requireFamilyId(): Promise<string> {
  const fam = await getOrInitOnlyFamily();
  if (!fam) throw redirect(303, '/setup');
  return fam.id;
}

export const actions: Actions = {
  addKid: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    try {
      await addKid({ familyId, name: data.get('name')?.toString() ?? '', birthdate: data.get('birthdate')?.toString() ?? '' });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Kid added.' };
  },
  addParent: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    try {
      await addParent({ familyId, name: data.get('name')?.toString() ?? '' });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Co-parent added.' };
  },
  edit: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    const birthdate = data.get('birthdate')?.toString();
    try {
      await editMember({ id: data.get('id')?.toString() ?? '', familyId, name: data.get('name')?.toString() ?? '', birthdate: birthdate || undefined });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Saved.' };
  },
  archive: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    try {
      await archiveMember({ id: data.get('id')?.toString() ?? '', familyId });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Archived.' };
  },
  restore: async ({ request }) => {
    const familyId = await requireFamilyId();
    const data = await request.formData();
    try {
      await restoreMember({ id: data.get('id')?.toString() ?? '', familyId });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Restored.' };
  },
};
