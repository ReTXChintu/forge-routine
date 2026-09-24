import { useEffect, useRef, useState } from 'react';

import { apiRequest } from './api.js';

/**
 * Keeps the editor's contents on the server while the user types.
 *
 * Losing work is the one failure this product cannot afford: the whole
 * proposition is that time spent here accumulates, and an editor that
 * throws away half an hour because a tab closed disproves that more
 * convincingly than any feature proves it. So a draft is saved shortly
 * after typing stops, again during long uninterrupted stretches, and once
 * more on the way out.
 *
 * Drafts are not submissions. Nothing saved here is executed, graded, or
 * counted as evidence — it is only what the editor should contain the next
 * time it opens.
 */

/** Long enough not to save mid-word, short enough that a closed tab loses a sentence. */
const QUIET_MS = 1_500;

/**
 * A ceiling on how long steady typing can go unsaved.
 *
 * Without it, someone who never pauses for a second and a half — which is
 * most people mid-flow — would have nothing saved at all until they stopped.
 */
const MAX_WAIT_MS = 15_000;

export type DraftSaveState = 'idle' | 'saving' | 'saved' | 'error';

export function useDraftAutosave(
  attemptId: string | null,
  code: string,
  enabled: boolean,
): DraftSaveState {
  const [state, setState] = useState<DraftSaveState>('idle');

  /** What the server is known to hold, so an unchanged editor saves nothing. */
  const saved = useRef<string | null>(null);
  const latest = useRef(code);
  const oldestUnsavedAt = useRef<number | null>(null);

  latest.current = code;

  // A new attempt starts from an unknown server state rather than inheriting
  // the previous exercise's, which would suppress the first save.
  useEffect(() => {
    saved.current = null;
    oldestUnsavedAt.current = null;
    setState('idle');
  }, [attemptId]);

  useEffect(() => {
    if (!enabled || !attemptId) return;
    if (code === saved.current) return;

    if (oldestUnsavedAt.current === null) oldestUnsavedAt.current = Date.now();

    let cancelled = false;

    const save = () => {
      const pending = latest.current;
      if (pending === saved.current) return;

      setState('saving');
      void apiRequest<void>(`/exercises/attempts/${attemptId}/draft`, {
        method: 'PUT',
        body: { code: pending },
      })
        .then(() => {
          saved.current = pending;
          oldestUnsavedAt.current = null;
          if (!cancelled) setState('saved');
        })
        .catch(() => {
          // Left unsaved on purpose: the next keystroke retries, and the
          // indicator says so rather than claiming a save that did not land.
          if (!cancelled) setState('error');
        });
    };

    const waited = Date.now() - (oldestUnsavedAt.current ?? Date.now());
    const timer = window.setTimeout(save, Math.max(0, Math.min(QUIET_MS, MAX_WAIT_MS - waited)));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attemptId, code, enabled]);

  // The way out: navigation, a closed tab, a phone switching apps. keepalive
  // so the request outlives the page; sendBeacon cannot carry the token.
  useEffect(() => {
    if (!enabled || !attemptId) return;

    const flush = () => {
      const pending = latest.current;
      if (pending === saved.current) return;
      saved.current = pending;

      void apiRequest<void>(`/exercises/attempts/${attemptId}/draft`, {
        method: 'PUT',
        body: { code: pending },
        keepalive: true,
      }).catch(() => {
        saved.current = null;
      });
    };

    // pagehide rather than beforeunload: beforeunload does not fire reliably
    // on mobile, where backgrounding an app is how tabs usually end.
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);

    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [attemptId, enabled]);

  return state;
}
