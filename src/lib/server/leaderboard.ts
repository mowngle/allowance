// Cross-home leaderboard scoring. Produces the per-kid summary pushed to the
// Scoreboard Worker. Fair across ages: consistency % is the base, streak the
// tiebreaker/momentum. Money is never included (spec §3).

import { and, eq, gte, lte } from 'drizzle-orm';
import { db, schema } from './db';
import { todayIso, isoDaysAgo, weekStarting } from './dates';
import { getCurrentWeekReview } from './payouts';

export interface SummaryKid {
  name: string;
  avatar: string;
  pct: number;
  streak: number;
  choresDone: number;
  badges: string[];
}

export interface LocalSummary {
  house: string;
  weekStarting: string;
  kids: SummaryKid[];
}

const STREAK_LOOKBACK_DAYS = 60;

/**
 * Consecutive days (walking back from today) with no missed chore. A "miss" is a
 * pending/disputed instance on a past day. Days with no chores are neutral (don't
 * break, don't count). Today's still-pending chores don't break the streak.
 */
export async function streakForKid(personId: string): Promise<number> {
  const today = todayIso();
  const since = isoDaysAgo(STREAK_LOOKBACK_DAYS);

  const rows = await db
    .select({
      dueDate: schema.choreInstances.dueDate,
      status: schema.choreInstances.status,
    })
    .from(schema.choreInstances)
    .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
    .where(
      and(
        eq(schema.chores.assigneeId, personId),
        gte(schema.choreInstances.dueDate, since),
        lte(schema.choreInstances.dueDate, today)
      )
    );

  const byDay = new Map<string, string[]>();
  for (const r of rows) {
    const list = byDay.get(r.dueDate) ?? [];
    list.push(r.status);
    byDay.set(r.dueDate, list);
  }

  let streak = 0;
  for (let back = 0; back < STREAK_LOOKBACK_DAYS; back++) {
    const day = isoDaysAgo(back);
    const statuses = byDay.get(day);
    if (!statuses) continue; // no chores that day — neutral
    const missed = statuses.some((s) => s === 'pending' || s === 'disputed');
    if (missed) {
      if (day === today) continue; // today's not over yet
      break;
    }
    streak++;
  }
  return streak;
}

/** Each of the last 5 days had at least one chore marked done before 8am local. */
async function hasDawnPatrol(personId: string): Promise<boolean> {
  for (let back = 0; back < 5; back++) {
    const day = isoDaysAgo(back);
    const rows = await db
      .select({ markedDoneAt: schema.choreInstances.markedDoneAt })
      .from(schema.choreInstances)
      .innerJoin(schema.chores, eq(schema.chores.id, schema.choreInstances.choreId))
      .where(and(eq(schema.chores.assigneeId, personId), eq(schema.choreInstances.dueDate, day)));
    const before8 = rows.some(
      (r) => r.markedDoneAt != null && new Date(r.markedDoneAt).getHours() < 8
    );
    if (!before8) return false;
  }
  return true;
}

/** Compute the badge ids for a kid. `pct` is this week's consistency %. */
export async function badgesForKid(
  personId: string,
  pct: number,
  streak?: number
): Promise<string[]> {
  const badges: string[] = [];
  if (pct === 100) badges.push('perfect-week');
  const s = streak ?? (await streakForKid(personId));
  if (s >= 14) badges.push('iron-streak');
  if (await hasDawnPatrol(personId)) badges.push('dawn-patrol');
  // NOTE: 'comeback-kid' (biggest week-over-week jump) is deferred to v2 — it needs
  // last week's pct stored per kid, which we don't persist yet. 'cup-holder' is
  // rendered as the winning-house banner at board time, not a per-kid badge here.
  return badges;
}

/** Build this family's summary payload for the Scoreboard Worker. */
export async function buildLocalSummary(familyId: string): Promise<LocalSummary> {
  const today = todayIso();

  const famRows = await db
    .select({ name: schema.families.name })
    .from(schema.families)
    .where(eq(schema.families.id, familyId))
    .limit(1);
  const houseName = famRows[0]?.name ?? 'House';

  const review = await getCurrentWeekReview(familyId);

  const kids: SummaryKid[] = [];
  for (const item of review) {
    const pct =
      item.totalCount > 0 ? Math.round((item.confirmedCount / item.totalCount) * 100) : 0;
    const streak = await streakForKid(item.kidId);
    const [badges, avatarRows] = await Promise.all([
      badgesForKid(item.kidId, pct, streak),
      db
        .select({ avatarUrl: schema.persons.avatarUrl })
        .from(schema.persons)
        .where(eq(schema.persons.id, item.kidId))
        .limit(1),
    ]);
    kids.push({
      name: item.kidName,
      avatar: avatarRows[0]?.avatarUrl ?? '',
      pct,
      streak,
      choresDone: item.confirmedCount,
      badges,
    });
  }

  return { house: houseName, weekStarting: weekStarting(today), kids };
}
