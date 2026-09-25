import { describe, expect, it } from 'vitest';

import {
  DAY_STARTS_AT_HOUR,
  dayKeyUtc,
  learningDate,
  learningDayKey,
  startOfLearningDay,
} from './time.js';

/**
 * A day that runs 06:00 to 06:00.
 *
 * Every case here is a way the old midnight boundary broke a late session: the
 * plan rolling over mid-problem, the minutes counter resetting while someone is
 * still typing, and half of one evening's work carried forward as a backlog.
 *
 * Two zones on purpose. Asia/Kolkata is a half-hour offset, which catches
 * arithmetic that assumes whole hours; America/New_York observes daylight
 * saving, which catches a boundary computed from a single offset reading.
 */

const IST = 'Asia/Kolkata';
const NY = 'America/New_York';

/** An instant, written as the wall clock in a zone, via a known-good offset. */
const utc = (iso: string) => new Date(iso);

describe('which day an instant belongs to', () => {
  it('counts late-night work as the previous day', () => {
    // 01:00 IST on the 27th is 19:30Z on the 26th.
    expect(learningDayKey(utc('2026-09-26T19:30:00Z'), IST)).toBe('2026-09-26');
  });

  it('rolls over at 06:00, not midnight', () => {
    // 05:59 IST on the 27th — still the 26th's session.
    expect(learningDayKey(utc('2026-09-27T00:29:00Z'), IST)).toBe('2026-09-26');
    // 06:01 IST on the 27th — a new day.
    expect(learningDayKey(utc('2026-09-27T00:31:00Z'), IST)).toBe('2026-09-27');
  });

  it('treats the evening as its own day', () => {
    // 22:00 IST on the 26th.
    expect(learningDayKey(utc('2026-09-26T16:30:00Z'), IST)).toBe('2026-09-26');
  });

  it('does not shift a mid-afternoon instant', () => {
    // 15:00 IST.
    expect(learningDayKey(utc('2026-09-26T09:30:00Z'), IST)).toBe('2026-09-26');
  });

  it('crosses a month boundary backwards', () => {
    // 02:00 IST on 1 October belongs to 30 September.
    expect(learningDayKey(utc('2026-09-30T20:30:00Z'), IST)).toBe('2026-09-30');
  });

  it('crosses a year boundary backwards', () => {
    // 03:00 IST on 1 January 2027 belongs to 31 December 2026.
    expect(learningDayKey(utc('2026-12-31T21:30:00Z'), IST)).toBe('2026-12-31');
  });

  it('reads the zone, not the machine', () => {
    // One instant, two zones, two different days — which is the whole reason
    // this takes a zone instead of using the server's clock.
    const instant = utc('2026-09-27T02:00:00Z');

    expect(learningDayKey(instant, IST)).toBe('2026-09-27'); // 07:30 IST
    expect(learningDayKey(instant, NY)).toBe('2026-09-26'); // 22:00 the 26th
  });
});

describe('when the learning day started', () => {
  it('is 06:00 local, expressed as an instant', () => {
    // 06:00 IST on the 26th is 00:30Z.
    const start = startOfLearningDay(utc('2026-09-26T16:30:00Z'), IST);

    expect(start.toISOString()).toBe('2026-09-26T00:30:00.000Z');
  });

  it('is the previous 06:00 for a late-night instant', () => {
    // 01:00 IST on the 27th looks back to 06:00 IST on the 26th.
    const start = startOfLearningDay(utc('2026-09-26T19:30:00Z'), IST);

    expect(start.toISOString()).toBe('2026-09-26T00:30:00.000Z');
  });

  it('is never in the future', () => {
    for (const hour of [0, 5, 6, 7, 12, 18, 23]) {
      const instant = utc(`2026-09-26T${String(hour).padStart(2, '0')}:00:00Z`);

      for (const zone of [IST, NY]) {
        expect(startOfLearningDay(instant, zone).getTime()).toBeLessThanOrEqual(instant.getTime());
      }
    }
  });

  it('is never more than a day and a bit ago', () => {
    // The window a learning day covers is 24 hours. Anything wider means an
    // instant is being credited to a day that had already ended.
    for (const hour of [0, 5, 6, 7, 23]) {
      const instant = utc(`2026-11-01T${String(hour).padStart(2, '0')}:00:00Z`);

      for (const zone of [IST, NY]) {
        const elapsed = instant.getTime() - startOfLearningDay(instant, zone).getTime();
        // Slack for the daylight-saving night, which is 25 hours long.
        expect(elapsed).toBeLessThan(25 * 3_600_000);
      }
    }
  });

  it('survives a daylight saving change', () => {
    // New York moves off DST at 02:00 on 1 November 2026, so 06:00 local that
    // morning is UTC-5 rather than the UTC-4 it was the day before. Both must
    // land on 06:00 local, at two different instants.
    //
    // This is what the second offset reading in `fromWallClock` is for: the
    // offset at the first guess and the offset at the answer differ across a
    // saving change, and trusting only the first puts the boundary an hour out.
    const before = startOfLearningDay(utc('2026-10-31T18:00:00Z'), NY); // 14:00 EDT
    const after = startOfLearningDay(utc('2026-11-01T18:00:00Z'), NY); // 13:00 EST

    expect(before.toISOString()).toBe('2026-10-31T10:00:00.000Z'); // 06:00 EDT
    expect(after.toISOString()).toBe('2026-11-01T11:00:00.000Z'); // 06:00 EST
  });

  it('agrees with the day key it derives from', () => {
    for (const iso of [
      '2026-09-26T19:30:00Z',
      '2026-09-27T00:29:00Z',
      '2026-09-27T00:31:00Z',
      '2026-03-14T12:00:00Z',
    ]) {
      const instant = utc(iso);

      for (const zone of [IST, NY]) {
        // The instant the day began must itself belong to that same day, or
        // a query filtering from it would exclude its own first moment.
        expect(learningDayKey(startOfLearningDay(instant, zone), zone)).toBe(
          learningDayKey(instant, zone),
        );
      }
    }
  });
});

describe('the value stored in a date column', () => {
  it('is midnight UTC of the logical date', () => {
    // Unambiguous on purpose: a local-midnight Date handed to a date column is
    // truncated in whichever direction the server's offset points, which is
    // how an IST deployment files Monday's routine under Sunday.
    expect(learningDate(utc('2026-09-26T19:30:00Z'), IST).toISOString()).toBe(
      '2026-09-26T00:00:00.000Z',
    );
  });

  it('round-trips through the key it was built from', () => {
    const instant = utc('2026-09-27T00:29:00Z');

    expect(dayKeyUtc(learningDate(instant, IST))).toBe(learningDayKey(instant, IST));
  });
});

describe('the boundary itself', () => {
  it('is 6, and stated once', () => {
    // Referenced rather than repeated, so the tests and the rule cannot drift.
    expect(DAY_STARTS_AT_HOUR).toBe(6);
  });
});
