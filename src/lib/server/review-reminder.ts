// Payout-day reminder for weeks awaiting a decision.
//
// The queue itself already recovers a forgotten week (payouts.ts) — this just
// keeps a backlog from forming. It fires once a week, on the family's chosen
// payoutDay, and then stays silent: missing it is now merely annoying rather
// than costly, and a nagging channel is a muted channel. Muting would take the
// chore-done alerts with it.
//
// Server off at 18:00 on payout day means no nudge that week. Acceptable — the
// queue is the safety net, not this.
//
// Mirrors backup.ts's globalThis-guarded scheduler so SvelteKit hot-reload
// doesn't create duplicate timers.

import { db, schema } from './db';
import { countOutstandingWeeks } from './payouts';
import { todayIso, dayOfWeek } from './dates';
import { sendToFamilyParents } from './push';

export function missedWeeksPayload(count: number): {
  title: string;
  body: string;
  url: string;
  tag: string;
} {
  const weeks = count === 1 ? 'week' : 'weeks';
  const them = count === 1 ? 'it' : 'them';
  return {
    title: `${count} ${weeks} still need${count === 1 ? 's' : ''} review`,
    body: `Nobody has been paid for ${them} yet. Tap to approve or skip.`,
    url: '/review',
    tag: 'review-overdue',
  };
}

/**
 * Push every family whose payoutDay is `nowIso`'s weekday and which has a week
 * awaiting a decision. Returns families notified. `nowIso` is injectable so
 * tests don't have to freeze the clock.
 */
export async function remindMissedReviews(nowIso: string = todayIso()): Promise<number> {
  const dow = dayOfWeek(nowIso);
  const families = await db
    .select({ id: schema.families.id, payoutDay: schema.families.payoutDay })
    .from(schema.families);

  let notified = 0;
  for (const fam of families) {
    if (fam.payoutDay !== dow) continue;
    const count = await countOutstandingWeeks(fam.id);
    if (count === 0) continue;
    try {
      await sendToFamilyParents(fam.id, missedWeeksPayload(count));
      notified++;
    } catch (e) {
      // One family's dead endpoint must not stop the others.
      console.error('[review-reminder] push failed:', e);
    }
  }
  return notified;
}

// ─── Scheduler (mirrors backup.ts) ───────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __allowanceReviewReminder__: { timer: NodeJS.Timeout | null } | undefined;
}

/** Reminder hour, local time. Early evening — parents are home and can act. */
const REMINDER_HOUR = 18;

function msUntilNext(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleReviewReminder(): void {
  const existing = (globalThis as any).__allowanceReviewReminder__;
  if (existing?.timer) clearTimeout(existing.timer);
  const state = { timer: null as NodeJS.Timeout | null };
  (globalThis as any).__allowanceReviewReminder__ = state;

  function arm() {
    state.timer = setTimeout(async () => {
      try {
        const n = await remindMissedReviews();
        if (n > 0) console.log(`[review-reminder] nudged ${n} family/families`);
      } catch (e) {
        console.error('[review-reminder] daily nudge errored:', e);
      }
      arm();
    }, msUntilNext(REMINDER_HOUR));
  }
  arm();
  console.log('[review-reminder] scheduler armed');
}
