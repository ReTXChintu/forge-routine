import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { Assistant } from '~/components/Assistant';
import { Icon } from '~/components/Icon';
import { Badge, Card, SectionHead, Spinner, StatRow, StateBlock, Tabs } from '~/components/ui';
import { useConceptDetail } from '~/lib/queries';

import { ConceptExplainer } from './ConceptExplainer';
import { ConceptPractice } from './ConceptPractice';
import { NextUp } from './NextUp';

/**
 * One concept: read it, then be tested on it.
 *
 * Two tabs, not three. Asking questions used to be a third — which meant
 * leaving the thing you had a question about in order to ask about it. It is
 * now the assistant in the corner, which stays beside whichever tab is open
 * and is told what that tab currently shows.
 *
 * A locked concept says exactly what is in the way, by name; "complete a
 * prerequisite" is not something anyone can act on.
 */

const TABS = ['Learn', 'Practice'] as const;

export function ConceptView() {
  const { conceptId } = useParams<{ conceptId: string }>();
  const [tab, setTab] = useState<string>(TABS[0]);
  const { data: concept, isLoading } = useConceptDetail(conceptId);
  const navigate = useNavigate();

  /**
   * What the assistant can see: this tab, and nothing else.
   *
   * Cleared when the tab changes, so it can never answer about a screen the
   * user has already left.
   */
  const [screen, setScreen] = useState<string | null>(null);
  const changeTab = (next: string) => {
    setScreen(null);
    setTab(next);
  };

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

      <Tabs tabs={TABS} active={tab} onChange={changeTab} className="mb5" />

      {tab === 'Learn' && (
        <>
          <ConceptExplainer conceptId={conceptId} concept={concept} onScreenText={setScreen} />
          {/* Offered from Learn too: someone who already knows a concept
              should be able to move on without working through it. */}
          <div className="mt5">
            <NextUp conceptId={conceptId} />
          </div>
        </>
      )}

      {tab === 'Practice' && (
        <div className="grid grid-3 g5 cq-grid-3">
          <div className="col g5" style={{ gridColumn: 'span 2' }}>
            <ConceptPractice
              conceptId={conceptId}
              conceptName={concept.name}
              locked={locked}
              onScreenText={setScreen}
            />

            <NextUp conceptId={conceptId} />
          </div>

          <div className="col g5">
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
          </div>
        </div>
      )}

      {/* Outside the tabs, so it survives switching between them — and told
          only what the open tab describes of itself. */}
      <Assistant conceptId={conceptId} conceptName={concept.name} screen={screen} />
    </>
  );
}

function humanise(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}
