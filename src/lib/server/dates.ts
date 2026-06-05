// Date helpers. All date strings are 'YYYY-MM-DD' in local time.
//
// Why local time and not UTC: chore due dates are intuitive day-boundaries
// ("today is Monday"), not UTC instants. We compute "today" based on the
// server's local timezone, which on the Mac mini will match the family's
// timezone. If we ever support multi-timezone families, we'd add a tz column.

export function todayIso(): string {
  return toIsoDate(new Date());
}

export function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toIsoDate(d);
}

export function isoDaysAhead(n: number): string {
  return isoDaysAgo(-n);
}

/** 0=Sun, 1=Mon, ... 6=Sat */
export function dayOfWeek(isoDate: string): number {
  return parseIsoDate(isoDate).getDay();
}

export function parseIsoDate(isoDate: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Returns the ISO date of the most recent Monday on or before isoDate.
 * Responsibility weeks run Mon–Sun, reviewed Sunday. So Monday is the
 * "week_starting" anchor for payout cycles.
 */
export function weekStarting(isoDate: string): string {
  const d = parseIsoDate(isoDate);
  const dow = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const back = (dow + 6) % 7; // Mon→0, Tue→1, ..., Sun→6
  d.setDate(d.getDate() - back);
  return toIsoDate(d);
}

/** End of the current responsibility week (Sunday) for a given date. */
export function weekEnding(isoDate: string): string {
  const start = weekStarting(isoDate);
  const d = parseIsoDate(start);
  d.setDate(d.getDate() + 6);
  return toIsoDate(d);
}

/** Compute age in whole years given a birthdate (ISO date) and an "as of" date. */
export function ageOn(birthdateIso: string, asOfIso: string): number {
  const birth = parseIsoDate(birthdateIso);
  const asOf = parseIsoDate(asOfIso);
  let age = asOf.getFullYear() - birth.getFullYear();
  const mDiff = asOf.getMonth() - birth.getMonth();
  if (mDiff < 0 || (mDiff === 0 && asOf.getDate() < birth.getDate())) age--;
  return age;
}
