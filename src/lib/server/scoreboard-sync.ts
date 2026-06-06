// Nightly push of this house's leaderboard summary to the Scoreboard Worker.
// Mirrors backup.ts's globalThis-guarded scheduler so SvelteKit hot-reload doesn't
// create duplicate timers. No-op when not connected to a scoreboard.

import { isConnected, pushSummary } from './scoreboard';
import { getOrInitOnlyFamily } from './setup';

/** Push the local family's summary if connected. Returns true if a push happened. */
export async function pushSummaryIfConnected(): Promise<boolean> {
  if (!(await isConnected())) return false;
  const fam = await getOrInitOnlyFamily();
  if (!fam) return false;
  try {
    await pushSummary(fam.id);
    return true;
  } catch (e) {
    console.error('[scoreboard-sync] push failed:', e);
    return false;
  }
}

// ─── Scheduler (mirrors backup.ts) ───────────────────────────────────────────

declare global {
  // eslint-disable-next-line no-var
  var __allowanceSummaryScheduler__: { timer: NodeJS.Timeout | null } | undefined;
}

function msUntilNext(hour: number): number {
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

export function scheduleNightlySummaryPush(): void {
  const existing = (globalThis as any).__allowanceSummaryScheduler__;
  if (existing?.timer) clearTimeout(existing.timer);
  const state = { timer: null as NodeJS.Timeout | null };
  (globalThis as any).__allowanceSummaryScheduler__ = state;

  function arm() {
    // 3:30am — just after the nightly backup at 3am.
    state.timer = setTimeout(async () => {
      try {
        const pushed = await pushSummaryIfConnected();
        if (pushed) console.log('[scoreboard-sync] nightly summary pushed');
      } catch (e) {
        console.error('[scoreboard-sync] nightly push errored:', e);
      }
      arm();
    }, msUntilNext(3) + 30 * 60 * 1000);
  }
  arm();
  console.log('[scoreboard-sync] scheduler armed');
}
