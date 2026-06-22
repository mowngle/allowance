import type { Actions, PageServerLoad } from './$types';
import { fail, redirect, error } from '@sveltejs/kit';
import { requireFreshPin } from '$lib/server/pinGuard';
import { listMembers, addKid, addParent, editMember, archiveMember, restoreMember } from '$lib/server/members';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.session) throw redirect(303, '/claim');
  if (locals.session.role !== 'parent') throw error(403, 'Parents only');
  await requireFreshPin(locals.session, '/settings/members');
  return await listMembers(locals.session.familyId);
};

export const actions: Actions = {
  addKid: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    try {
      await addKid({ familyId: locals.session.familyId, name: data.get('name')?.toString() ?? '', birthdate: data.get('birthdate')?.toString() ?? '' });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Kid added.' };
  },
  addParent: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    try {
      await addParent({ familyId: locals.session.familyId, name: data.get('name')?.toString() ?? '' });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Co-parent added.' };
  },
  edit: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    const birthdate = data.get('birthdate')?.toString();
    try {
      await editMember({ id: data.get('id')?.toString() ?? '', familyId: locals.session.familyId, name: data.get('name')?.toString() ?? '', birthdate: birthdate || undefined });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Saved.' };
  },
  archive: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    try {
      await archiveMember({ id: data.get('id')?.toString() ?? '', familyId: locals.session.familyId });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Archived.' };
  },
  restore: async ({ locals, request }) => {
    if (!locals.session || locals.session.role !== 'parent') return fail(403, { error: 'Parents only' });
    const data = await request.formData();
    try {
      await restoreMember({ id: data.get('id')?.toString() ?? '', familyId: locals.session.familyId });
    } catch (e) { return fail(400, { error: (e as Error).message }); }
    return { ok: true, message: 'Restored.' };
  },
};
