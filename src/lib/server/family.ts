// Family-wide queries used by parent screens.

import { and, eq, gte, lt, sum, sql } from 'drizzle-orm';
import { db, schema } from './db';
import { todayIso, isoDaysAgo, ageOn, weekStarting } from './dates';
import { getWeekProgress, ensureTodaysInstances } from './chores';

export type KidSummary = {
  personId: string;
  name: string;
  age: number;
  weekProgressStatus: 'on_track' | 'behind';
  behindCount: number;
  balanceCents: number;
  pendingApprovalsCount: number;
};

export async function getKidSummaries(familyId: string): Promise<KidSummary[]> {
  const kids = await db
    .select({
      id: schema.persons.id,
      name: schema.persons.name,
      birthdate: schema.persons.birthdate,
    })
    .from(schema.persons)
    .where(and(eq(schema.persons.familyId, familyId), eq(schema.persons.role, 'kid')));

  const today = todayIso();

  const summaries: KidSummary[] = [];
  for (const kid of kids) {
    // Ensure each kid has today's instances materialized so progress is accurate.
    await ensureTodaysInstances(kid.id);

    const [progress, balanceCents, pendingCount] = await Promise.all([
      getWeekProgress(kid.id),
      getBalanceCents(kid.id),
      getPendingApprovalsCount(kid.id),
    ]);

    summaries.push({
      personId: kid.id,
      name: kid.name,
      age: kid.birthdate ? ageOn(kid.birthdate, today) : 0,
      weekProgressStatus: progress.status,
      behindCount: progress.behindCount,
      balanceCents,
      pendingApprovalsCount: pendingCount,
    });
  }

  return summaries;
}

export async function getBalanceCents(kidId: string): Promise<number> {
  const rows = await db
    .select({ total: sum(schema.ledgerEntries.amountCents).as('total') })
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.kidId, kidId));
  const total = rows[0]?.total;
  return total ? Number(total) : 0;
}

export async function getPendingApprovalsCount(kidId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)`.as('count') })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .where(and(eq(schema.chores.assigneeId, kidId), eq(schema.choreInstances.status, 'done')));
  return Number(rows[0]?.count ?? 0);
}

export type PendingApproval = {
  instanceId: string;
  kidId: string;
  kidName: string;
  choreName: string;
  markedDoneAt: number | null;
  dueDate: string;
  rolledFromYesterday: boolean;
};

/** All pending approvals across all kids in the family, newest first. */
export async function getPendingApprovals(familyId: string): Promise<PendingApproval[]> {
  const rows = await db
    .select({
      instanceId: schema.choreInstances.id,
      kidId: schema.persons.id,
      kidName: schema.persons.name,
      choreName: schema.chores.name,
      markedDoneAt: schema.choreInstances.markedDoneAt,
      dueDate: schema.choreInstances.dueDate,
      rolledFromId: schema.choreInstances.rolledFromId,
    })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .innerJoin(schema.persons, eq(schema.persons.id, schema.chores.assigneeId))
    .where(and(eq(schema.persons.familyId, familyId), eq(schema.choreInstances.status, 'done')));

  return rows
    .map((r) => ({
      instanceId: r.instanceId,
      kidId: r.kidId,
      kidName: r.kidName,
      choreName: r.choreName,
      markedDoneAt: r.markedDoneAt,
      dueDate: r.dueDate,
      rolledFromYesterday: !!r.rolledFromId,
    }))
    .sort((a, b) => (b.markedDoneAt ?? 0) - (a.markedDoneAt ?? 0));
}

export async function confirmApproval(
  parentPersonId: string,
  instanceId: string
): Promise<void> {
  // Verify the parent shares a family with the chore's kid.
  const guard = await guardApproval(parentPersonId, instanceId);
  if (!guard.ok) throw new Error(guard.reason);

  db.update(schema.choreInstances)
    .set({
      status: 'confirmed',
      confirmedAt: Date.now(),
      confirmedBy: parentPersonId,
    })
    .where(eq(schema.choreInstances.id, instanceId))
    .run();
}

export async function disputeApproval(
  parentPersonId: string,
  instanceId: string
): Promise<void> {
  const guard = await guardApproval(parentPersonId, instanceId);
  if (!guard.ok) throw new Error(guard.reason);

  db.update(schema.choreInstances)
    .set({
      status: 'disputed',
      confirmedAt: null,
      confirmedBy: null,
      markedDoneAt: null,
    })
    .where(eq(schema.choreInstances.id, instanceId))
    .run();
}

async function guardApproval(
  parentPersonId: string,
  instanceId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const parent = await db
    .select({ familyId: schema.persons.familyId, role: schema.persons.role })
    .from(schema.persons)
    .where(eq(schema.persons.id, parentPersonId))
    .limit(1);
  if (!parent[0] || parent[0].role !== 'parent') {
    return { ok: false, reason: 'Not a parent' };
  }

  const inst = await db
    .select({ instanceId: schema.choreInstances.id, familyId: schema.persons.familyId })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .innerJoin(schema.persons, eq(schema.persons.id, schema.chores.assigneeId))
    .where(eq(schema.choreInstances.id, instanceId))
    .limit(1);
  if (!inst[0]) return { ok: false, reason: 'Instance not found' };
  if (inst[0].familyId !== parent[0].familyId) {
    return { ok: false, reason: 'Different family' };
  }
  return { ok: true };
}
