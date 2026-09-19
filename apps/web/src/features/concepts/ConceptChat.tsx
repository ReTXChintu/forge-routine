import { useEffect, useRef, useState } from 'react';

import { Icon } from '~/components/Icon';
import { AiTag, Button, Card, Spinner } from '~/components/ui';
import { useAskConcept, useConceptChat } from '~/lib/queries';

/**
 * Doubt-clearing chat about one concept.
 *
 * It is given this user's record before it answers — what they have
 * cleared, what they are shaky on, the errors from their recent failed
 * submissions — so the reply is about their actual gap rather than the
 * concept in the abstract.
 *
 * It will not write the exercise they have open. That is enforced on the
 * server rather than asked for here, because a rule that lives only in a
 * prompt is a suggestion.
 */
export function ConceptChat({
  conceptId,
  conceptName,
}: {
  conceptId: string | undefined;
  conceptName: string;
}) {
  const [question, setQuestion] = useState('');
  const { data: messages, isLoading } = useConceptChat(conceptId, true);
  const ask = useAskConcept(conceptId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages?.length, ask.isPending]);

  const send = () => {
    const text = question.trim();
    if (text.length === 0) return;

    // Cleared only once the answer is in. A transient "model is busy" used
    // to cost the user what they had typed, which is the one thing a
    // failure here must not do.
    ask.mutate(text, { onSuccess: () => setQuestion('') });
  };

  if (isLoading) return <Spinner label="Loading your questions" />;

  const empty = !messages || messages.length === 0;

  return (
    <Card className="col" style={{ minHeight: 420 }}>
      <div className="row items-center justify-between mb3">
        <AiTag>Tutor</AiTag>
        <span className="t-caption">It knows what you have already practised</span>
      </div>

      <div className="divider mb3" />

      <div className="col g4 flex-1 scroll-y" style={{ maxHeight: 480 }}>
        {empty && (
          <div className="t-small">
            Ask anything about {conceptName} — why it works the way it does, how it differs from
            something you already know, or what your last error actually meant. It will not write
            your exercise for you.
          </div>
        )}

        {messages?.map((message) => (
          <div key={message.id} className="row items-start g3">
            <span
              style={{
                width: 26,
                height: 26,
                borderRadius: 8,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: message.role === 'user' ? 'var(--surface-2)' : 'var(--primary-subtle)',
                color: message.role === 'user' ? 'var(--text-secondary)' : 'var(--primary)',
              }}
            >
              <Icon name={message.role === 'user' ? 'name' : 'zap'} size={13} />
            </span>

            <div
              className="t-body"
              style={{
                whiteSpace: 'pre-wrap',
                color: message.role === 'user' ? 'var(--text-secondary)' : 'var(--text-primary)',
                minWidth: 0,
              }}
            >
              {message.content}
            </div>
          </div>
        ))}

        {ask.isPending && (
          <div className="row items-center g2 t-caption">
            <Icon name="refresh" size={13} /> Thinking…
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="divider mt3 mb3" />

      <div className="col g2">
        <textarea
          className="textarea"
          rows={3}
          value={question}
          placeholder={`Ask about ${conceptName}…`}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter makes a newline. A question worth asking is often two
            // sentences, and submitting on Enter cuts people off.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) send();
          }}
        />

        <div className="row items-center justify-between g3">
          <span className="t-caption">
            <span className="kbd">⌘↵</span> to send
          </span>
          <Button
            size="sm"
            icon="send"
            onClick={send}
            disabled={question.trim().length === 0 || ask.isPending}
          >
            Ask
          </Button>
        </div>

        {ask.isError && (
          <div className="row items-start g2">
            <span style={{ color: 'var(--error)', marginTop: 1 }}>
              <Icon name="alert" size={13} />
            </span>
            <div>
              <div className="t-caption" style={{ color: 'var(--error)' }}>
                {(ask.error as Error).message}
              </div>
              {/* Your question is still in the box. Say so, rather than
                  leaving them wondering whether to retype it. */}
              <div className="t-caption mt1">Your question is still here — press Ask again.</div>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
