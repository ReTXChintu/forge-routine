import { Icon } from '~/components/Icon';
import { Button, Card, ProgressBar } from '~/components/ui';
import { useGenerationStatus, useRetryGeneration } from '~/lib/queries';

/**
 * What is still being built, and what is already usable.
 *
 * Curriculum is generated one technology at a time, on demand. This says
 * which one is running and what is waiting — PENDING is the plan, not the
 * work, and costs nothing, so it is reported as waiting rather than as
 * activity.
 */
export function GenerationBanner() {
  const { data } = useGenerationStatus();
  const retry = useRetryGeneration();

  if (!data) return null;

  const running = data.jobs.filter((job) => job.status === 'RUNNING' || job.status === 'QUEUED');
  const waiting = data.jobs.filter((job) => job.status === 'PENDING');
  const failed = data.jobs.filter((job) => job.status === 'FAILED');

  if (running.length === 0 && failed.length === 0 && waiting.length === 0) return null;

  return (
    <div className="col g2 mb6">
      {running.length > 0 && (
        <Card style={{ borderColor: 'var(--primary-border)' }}>
          <div className="row items-center g2 mb2">
            <Icon name="zap" size={15} />
            <span className="t-h4">
              Preparing {running.length === 1 ? '1 technology' : `${running.length} technologies`}
            </span>
          </div>

          {/* Says what is usable now, not just what is missing. */}
          <div className="t-small mb3">
            This runs in the background and takes a few minutes. Anything already prepared is ready
            to start — come back shortly for the rest.
          </div>

          <div className="col g3">
            {running.map((job) => (
              <div key={job.id}>
                <div className="row justify-between mb1">
                  <span className="t-caption">{job.technologyName ?? 'Technology'}</span>
                  <span className="t-code" style={{ fontSize: 11.5 }}>
                    {job.status === 'QUEUED' ? 'queued' : `${job.progress}%`}
                  </span>
                </div>
                <ProgressBar pct={job.status === 'QUEUED' ? 0 : job.progress} thin />
                {job.step && <div className="t-caption mt1">{job.step}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {waiting.length > 0 && (
        <div className="row items-center g2 px3">
          <Icon name="clock" size={12} />
          <span className="t-caption">
            {waiting.length} more in the plan. Each is built when you are far enough through the
            last — nothing is generated, or billed, before then.
          </span>
        </div>
      )}

      {failed.map((job) => (
        <Card key={job.id} style={{ borderLeft: '2px solid var(--warning)' }}>
          <div className="row items-start justify-between g4">
            <div className="row items-start g3" style={{ minWidth: 0 }}>
              <span style={{ color: 'var(--warning)', marginTop: 2 }}>
                <Icon name="alert" size={15} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div className="t-h4">
                  {job.technologyName ?? 'A technology'} could not be prepared
                </div>
                {/* The real reason, not a generic apology. */}
                <div className="t-small mt1">{job.error ?? 'Generation failed.'}</div>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => retry.mutate()}
              disabled={retry.isPending}
            >
              Try again
            </Button>
          </div>
        </Card>
      ))}

      {data.partial && (
        <div className="row items-center g2 px3">
          <span style={{ color: 'var(--success)' }}>
            <Icon name="check" size={12} />
          </span>
          <span className="t-caption">Some technologies are ready — you can start those now.</span>
        </div>
      )}
    </div>
  );
}
