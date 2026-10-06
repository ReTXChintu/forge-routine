import type { PauseReason } from '~/lib/useLearningSession';

import { Icon } from './Icon';

/**
 * The running clock for a concept or a workspace.
 *
 * Shown rather than hidden because the number it feeds — minutes practised
 * today — is one the product asks the user to trust. A timer that counts in
 * secret is one nobody can check.
 *
 * Seconds tick, because a clock that only moves once a minute reads as broken
 * for the whole first minute — which is exactly how this was reported. And a
 * pause says *why*: "paused" alone leaves the reader guessing whether the
 * timer has failed or they have.
 */
export function SessionClock({
  durationMs,
  counting,
  pausedBecause = null,
}: {
  durationMs: number;
  counting: boolean;
  pausedBecause?: PauseReason;
}) {
  return (
    <span
      className="t-caption row items-center g1 mono"
      title={counting ? 'Counting the time you spend here' : describe(pausedBecause)}
      style={{ color: counting ? 'var(--text-muted)' : 'var(--warning)' }}
    >
      <Icon name="clock" size={12} />
      {format(durationMs)}
      {!counting && <span style={{ fontFamily: 'var(--font-ui)' }}> · {label(pausedBecause)}</span>}
    </span>
  );
}

/** "0:42", "12:05", "1:02:09". */
function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
}

function label(reason: PauseReason): string {
  switch (reason) {
    case 'idle':
      return 'paused, inactive';
    case 'hidden':
    case 'unfocused':
      return 'paused, away';
    default:
      return 'paused';
  }
}

function describe(reason: PauseReason): string {
  switch (reason) {
    case 'idle':
      return 'Paused after two minutes with nothing touched. Press a key, click or scroll to resume.';
    case 'hidden':
      return 'Paused while this tab is hidden or minimised.';
    case 'unfocused':
      return 'Paused while another window has focus. Click back here to resume.';
    default:
      return 'Paused';
  }
}
