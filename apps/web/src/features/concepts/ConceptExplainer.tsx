import { CodeBlock } from '~/components/CodeBlock';
import { Markdown } from '~/components/Markdown';
import { AiTag, Card, Spinner } from '~/components/ui';
import { useConceptExplainer } from '~/lib/queries';

/**
 * The written explanation of a concept: what it is, where it shows up, and
 * what people get wrong.
 *
 * Written once by a model and then shared by everyone, so the first person
 * to open a concept waits and nobody after them does. Marked as AI-written,
 * because the product's claim is that the reader always knows which
 * sentences a model produced.
 *
 * This is the one place code is shown freely. Explaining a closure without
 * showing one is a riddle, and nothing here is the reader's exercise.
 */
export function ConceptExplainer({
  conceptId,
  concept,
}: {
  conceptId: string | undefined;
  concept: { name: string; description: string; commonMistakes: string[] };
}) {
  const { data: explainer, isLoading, error } = useConceptExplainer(conceptId);

  if (isLoading) {
    return <Spinner label="Writing the explanation — this happens once per concept" />;
  }

  // Degraded, not empty. The seed material is still worth reading, and a
  // blank page would suggest the concept itself has nothing in it.
  if (error || !explainer?.available) {
    return (
      <Card>
        <div className="t-h3 mb2">{concept.name}</div>
        <div className="t-body mb4">{concept.description}</div>

        {concept.commonMistakes.length > 0 && (
          <>
            <div className="t-caption mb2">WATCH FOR</div>
            <div className="col g2 mb4">
              {concept.commonMistakes.map((mistake) => (
                <div key={mistake} className="t-small">
                  · {mistake}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="t-caption">
          {explainer?.unavailableReason ??
            (error as Error | undefined)?.message ??
            'The written explanation is not available.'}
        </div>
      </Card>
    );
  }

  return (
    <div className="col g4">
      <Card>
        <AiTag>Explanation</AiTag>
        <div className="mt3">
          <Markdown content={explainer.summary} />
        </div>
      </Card>

      <Card>
        <div className="t-h4 mb2">Where this shows up</div>
        <Markdown content={explainer.realWorld} />
      </Card>

      {explainer.examples.length > 0 && (
        <Card>
          <div className="t-h4 mb3">Examples</div>
          <div className="col g3">
            {explainer.examples.map((example, index) => (
              <div key={index} className="row items-start g3">
                <span className="t-code" style={{ color: 'var(--primary)', fontWeight: 700 }}>
                  {index + 1}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <Markdown content={example} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {explainer.codeExample && (
        <Card>
          <div className="t-h4 mb3">In code</div>
          <CodeBlock code={explainer.codeExample} language={explainer.codeLanguage} />
        </Card>
      )}

      {explainer.docsUrl && (
        <Card>
          <div className="row items-center justify-between g3 wrap">
            <div>
              <div className="t-h4">The official documentation</div>
              {/* Offered, not summarised. The reference is more complete
                  than this page will ever be and does not go stale. */}
              <div className="t-small mt1">
                Worth reading once this makes sense — it is the complete version.
              </div>
            </div>
            <a
              className="btn btn-secondary btn-sm"
              href={explainer.docsUrl}
              target="_blank"
              rel="noreferrer"
            >
              Open docs ↗
            </a>
          </div>
        </Card>
      )}

      {explainer.pitfalls.length > 0 && (
        <Card style={{ borderLeft: '2px solid var(--warning)' }}>
          <div className="t-h4 mb3">What goes wrong</div>
          <div className="col g2">
            {explainer.pitfalls.map((pitfall) => (
              <div key={pitfall} className="t-small">
                · {pitfall}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
