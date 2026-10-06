import { act, cleanup, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useLearningSession, type LearningSessionState } from './useLearningSession';

/**
 * The timer, against the three ways somebody leaves.
 *
 * Reported as "the time is not working". The concept page had no timer at all,
 * the clock moved once a minute so it read as frozen, and leaving was noticed
 * only every thirty seconds — with coming back crediting up to a minute of the
 * time away. What is asserted here is the agreed behaviour: count from opening,
 * pause within a second on a hidden tab, a focused-away window or two idle
 * minutes, and never count the gap.
 *
 * Rendered under StrictMode, because that is how the app mounts and it
 * double-mounts effects — so a session opened twice, or closed and reopened,
 * would show up here.
 */

const { apiRequest } = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('./api.js', () => ({ apiRequest }));

let visibility: DocumentVisibilityState = 'visible';
let focused = true;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-07T10:00:00.000Z'));
  visibility = 'visible';
  focused = true;

  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);

  apiRequest.mockReset();
  apiRequest.mockImplementation((path: string) => {
    if (path === '/sessions') return Promise.resolve({ id: 'session-1', durationMs: 0 });
    // The server's banked figure is not under test here; echoing nothing keeps
    // the on-screen clock driven by the hook's own arithmetic.
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  // Unmounted before the mocks are restored: unmounting sends the closing
  // request, and a restored mock answers it with undefined instead of a
  // promise.
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Mounts the hook and exposes its latest state. */
function mount() {
  const latest: { current: LearningSessionState | null } = { current: null };

  function Probe() {
    latest.current = useLearningSession('concept-1');
    return null;
  }

  const view = render(
    <StrictMode>
      <Probe />
    </StrictMode>,
  );

  return { latest, view };
}

/** Lets the session-creating request resolve. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

const calls = (path: string) =>
  apiRequest.mock.calls.filter((call) => call[0] === path || String(call[0]).endsWith(path));

describe('the learning timer', () => {
  it('counts from the moment the concept opens, ticking in seconds', async () => {
    const { latest } = mount();
    await settle();

    await advance(5_000);

    expect(latest.current!.counting).toBe(true);
    // Live, not once a minute: five seconds is visible as five seconds.
    expect(Math.round(latest.current!.durationMs / 1000)).toBe(5);
  });

  it('pauses at once when the tab is hidden, and keeps what was counted', async () => {
    const { latest } = mount();
    await settle();
    await advance(10_000);

    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(latest.current!.counting).toBe(false);
    expect(latest.current!.pausedBecause).toBe('hidden');
    // keepalive, because hidden is also how a closing tab says goodbye.
    const pause = calls('/pause').at(-1);
    expect(pause?.[1]).toMatchObject({ method: 'POST', keepalive: true });

    // Time passing while hidden adds nothing.
    await advance(60_000);
    expect(Math.round(latest.current!.durationMs / 1000)).toBe(10);
  });

  it('pauses when another window takes focus', async () => {
    const { latest } = mount();
    await settle();

    focused = false;
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });

    expect(latest.current!.counting).toBe(false);
    expect(latest.current!.pausedBecause).toBe('unfocused');
  });

  it('pauses after two minutes with nothing touched, and resumes on a key', async () => {
    const { latest } = mount();
    await settle();

    await advance(2 * 60_000 + 1_500);
    expect(latest.current!.counting).toBe(false);
    expect(latest.current!.pausedBecause).toBe('idle');
    const atPause = latest.current!.durationMs;

    // Gone for a while; none of it counts.
    await advance(5 * 60_000);
    expect(latest.current!.durationMs).toBe(atPause);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(latest.current!.counting).toBe(true);
    // Back is announced as a beat, which the server reads as "resume".
    expect(calls('/beat').length).toBeGreaterThan(0);

    await advance(3_000);
    expect(Math.round((latest.current!.durationMs - atPause) / 1000)).toBe(3);
  });

  it('counts the time before a pause exactly once', async () => {
    // Arithmetic, plainly: twenty seconds counted, then paused, reads twenty.
    const { latest } = mount();
    await settle();
    await advance(20_000);

    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(Math.round(latest.current!.durationMs / 1000)).toBe(20);
  });

  it('starts paused when the concept is opened in a background tab', async () => {
    visibility = 'hidden';

    const { latest } = mount();
    await settle();

    expect(latest.current!.counting).toBe(false);
    expect(latest.current!.pausedBecause).toBe('hidden');
  });

  it('closes the session on the way out', async () => {
    const { view } = mount();
    await settle();

    view.unmount();

    const complete = calls('/complete').at(-1);
    expect(complete?.[1]).toMatchObject({ method: 'POST', keepalive: true });
  });
});
