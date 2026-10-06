import { useEffect, useRef, useState } from 'react';

import { apiRequest } from './api.js';

/**
 * Times a stretch of real work.
 *
 * Mounted by a concept page or a workspace, it opens a session and counts only
 * while somebody is actually there. "There" means all three of:
 *
 *   The tab is visible. Switching tabs or minimising the window hides it.
 *
 *   The window has focus. Clicking into another app — an editor, a terminal —
 *   while the browser stays visible behind it is still leaving, and counts as
 *   such. Chosen deliberately; reading here while typing notes elsewhere is
 *   not counted.
 *
 *   Something was touched in the last two minutes: a key, a click, a scroll,
 *   a touch. Long enough to read a paragraph or think about a question with
 *   your hands still, short enough that walking away stops the clock soon.
 *
 * The moment any of those stops holding — checked every second, and straight
 * away on the events that announce it — the session is paused on the server,
 * which banks the time up to that instant and then counts nothing until it
 * hears from us again. Coming back resumes from that moment. The gap in
 * between is never credited; before pausing existed, returning credited up to
 * a minute of time spent away.
 *
 * The server does the counting. The clock on screen is the server's last
 * figure plus the seconds since, so it ticks live without trusting the
 * browser for anything that gets stored.
 */

/** How often the server hears "still here" while counting. */
const BEAT_MS = 30_000;

/** How long with nothing touched before it stops counting. */
const IDLE_AFTER_MS = 2 * 60_000;

/** How often presence is re-checked, and the on-screen clock ticks. */
const TICK_MS = 1_000;

export type PauseReason = 'hidden' | 'unfocused' | 'idle' | null;

interface Session {
  id: string;
  durationMs: number | null;
}

export interface LearningSessionState {
  /** Milliseconds counted so far, including the current running stretch. */
  durationMs: number;
  /** False while paused. */
  counting: boolean;
  /** Why it is paused, so the clock can say rather than just stop. */
  pausedBecause: PauseReason;
}

/** Why the user is not here, or null when they are. */
function absence(lastActivity: number): PauseReason {
  if (document.visibilityState !== 'visible') return 'hidden';
  if (!document.hasFocus()) return 'unfocused';
  if (Date.now() - lastActivity >= IDLE_AFTER_MS) return 'idle';
  return null;
}

