import { useNavigate } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import { Button, Card } from '~/components/ui';
import { usePractice, useNextUp } from '~/lib/queries';

/**
 * What to do next, once this concept is finished.
 *
 * Offered, never taken. Navigating automatically moves the page out from
 * under someone who may still be reading the explanation they just earned,
 * and the click is also what makes it obvious that the last thing actually
 * completed — which is the feedback the old "press Done yourself" flow
 * destroyed by asking for it in advance.
 *
 * Today's plan first, then the course. The order comes from the server,
 * because it is the same order the routine itself is in.
 */
export function NextUp({ conceptId }: { conceptId: string | undefined }) {
  const navigate = useNavigate();

  // Only asked once the concept is done: a half-finished page has no business
  // suggesting what comes after it.
  const { data: practice } = usePractice(conceptId, false);
  const finished = practice?.completion.complete ?? false;

  const { data: next } = useNextUp(conceptId, finished);

  if (!finished || !next) return null;

  const go = () => {
    if (next.exerciseId) {
      navigate(`${next.kind === 'PROJECT' ? '/project' : '/exercise'}/${next.exerciseId}`);
    } else if (next.conceptId) {
      navigate(`/concept/${next.conceptId}`);
    } else {
      navigate('/routine');
    }
  };

  return (
    <Card style={{ borderLeft: '2px solid var(--success)' }}>
      <div className="row items-center justify-between g4">
        <div className="row items-start g3" style={{ minWidth: 0 }}>
          <span style={{ color: 'var(--success)', marginTop: 2 }}>
            <Icon name="check" size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div className="t-caption">
              {next.source === 'routine' ? 'Next in today’s routine' : 'Next in the course'}
            </div>
            <div className="t-h4">{next.title}</div>
            <div className="t-small mt1">{next.rationale}</div>
          </div>
        </div>

        <Button icon="arrowRight" onClick={go} style={{ flexShrink: 0 }}>
          Open
        </Button>
      </div>
    </Card>
  );
}
