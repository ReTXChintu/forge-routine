import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import {
  Badge,
  Button,
  Card,
  SectionHead,
  Spinner,
  StatRow,
  StateBlock,
  Tabs,
} from '~/components/ui';
import { useConceptDetail, useExercises } from '~/lib/queries';

import { ConceptChat } from './ConceptChat';
import { ConceptExplainer } from './ConceptExplainer';

/**
 * One concept: what it covers, what blocks it, and what to practise.
 *
 * Full width, three columns — the material on the left, the skill model and
 * prerequisites on the right. A locked concept says exactly what is in the
 * way, by name; "complete a prerequisite" is not something anyone can act
 * on.
 */

const KIND_ICON: Record<string, string> = {
  CODING: 'practice',
  RECALL: 'brain',
  DEBUGGING: 'bug',
  BLIND_CODING: 'eye',
  EXPLANATION: 'interview',
  PROJECT: 'layers',
};

const TABS = ['Understand', 'Ask', 'Practise'] as const;

export function ConceptView() {
  const { conceptId } = useParams<{ conceptId: string }>();
  const [tab, setTab] = useState<string>(TABS[0]);
  const { data: concept, isLoading } = useConceptDetail(conceptId);
  const { data: exercises } = useExercises(conceptId);
  const navigate = useNavigate();

  if (isLoading) return <Spinner label="Loading concept" />;

  if (!concept) {
    return <StateBlock icon="alert" title="This concept could not be loaded" />;
  }

  const locked = !concept.readiness.unlocked;
  const blocking = concept.prerequisites.filter((p) =>
    concept.readiness.blockingConceptIds.includes(p.conceptId),
  );

  return (
    <>
      <div className="breadcrumbs mb4">
        <a onClick={() => navigate('/technologies')} style={{ cursor: 'pointer' }}>
          Technologies
        </a>
        <Icon name="chevronRight" size={12} />
        <a
          onClick={() => navigate(`/technology/${concept.technologyId}`)}
          style={{ cursor: 'pointer' }}
        >
          {concept.technologyName}
        </a>
        <Icon name="chevronRight" size={12} />
        <span className="current">{concept.name}</span>
      </div>

      <SectionHead
        eyebrow={concept.technologyName}
        title={concept.name}
        description={concept.description}
        right={
          <Badge variant={concept.difficulty >= 4 ? 'warning' : 'neutral'}>
            Level {concept.difficulty}
          </Badge>
        }
      />

      {locked && (
        <Card className="mb6" style={{ borderLeft: '2px solid var(--warning)' }}>
          <div className="row items-start g3">
            <span style={{ color: 'var(--warning)', marginTop: 2 }}>
              <Icon name="lock" size={16} />
            </span>
            <div>
              <div className="t-h4">Locked</div>
              {/* Named, not described. "A prerequisite" is not actionable. */}
              <div className="t-small mt1">
                {blocking.length > 0
                  ? `Finish ${blocking.map((p) => p.name).join(', ')} first.`
                  : 'Finish the concept before this one in the course first.'}
              </div>
            </div>
          </div>
        </Card>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} className="mb5" />

      {tab === 'Understand' && <ConceptExplainer conceptId={conceptId} concept={concept} />}

      {tab === 'Ask' && <ConceptChat conceptId={conceptId} conceptName={concept.name} />}

      {tab === 'Practise' && (
        <div className="grid grid-3 g5 cq-grid-3">
          <div className="col g5" style={{ gridColumn: 'span 2' }}>
            {concept.learningObjectives.length > 0 && (
              <Card>
                <div className="t-h3 mb3">What you should be able to do</div>
                <div className="col g2">
                  {concept.learningObjectives.map((objective) => (
                    <div key={objective} className="row items-start g2">
                      <span style={{ color: 'var(--success)', marginTop: 3 }}>
                        <Icon name="check" size={13} />
                      </span>
                      <span className="t-body">{objective}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {concept.commonMistakes.length > 0 && (
              <Card>
                <div className="t-h3 mb3">Where people go wrong</div>
                <div className="col g2">
                  {concept.commonMistakes.map((mistake) => (
                    <div key={mistake} className="row items-start g2">
                      <span style={{ color: 'var(--warning)', marginTop: 3 }}>
                        <Icon name="alert" size={13} />
                      </span>
                      <span className="t-body">{mistake}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card>
              <div className="t-h3 mb3">Practice</div>

              {(exercises ?? []).length === 0 ? (
                <div className="t-small">
                  No exercises for this concept. Some subjects cannot be graded by running
                  JavaScript — those get concept questions instead.
                </div>
              ) : (
                <div className="grid grid-2 g3 cq-grid-2">
                  {(exercises ?? []).map((exercise) => (
                    <div
                      key={exercise.id}
                      className="card p3"
                      style={{
                        background: 'var(--surface-2)',
                        cursor: locked ? 'not-allowed' : 'pointer',
                        opacity: locked ? 0.5 : 1,
                      }}
                      onClick={() => !locked && navigate(`/exercise/${exercise.id}`)}
                    >
                      <div className="row justify-between items-center mb2">
                        <Badge variant="neutral" icon={KIND_ICON[exercise.kind] ?? 'practice'}>
                          {exercise.kind.toLowerCase().replace('_', ' ')}
                        </Badge>
                        <span className="t-caption">{exercise.estimatedMinutes} min</span>
                      </div>
                      <div className="t-h4" style={{ fontSize: 13 }}>
                        {exercise.title}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="col g5">
            <Card>
              <div className="t-h3 mb3">Your skill here</div>

              {concept.skill ? (
                <div className="col g1">
                  {Object.entries(concept.skill)
                    .filter(([key]) => key !== 'assistanceLevel' && key !== 'attempts')
                    .map(([key, value]) => (
                      <StatRow key={key} label={humanise(key)} pct={Number(value) * 100} />
                    ))}
                </div>
              ) : (
                <div className="t-small">
                  Nothing measured yet. This fills in from what you actually write, not from what
                  you read.
                </div>
              )}
            </Card>

            {concept.prerequisites.length > 0 && (
              <Card>
                <div className="t-h3 mb3">Depends on</div>
                <div className="col g2">
                  {concept.prerequisites.map((prereq) => (
                    <div
                      key={prereq.conceptId}
                      className="row items-center justify-between g2"
                      style={{ cursor: 'pointer' }}
                      onClick={() => navigate(`/concept/${prereq.conceptId}`)}
                    >
                      <span className="t-small">{prereq.name}</span>
                      <Badge variant={prereq.strength === 'HARD' ? 'warning' : 'neutral'}>
                        {prereq.strength === 'HARD' ? 'required' : 'helps'}
                      </Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {!locked && (exercises ?? []).length > 0 && (
              <Button block icon="play" onClick={() => navigate(`/exercise/${exercises![0]!.id}`)}>
                Start practising
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}