export function useLearningSession(conceptId: string | null | undefined): LearningSessionState {
  const [banked, setBanked] = useState(0);
  const [pausedBecause, setPausedBecause] = useState<PauseReason>(null);
  const [, setTick] = useState(0);

  const sessionId = useRef<string | null>(null);
  const lastActivity = useRef(Date.now());
  /**
   * When the current counted stretch began, or null while paused.
   *
   * A ref, not state: it is read and written by event handlers that would
   * otherwise close over a stale copy. It also keeps the fold of elapsed time
   * into `banked` out of any state updater — updaters must be pure, and a
   * side effect inside one is unsupported behaviour, whether or not a given
   * render happens to run it once.
   */
  const runningSince = useRef<number | null>(null);

  useEffect(() => {
    if (!conceptId) return;

    let cancelled = false;

    /** The server's figure, adopted as the new baseline. */
    const adopt = (session: Session | undefined) => {
      if (!cancelled && session) setBanked(session.durationMs ?? 0);
    };

    const pause = (reason: Exclude<PauseReason, null>, unloading = false) => {
      setPausedBecause(reason);

      const since = runningSince.current;
      if (since === null) return;

      runningSince.current = null;
      // Kept on screen at once, before the server confirms, so the clock
      // does not jump back by the seconds of a slow request.
      const elapsed = Date.now() - since;
      setBanked((value) => value + elapsed);

      const id = sessionId.current;
      if (id) {
        // keepalive, because "hidden" is also how a closing tab says goodbye
        // and the request has to outlive the page.
        void apiRequest<Session>(`/sessions/${id}/pause`, {
          method: 'POST',
          keepalive: unloading,
        })
          .then(adopt)
          .catch(() => undefined);
      }
    };

    const resume = () => {
      setPausedBecause(null);
      if (runningSince.current !== null) return;

      runningSince.current = Date.now();

      const id = sessionId.current;
      // A beat on a paused session is how the server hears "back": it starts
      // counting from now and banks nothing for the gap.
      if (id) {
        void apiRequest<Session>(`/sessions/${id}/beat`, { method: 'POST' })
          .then(adopt)
          .catch(() => undefined);
      }
    };

    /** Re-reads presence and moves to whichever state it says. */
    const reconcile = () => {
      const reason = absence(lastActivity.current);
      if (reason) pause(reason, reason === 'hidden');
      else resume();
    };

    const markActive = () => {
      lastActivity.current = Date.now();
      // Coming back from idle should not wait for the next tick.
      if (runningSince.current === null) reconcile();
    };

    // Deliberately not mousemove: a cursor resting on a trackpad drifts, and
    // a timer kept alive by drift is a timer that never stops. Scroll is
    // listened for in the capture phase because the page scrolls inside a
    // container, not the window, and scroll events do not bubble.
    const activity = ['keydown', 'pointerdown', 'wheel', 'touchstart'] as const;
    for (const event of activity) window.addEventListener(event, markActive, { passive: true });
    document.addEventListener('scroll', markActive, { passive: true, capture: true });

    // The events that announce leaving and returning, acted on immediately
    // rather than at the next tick.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') lastActivity.current = Date.now();
      reconcile();
    };
    const onFocus = () => {
      lastActivity.current = Date.now();
      reconcile();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', reconcile);
    window.addEventListener('focus', onFocus);

    void apiRequest<Session>('/sessions', { method: 'POST', body: { conceptId } })
      .then((session) => {
        if (cancelled) {
          // Unmounted while the request was in flight. Paused, not closed.
          //
          // Development mounts every effect twice, and the second mount asks
          // for a session on the same concept — which the server answers with
          // this same one. Closing it here could land just after it had been
          // handed over, leaving the live page beating against an ended
          // session that ignores every beat. Paused, the next request for this
          // concept simply resumes it; and a genuinely abandoned one banks
          // nothing for the time nobody was here.
          void apiRequest(`/sessions/${session.id}/pause`, { method: 'POST' }).catch(
            () => undefined,
          );
          return;
        }

        sessionId.current = session.id;
        setBanked(session.durationMs ?? 0);
        // The server counts from now on creating or resuming a session, so the
        // local clock starts from the same moment.
        runningSince.current = Date.now();
        // And then straight back to paused if nobody is actually here — a
        // concept opened in a background tab, say.
        reconcile();
      })
      .catch(() => {
        // Timing is not worth failing a page over. Only the minutes are lost.
      });

    // Presence every second; the clock ticks off the same timer.
    const ticker = window.setInterval(() => {
      if (sessionId.current) reconcile();
      setTick((value) => value + 1);
    }, TICK_MS);

    // "Still here", while counting. Banks the interval and re-baselines, so
    // the on-screen figure never drifts far from the stored one.
    const beater = window.setInterval(() => {
      const id = sessionId.current;
      if (!id || runningSince.current === null) return;

      void apiRequest<Session>(`/sessions/${id}/beat`, { method: 'POST' })
        .then((session) => {
          // Paused while the beat was in flight: the pause has its own figure.
          if (cancelled || runningSince.current === null) return;
          setBanked(session.durationMs ?? 0);
          runningSince.current = Date.now();
        })
        .catch(() => undefined);
    }, BEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(ticker);
      window.clearInterval(beater);
      for (const event of activity) window.removeEventListener(event, markActive);
      document.removeEventListener('scroll', markActive, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', reconcile);
      window.removeEventListener('focus', onFocus);

      const id = sessionId.current;
      sessionId.current = null;
      runningSince.current = null;

      if (id) {
        // keepalive so the request survives the navigation that triggered
        // this. sendBeacon cannot carry the Authorization header.
        void apiRequest(`/sessions/${id}/complete`, { method: 'POST', keepalive: true }).catch(
          () => undefined,
        );
      }
    };
  }, [conceptId]);

  // Read on every render, and the ticker renders every second, so the clock
  // stays live without the stretch's start having to be state.
  const since = runningSince.current;

  return {
    durationMs: banked + (since !== null ? Date.now() - since : 0),
    counting: since !== null,
    pausedBecause,
  };
}

/** "7m", "1h 12m" — a duration, not a stopwatch. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
