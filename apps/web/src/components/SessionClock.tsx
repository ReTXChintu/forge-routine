import { Icon } from './Icon';

/**
 * The running clock for a workspace.
 *
 * Shown rather than hidden because the number it feeds — minutes practised
 * today — is one the product asks the user to trust. A timer that counts
 * in secret is one nobody can check, and the first time it disagreed with
 * them they would stop believing the dashboard.
 *
 * Pausing is visible for the same reason. Thinking with your hands still
 * is real work, and this keeps counting through it; but once it does give
 * up, it says so rather than quietly stopping.
 */
export function SessionClock({ durationMs, counting }: { durationMs: number; counting: boolean }) {
  const minutes = Math.floor(durationMs / 60_000);

  return (
    <span
      className="t-caption row items-center g1"
      title={counting ? 'Counting the time you spend here' : 'Paused — no activity'}
      style={{ color: counting ? 'var(--text-muted)' : 'var(--warning)' }}
    >
      <Icon name="clock" size={12} />
      {minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`}
      {!counting && ' · paused'}
    </span>
  );
}
