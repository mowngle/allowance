// Types shared between the payout server module and the review components.
// They live outside $lib/server because SvelteKit forbids client code from
// importing anything under $lib/server, and ReviewCard.svelte needs them.

export type WeeklyReviewItem = {
  cycleId: string;
  kidId: string;
  kidName: string;
  age: number;
  weekStarting: string;
  weekEnding: string;
  /** 0 = the week in progress, 1 = last week, ... */
  weeksAgo: number;
  suggestedAmountCents: number;
  status: 'open' | 'reviewed' | 'paid' | 'skipped';
  actualAmountCents: number | null;
  confirmedCount: number;
  pendingCount: number;
  disputedCount: number;
  totalCount: number;
  missedChoreNames: string[];
};

export type ReviewQueue = {
  /** The in-progress week, one item per active kid. */
  current: WeeklyReviewItem[];
  /** Items from the DETAIL_WEEKS most recent past unreviewed weeks. */
  recent: WeeklyReviewItem[];
  /** Everything older, newest week first. */
  older: WeeklyReviewItem[];
};
