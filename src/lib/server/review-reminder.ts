// Daily nudge for weeks a parent never reviewed.
//
// The review queue itself already recovers a forgotten week (payouts.ts), but a
// week only gets forgotten because nobody opened the app — so recovery alone
// isn't enough. Once a day we check for earlier weeks still awaiting a decision
// and push the parent phones. It repeats daily while the week stays unreviewed:
// money owed to a kid is worth nagging about, and approving or skipping the week
// stops it.
//
// Mirrors backup.ts's globalThis-guarded scheduler so SvelteKit hot-reload
// doesn't create duplicate timers.

import { db, schema } from './db';
import { countMissedWeeks } from './payouts';
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

/** Push every family that has an unreviewed earlier week. Returns families notified. */
export async function remindMissedReviews(): Promise<number> {
  const families = await db.select({ id: schema.families.id }).from(schema.families);
  let notified = 0;
  for (const fam of families) {
    const count = await countMissedWeeks(fam.id);
    if (count === 0) continue;
    await sendToFamilyParents(fam.id, missedWeeksPayload(count));
    notified++;
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
