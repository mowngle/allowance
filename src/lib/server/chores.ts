// Chore instance generation + queries.
//
// "Lazy generation": when a kid views their home page (or a parent loads
// approvals), the server ensures today's instances exist for all of that
// person's active chores. Idempotent — relies on a unique index on
// (chore_id, due_date) to avoid duplicates if called multiple times.

import { and, eq, inArray, lt } from 'drizzle-orm';
import { db, schema } from './db';
import { todayIso, dayOfWeek, parseIsoDate, toIsoDate, isoDaysAgo } from './dates';

type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; days?: number[]; day?: number /* legacy */ }
  | { kind: 'weekdays' } // legacy — equivalent to weekly Mon-Fri
  | { kind: 'by-end-of-week' /* due Saturday */ };

function parseRecurrence(raw: string): Recurrence {
  try {
    const r = JSON.parse(raw);
    return r as Recurrence;
  } catch {
    return { kind: 'daily' };
  }
}

function weeklyDayList(rec: { days?: number[]; day?: number }): number[] {
  if (Array.isArray(rec.days)) return rec.days;
  if (typeof rec.day === 'number') return [rec.day];
  return [];
}

/** Should there be an instance of this chore due on isoDate? */
function isDueOn(rec: Recurrence, isoDate: string): boolean {
  const dow = dayOfWeek(isoDate);
  switch (rec.kind) {
    case 'daily':
      return true;
    case 'weekly':
      return weeklyDayList(rec).includes(dow);
    case 'weekdays':
      return dow >= 1 && dow <= 5;
    case 'by-end-of-week':
      return dow === 6;
  }
}

/**
 * Ensure today's chore instances exist for all active chores assigned to
 * `personId`. Also rolls forward yesterday's undone instances for chores with
 * `expiry_rule = 'roll_forward'`.
 */
export async function ensureTodaysInstances(personId: string): Promise<void> {
  const today = todayIso();
  const yesterday = isoDaysAgo(1);

  const choreRows = await db
    .select()
    .from(schema.chores)
    .where(and(eq(schema.chores.assigneeId, personId), eq(schema.chores.active, true)));

  for (const chore of choreRows) {
    const rec = parseRecurrence(chore.recurrence);
    const dueToday = isDueOn(rec, today);

    // Did yesterday have an undone instance with roll_forward?
    let rolledFromId: string | null = null;
    if (chore.expiryRule === 'roll_forward') {
      const yest = await db
        .select()
        .from(schema.choreInstances)
        .where(
          and(
            eq(schema.choreInstances.choreId, chore.id),
            eq(schema.choreInstances.dueDate, yesterday),
            inArray(schema.choreInstances.status, ['pending', 'disputed'])
          )
        )
        .limit(1);
      if (yest[0]) rolledFromId = yest[0].id;
    }

    if (dueToday || rolledFromId) {
      // INSERT OR IGNORE via the unique index on (choreId, dueDate).
      try {
        db.insert(schema.choreInstances)
          .values({
            id: crypto.randomUUID(),
            choreId: chore.id,
            dueDate: today,
            status: 'pending',
            rolledFromId: rolledFromId ?? undefined,
          })
          .onConflictDoNothing()
          .run();
      } catch (e) {
        console.error(`[chores] insert failed for chore ${chore.id}:`, e);
      }
    }
  }
}

export type TodayChoreView = {
  instanceId: string;
  choreId: string;
  name: string;
  photoUrl: string | null;
  status: 'pending' | 'done' | 'confirmed' | 'disputed';
  rolledFromYesterday: boolean;
};

/** Fetch today's instances for a kid, joined with chore name. */
export async function getTodayChores(personId: string): Promise<TodayChoreView[]> {
  const today = todayIso();
  const rows = await db
    .select({
      instanceId: schema.choreInstances.id,
      choreId: schema.chores.id,
      name: schema.chores.name,
      photoUrl: schema.chores.photoUrl,
      status: schema.choreInstances.status,
      rolledFromId: schema.choreInstances.rolledFromId,
    })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .where(and(eq(schema.chores.assigneeId, personId), eq(schema.choreInstances.dueDate, today)));

  return rows.map((r) => ({
    instanceId: r.instanceId,
    choreId: r.choreId,
    name: r.name,
    photoUrl: r.photoUrl,
    status: r.status,
    rolledFromYesterday: !!r.rolledFromId,
  }));
}

export type WeekProgress = {
  status: 'on_track' | 'behind';
  behindCount: number;
};

/**
 * "On track" if no past-due instances are pending or disputed.
 * "Behind N" otherwise.
 *
 * Only counts instances from the past 7 days to avoid old data dragging on
 * forever. The Friday review reset can clean this up properly later.
 */
export async function getWeekProgress(personId: string): Promise<WeekProgress> {
  const today = todayIso();
  const weekAgo = isoDaysAgo(7);

  const rows = await db
    .select({
      id: schema.choreInstances.id,
      status: schema.choreInstances.status,
      dueDate: schema.choreInstances.dueDate,
    })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .where(
      and(
        eq(schema.chores.assigneeId, personId),
        lt(schema.choreInstances.dueDate, today)
      )
    );

  const behind = rows.filter(
    (r) =>
      r.dueDate >= weekAgo &&
      (r.status === 'pending' || r.status === 'disputed')
  ).length;

  return {
    status: behind === 0 ? 'on_track' : 'behind',
    behindCount: behind,
  };
}

/** Kid marks their own chore done. Status → 'done'. */
export async function markChoreDone(personId: string, instanceId: string): Promise<void> {
  // Verify the instance belongs to a chore assigned to this person.
  const rows = await db
    .select({
      instanceId: schema.choreInstances.id,
      assigneeId: schema.chores.assigneeId,
      status: schema.choreInstances.status,
    })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .where(eq(schema.choreInstances.id, instanceId))
    .limit(1);
  const r = rows[0];
  if (!r) throw new Error('Instance not found');
  if (r.assigneeId !== personId) throw new Error('Not your chore');
  if (r.status === 'confirmed') return; // already finalized

  db.update(schema.choreInstances)
    .set({ status: 'done', markedDoneAt: Date.now() })
    .where(eq(schema.choreInstances.id, instanceId))
    .run();
}
