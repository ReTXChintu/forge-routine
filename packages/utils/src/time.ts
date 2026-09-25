export const MS_PER_SECOND = 1000;
export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 3_600_000;
export const MS_PER_DAY = 86_400_000;

export function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / MS_PER_DAY;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** Start of the local day, used for routine dates and daily token budgets. */
export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** `YYYY-MM-DD` in local time. Stable key for per-day aggregates. */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function formatDuration(ms: number): string {
  if (ms < MS_PER_SECOND) return `${Math.round(ms)}ms`;
  if (ms < MS_PER_MINUTE) return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  const minutes = Math.floor(ms / MS_PER_MINUTE);
  const seconds = Math.round((ms % MS_PER_MINUTE) / MS_PER_SECOND);
  return `${minutes}m ${seconds}s`;
}

/**
 * Greeting used by the dashboard header.
 *
 * Takes a zone rather than reading the machine's clock, so it agrees with the
 * learning day rather than greeting a UTC server's afternoon while the reader
 * is up at 2am. That hour gets its own line: "good morning" to somebody who
 * has not been to bed reads as a machine that is not paying attention.
 */
export function greetingFor(instant: Date, zone: string): string {
  const hour = wallClockHour(instant, zone);

  if (hour < DAY_STARTS_AT_HOUR) return 'Still going.';
  if (hour < 12) return 'Good morning.';
  if (hour < 18) return 'Good afternoon.';
  return 'Good evening.';
}

// -- The learning day --------------------------------------------------------

/**
 * When a day begins, in local wall-clock hours.
 *
 * Not midnight, because midnight falls in the middle of a session rather than
 * between two. Work at 01:00 belongs to the evening it started in: a plan that
 * rolls over at 00:00 marks a session half finished, carries its own second
 * half forward as a backlog, and resets the minutes counter while the user is
 * still typing. 06:00 is late enough that nobody is working through it and
 * early enough that it is still the same morning.
 */
export const DAY_STARTS_AT_HOUR = 6;

/**
 * The offset of `zone` from UTC at a given instant, in milliseconds.
 *
 * Derived from `Intl` rather than hard-coded, so a zone with daylight saving
 * gives a different answer in July than in January — and a zone on a half-hour
 * offset works without a special case.
 */
function zoneOffsetMs(instant: Date, zone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);

  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  // The zone's wall clock, read as though it were UTC. The gap between that
  // and the real instant is the offset.
  const asIfUtc = Date.UTC(
    field('year'),
    field('month') - 1,
    field('day'),
    field('hour'),
    field('minute'),
    field('second'),
  );

  // Seconds resolution is all `Intl` gives, so the instant is truncated to
  // match rather than leaving a sub-second remainder in the offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The wall-clock calendar date and hour in `zone` at a given instant. */
function wallClock(instant: Date, zone: string) {
  const offset = zoneOffsetMs(instant, zone);
  const shifted = new Date(instant.getTime() + offset);

  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
  };
}

/** The UTC instant of a given wall-clock time in `zone`. */
function fromWallClock(year: number, month: number, day: number, hour: number, zone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);

  // Subtracting the offset at the guess lands on the right instant unless the
  // offset itself differs there — which happens either side of a daylight
  // saving change. Measuring again at the result and preferring that value
  // corrects it.
  const first = guess - zoneOffsetMs(new Date(guess), zone);
  const second = guess - zoneOffsetMs(new Date(first), zone);

  return new Date(second);
}

/**
 * Which learning day an instant falls in, as `YYYY-MM-DD`.
 *
 * Anything before 06:00 belongs to the previous date, so a session that starts
 * at 23:30 and ends at 02:00 is one day's work rather than two half-days.
 */
export function learningDayKey(instant: Date, zone: string): string {
  const wall = wallClock(instant, zone);
  const date =
    wall.hour < DAY_STARTS_AT_HOUR
      ? new Date(Date.UTC(wall.year, wall.month - 1, wall.day - 1))
      : new Date(Date.UTC(wall.year, wall.month - 1, wall.day));

  return dayKeyUtc(date);
}

/**
 * The instant the current learning day began: 06:00 in `zone`.
 *
 * What every "since the start of today" query must compare against.
 */
export function startOfLearningDay(instant: Date, zone: string): Date {
  const [year, month, day] = learningDayKey(instant, zone).split('-').map(Number);

  return fromWallClock(year!, month!, day!, DAY_STARTS_AT_HOUR, zone);
}

/**
 * The learning day as a value for a `date` column.
 *
 * Midnight UTC of the logical date, which is unambiguous: a local-midnight
 * Date handed to a date column is truncated in whichever direction the
 * server's own offset happens to point, which is how an IST deployment ends
 * up filing Monday's routine under Sunday.
 */
export function learningDate(instant: Date, zone: string): Date {
  return new Date(`${learningDayKey(instant, zone)}T00:00:00.000Z`);
}

/** `YYYY-MM-DD` from a Date's UTC fields. Pairs with `learningDate`. */
export function dayKeyUtc(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The hour on `zone`'s wall clock, 0-23. */
export function wallClockHour(instant: Date, zone: string): number {
  return wallClock(instant, zone).hour;
}

/**
 * Whole learning days between two logical dates, as `learningDate` returns
 * them. Both are midnight UTC, so this is plain subtraction rather than
 * anything that has to care about offsets.
 */
export function learningDaysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}
