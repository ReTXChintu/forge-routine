import { useNavigate } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import { Badge, Card, SectionHead, Spinner, StateBlock } from '~/components/ui';
import { useChallenges, type ChallengeKind, type ChallengeSummary } from '~/lib/queries';

/**
 * Engineering challenges (§18-19).
 *
 * The three things a senior interview always reaches that a coding drill
 * cannot test: can you design a system, can you diagnose an outage, can you
 * operate a machine. None of them is graded by running your code.
 *
 * Full width: each kind is a grid that grows with the window rather than a
 * list pinned to a column.
 */

const KIND_LABEL: Record<ChallengeKind, string> = {
  SYSTEM_DESIGN: 'Design',
  INCIDENT: 'Incident',
  TERMINAL: 'Terminal',
};

const KIND_BLURB: Record<ChallengeKind, string> = {
  SYSTEM_DESIGN: 'Write the design. A reviewer names the gaps and leaves you to close them.',
  INCIDENT: 'Diagnose an outage from its telemetry. The cause is withheld until you commit.',
  TERMINAL: 'A simulated shell with a real task. Graded on the end state, not the commands.',
};

const KIND_ICON: Record<ChallengeKind, string> = {
  SYSTEM_DESIGN: 'layers',
  INCIDENT: 'alert',
  TERMINAL: 'monitor',
};

const GROUPS: ChallengeKind[] = ['SYSTEM_DESIGN', 'INCIDENT', 'TERMINAL'];

export function ChallengeList() {
  const { data: challenges, isLoading } = useChallenges();
  const navigate = useNavigate();

  if (isLoading) return <Spinner label="Loading challenges" />;

  return (
    <>
      <SectionHead
        eyebrow="Engineering"
        title="Challenges"
        description="The parts of the job a coding exercise cannot reach."
      />

      {(!challenges || challenges.length === 0) && (
        <StateBlock
          icon="layers"
          title="Nothing here yet"
          body="Challenges appear for the technologies you have taken on."
        />
      )}

      {GROUPS.map((kind) => {
        const inGroup = challenges?.filter((challenge) => challenge.kind === kind) ?? [];
        if (inGroup.length === 0) return null;

        return (
          <div key={kind} className="mb7">
            <div className="row items-center g2 mb1">
              <Icon name={KIND_ICON[kind]} size={15} />
              <span className="t-h3">{KIND_LABEL[kind]}</span>
            </div>
            <div className="t-small mb4">{KIND_BLURB[kind]}</div>

            <div className="grid grid-3 g3 cq-grid-3">
              {inGroup.map((challenge) => (
                <ChallengeCard
                  key={challenge.exerciseId}
                  challenge={challenge}
                  onOpen={() => navigate(`/challenge/${challenge.exerciseId}`)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ChallengeCard({ challenge, onOpen }: { challenge: ChallengeSummary; onOpen: () => void }) {
  return (
    <Card hover onClick={onOpen}>
      <div className="row items-start justify-between g2 mb2">
        <span className="t-h4">{challenge.title}</span>
        {challenge.completed && (
          <span style={{ color: 'var(--success)', flexShrink: 0, lineHeight: 0 }}>
            <Icon name="check" size={15} />
          </span>
        )}
      </div>

      <div className="t-small mb3">{challenge.objective}</div>

      <div className="row items-center justify-between g2 wrap">
        <Badge variant="neutral">{challenge.technologyName}</Badge>
        <span className="t-caption">
          {challenge.estimatedMinutes}m · difficulty {challenge.difficulty}
        </span>
      </div>
    </Card>
  );
}
