import { Navigate, useNavigate } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import {
  Badge,
  Button,
  Card,
  ProgressBar,
  SectionHead,
  Spinner,
  type BadgeVariant,
} from '~/components/ui';
import {
  useRegenerateRoadmap,
  useRoadmap,
  useUpdateRoadmapItem,
  type RoadmapItemView,
} from '~/lib/queries';

import { GenerationBanner } from './GenerationBanner';

/**
 * The whole journey, visible at once (docs/learning-path.md).
 *
 * Full width, phases as cards down the page with their items in a grid. The
 * design job is making a long path feel finite: twelve weeks of work has to
 * read as a handful of steps rather than a wall.
 */

const KIND_LABEL: Record<string, string> = {
  LEARN: 'Read',
  RECALL: 'Recall',
  CODE: 'Write',
  BLIND_CODE: 'Blind',
  DEBUG: 'Debug',
  EXPLAIN: 'Explain',
  PROJECT: 'Project',
  CHECKPOINT: 'Checkpoint',
  INTERVIEW: 'Interview',
};

const KIND_ICON: Record<string, string> = {
  LEARN: 'learn',
  RECALL: 'brain',
  CODE: 'practice',
  BLIND_CODE: 'eye',
  DEBUG: 'bug',
  EXPLAIN: 'interview',
  PROJECT: 'layers',
  CHECKPOINT: 'target',
  INTERVIEW: 'interview',
};

export function RoadmapPage() {
  const { data: roadmap, isLoading } = useRoadmap();
  const regenerate = useRegenerateRoadmap();
  const updateItem = useUpdateRoadmapItem();
  const navigate = useNavigate();

  if (isLoading) return <Spinner label="Loading your roadmap" />;

  // No roadmap means onboarding was never completed.
  if (!roadmap) return <Navigate to="/onboarding" replace />;

  const percent =
    roadmap.totalMinutes > 0 ? (roadmap.completedMinutes / roadmap.totalMinutes) * 100 : 0;

  const currentPhaseIndex = roadmap.phases.findIndex((phase) =>
    phase.items.some((item) => item.id === roadmap.currentItemId),
  );

  const open = (item: RoadmapItemView) => {
    if (item.exerciseId) {
      navigate(`${item.kind === 'PROJECT' ? '/project' : '/exercise'}/${item.exerciseId}`);
    } else if (item.conceptId) {
      navigate(`/concept/${item.conceptId}`);
    }
  };

  return (
    <>
      <SectionHead
        eyebrow="Learn"
        title="Your roadmap"
        description={`${roadmap.phases.length} phases · ${formatHours(roadmap.totalMinutes)} total${
          roadmap.generatedBy === 'rules' ? ' · planned from your knowledge graph' : ''
        }`}
        right={
          <Button
            variant="secondary"
            icon="refresh"
            onClick={() => regenerate.mutate()}
            disabled={regenerate.isPending}
          >
            {regenerate.isPending ? 'Replanning…' : 'Replan'}
          </Button>
        }
      />

      <div className="row items-center g3 mb6">
        <div style={{ flex: 1 }}>
          <ProgressBar pct={percent} />
        </div>
        <span className="t-code" style={{ fontWeight: 700 }}>
          {Math.round(percent)}%
        </span>
      </div>

      <GenerationBanner />

      <div className="col g4">
        {roadmap.phases.map((phase, index) => {
          const isCurrent = index === currentPhaseIndex;
          const isDone = phase.items.length > 0 && phase.doneCount === phase.items.length;

          return (
            <Card
              key={phase.id}
              style={{ borderColor: isCurrent ? 'var(--primary-border)' : undefined }}
            >
              <div className="row justify-between items-start mb4 g4 wrap">
                <div className="row items-start g3" style={{ minWidth: 0 }}>
                  <PhaseMarker index={index} done={isDone} current={isCurrent} />
                  <div style={{ minWidth: 0 }}>
                    <div className="row items-center g2">
                      <span className="t-h3">{phase.title}</span>
                      {isCurrent && <Badge variant="primary">Now</Badge>}
                      {isDone && <Badge variant="success">Done</Badge>}
                    </div>
                    <div className="t-small mt1">{phase.goal}</div>
                  </div>
                </div>

                <div className="t-caption" style={{ flexShrink: 0 }}>
                  {phase.doneCount}/{phase.items.length} · {formatHours(phase.estimatedMinutes)}
                </div>
              </div>

              <div className="grid grid-3 g3 cq-grid-3">
                {phase.items.map((item) => (
                  <RoadmapItem
                    key={item.id}
                    item={item}
                    onOpen={() => open(item)}
                    onToggle={() =>
                      updateItem.mutate({
                        id: item.id,
                        status: item.status === 'DONE' ? 'PENDING' : 'DONE',
                      })
                    }
                  />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function RoadmapItem({
  item,
  onOpen,
  onToggle,
}: {
  item: RoadmapItemView;
  onOpen: () => void;
  onToggle: () => void;
}) {
  const done = item.status === 'DONE';
  const openable = Boolean(item.exerciseId || item.conceptId);

  const variant: BadgeVariant =
    item.kind === 'PROJECT' ? 'primary' : item.kind === 'INTERVIEW' ? 'info' : 'neutral';

  return (
    <div
      className="card p3"
      style={{
        background: 'var(--surface-2)',
        opacity: done ? 0.6 : 1,
        cursor: openable ? 'pointer' : 'default',
      }}
      onClick={openable ? onOpen : undefined}
    >
      <div className="row justify-between items-center mb2">
        <Badge variant={variant} icon={KIND_ICON[item.kind] ?? 'practice'}>
          {KIND_LABEL[item.kind] ?? item.kind}
        </Badge>
        <button
          type="button"
          className="icon-btn"
          style={{ width: 24, height: 24, color: done ? 'var(--success)' : 'var(--text-muted)' }}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          title={done ? 'Mark as not done' : 'Mark as done'}
        >
          <Icon name="check" size={14} />
        </button>
      </div>

      <div
        className="t-h4"
        style={{ fontSize: 13, textDecoration: done ? 'line-through' : undefined }}
      >
        {item.title}
      </div>

      {/* Always shown. A plan you cannot interrogate is a plan you follow on
          faith, and this one is generated. */}
      <div className="t-caption mt1">{item.rationale}</div>
      <div className="t-caption mt2">{item.estimatedMinutes} min</div>
    </div>
  );
}

function PhaseMarker({ index, done, current }: { index: number; done: boolean; current: boolean }) {
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 99,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 13,
        background: done
          ? 'var(--success-subtle)'
          : current
            ? 'var(--primary-subtle)'
            : 'var(--surface-2)',
        color: done ? 'var(--success)' : current ? 'var(--primary)' : 'var(--text-muted)',
        border: current ? '2px solid var(--primary)' : '1px solid var(--border)',
      }}
    >
      {done ? <Icon name="check" size={15} /> : index + 1}
    </div>
  );
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}
