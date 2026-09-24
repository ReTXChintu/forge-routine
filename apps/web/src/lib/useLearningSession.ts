import { useEffect, useRef, useState } from 'react';

import { apiRequest } from './api.js';

/**
 * Times a stretch of real work.
 *
 * Mounted by a workspace — an exercise, a project step, a challenge — it
 * opens a session, says "still working" while the user actually is, and
 * closes it on the way out. The server does the arithmetic; this only
 * answers the one question it cannot: is anybody there.
 *
 * "There" means two things, and both have to hold:
 *
 *   The tab is visible. A workspace in a background tab is not practice,
 *   and `visibilitychange` covers the overwhelmingly common case of
 *   wandering off to read something else.
 *
 *   Somebody touched something in the last few minutes. Thinking hard
 *   about a problem looks identical to having left, for a while — hence
 *   minutes rather than seconds before it gives up.
 *
 * Beats stop the moment either fails, and start again on the next
 * keystroke. Nothing has to be closed cleanly: the server has already
 * banked everything up to the last beat.
 */

/** Matches MAX_GAP_MS server-side, which forgives exactly one dropped beat. */
const BEAT_MS = 30_000;

/**
 * How long a still keyboard is still counted as work.
 *
 * Generous on purpose. Reading the problem, or staring at a failing test,
 * is the part of this the product exists to protect, and a timer that
 * stops after thirty seconds of thought would measure typing speed.
 */
const IDLE_AFTER_MS = 3 * 60_000;

interface Session {
  id: string;
  durationMs: number | null;
}

export interface LearningSessionState {
  /** Banked milliseconds, as the server last reported them. */
  durationMs: number;
  /** False while idle or hidden, so the UI can show the clock is paused. */
  counting: boolean;
}

export function useLearningSession(conceptId: string | null | undefined): LearningSessionState {
  const [state, setState] = useState<LearningSessionState>({ durationMs: 0, counting: false });

  const sessionId = useRef<string | null>(null);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!conceptId) return;

    let cancelled = false;
    const markActive = () => {
      lastActivity.current = Date.now();
    };

    // Deliberately not mousemove: a cursor resting on a trackpad drifts,
    // and a timer kept alive by drift is a timer that never stops.
    const events = ['keydown', 'pointerdown', 'wheel', 'focus'] as const;
    for (const event of events) window.addEventListener(event, markActive, { passive: true });
    document.addEventListener('visibilitychange', markActive);

    void apiRequest<Session>('/sessions', { method: 'POST', body: { conceptId } })
      .then((session) => {
        if (cancelled) {
          // Unmounted while the request was in flight. Close it, or it
          // beats forever against a component that no longer exists.
          void apiRequest(`/sessions/${session.id}/complete`, { method: 'POST' }).catch(
            () => undefined,
          );
          return;
        }
        sessionId.current = session.id;
        setState({ durationMs: session.durationMs ?? 0, counting: true });
      })
      .catch(() => {
        // Timing is not worth failing a workspace over. The exercise still
        // runs; only the minutes are lost.
      });

    const interval = window.setInterval(() => {
      const id = sessionId.current;
      if (!id) return;

      const active = !document.hidden && Date.now() - lastActivity.current < IDLE_AFTER_MS;
      setState((current) => ({ ...current, counting: active }));
      if (!active) return;

      void apiRequest<Session>(`/sessions/${id}/beat`, { method: 'POST' })
        .then((session) => {
          if (!cancelled) setState({ durationMs: session.durationMs ?? 0, counting: true });
        })
        .catch(() => undefined);
    }, BEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      for (const event of events) window.removeEventListener(event, markActive);
      document.removeEventListener('visibilitychange', markActive);

      const id = sessionId.current;
      sessionId.current = null;

      if (id) {
        // keepalive so the request survives the navigation that triggered
        // this. sendBeacon cannot carry the Authorization header.
        void apiRequest(`/sessions/${id}/complete`, { method: 'POST', keepalive: true }).catch(
          () => undefined,
        );
      }
    };
  }, [conceptId]);

  return state;
}

/** "7m", "1h 12m" — a duration, not a stopwatch. */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
