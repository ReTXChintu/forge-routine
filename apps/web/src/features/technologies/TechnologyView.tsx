import { useNavigate, useParams } from 'react-router-dom';

import { Icon } from '~/components/Icon';
import { Badge, Card, SectionHead, Spinner, StateBlock } from '~/components/ui';
import { useConcepts } from '~/lib/queries';

/**
 * Concepts for one technology, in learning order.
 *
 * The order is the curriculum: a course runs basics to advanced and the
 * next concept opens only when the one before it is cleared. The numbering
 * is not decoration — it is the sequence the user is held to.
 */
export function TechnologyView() {
  const { technologyId } = useParams<{ technologyId: string }>();
  const { data: concepts, isLoading } = useConcepts(technologyId);
  const navigate = useNavigate();

  if (isLoading) return <Spinner label="Loading concepts" />;

  const list = concepts ?? [];

  return (
    <>
      <div className="breadcrumbs mb4">
        <a onClick={() => navigate('/technologies')} style={{ cursor: 'pointer' }}>
          Technologies
        </a>
        <Icon name="chevronRight" size={12} />
        <span className="current">Concepts</span>
      </div>

      <SectionHead
        title="Concepts"
        description={
          list.length > 0
            ? `${list.length} concepts, basics first. Each opens when the one before it is cleared.`
            : undefined
        }
      />

      {list.length === 0 ? (
        <StateBlock
          icon="clock"
          title="Not built yet"
          body="This technology's curriculum is generated when you are far enough through the one before it. Nothing is generated, or billed, before then."
        />
      ) : (
        <div className="grid grid-3 g3 cq-grid-3">
          {list.map((concept, index) => (
            <Card key={concept.id} hover onClick={() => navigate(`/concept/${concept.id}`)}>
              <div className="row justify-between items-center mb2">
                <span className="t-code" style={{ color: 'var(--text-muted)' }}>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <Badge variant={concept.difficulty >= 4 ? 'warning' : 'neutral'}>
                  L{concept.difficulty}
                </Badge>
              </div>

              <div className="t-h4">{concept.name}</div>
              <div className="t-caption mt1" style={{ lineHeight: 1.5 }}>
                {concept.description}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
