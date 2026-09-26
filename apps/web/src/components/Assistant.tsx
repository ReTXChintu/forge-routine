import { useEffect, useRef, useState } from 'react';

import { Icon } from '~/components/Icon';
import { Markdown } from '~/components/Markdown';
import { AiTag, Button, Spinner } from '~/components/ui';
import { ApiError } from '~/lib/api';
import { useAskConcept, useConceptChat } from '~/lib/queries';

/**
 * The assistant, sitting in the corner of whatever you are working on.
 *
 * It used to be a tab, which meant leaving the thing you had a question
 * about in order to ask about it. Now it is a button that opens a panel
 * beside your work, and it is handed a description of what is actually on
 * screen — the concept you are reading, the question you clicked, the code
 * you have written — so "why is this wrong" is answerable.
 *
 * **It reads. It never writes.** It cannot type into the editor, change an
 * answer, or do anything in the app; it has no mechanism to, and that is
 * deliberate rather than merely unimplemented. It will name what is wrong
 * and which idea fixes it — "this rescans the array; a hash map makes the
 * lookup constant" — and stop there. Naming the approach is teaching;
 * writing the code that applies it is doing the work, and the difference is
 * the whole product. The refusal is enforced on the server too, because a
 * rule that lives only in a prompt is a suggestion.
 *
 * What it is shown is context, not instruction — the server says so to the
 * model, since screen text can contain anything the curriculum happens to
 * hold.
 */
export function Assistant({
  conceptId,
  conceptName,
  screen,
}: {
  conceptId: string | undefined;
  conceptName: string;
  /**
   * What the open tab can say about itself, rebuilt as the user moves. Null
   * when there is nothing worth sending.
   */
  screen: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const { data: messages, isLoading } = useConceptChat(conceptId, open);
  const ask = useAskConcept(conceptId);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Guarded rather than called straight. An effect that throws unmounts the
    // subtree, so an absent or refused scrollIntoView would take the whole
    // panel down — the reply arrives, the spinner clears, and nothing is on
    // screen. Not a hypothetical: it is missing in jsdom entirely, and
    // convenience APIs going absent in environments this app actually runs in
    // is the same trap that `lib/browser.ts` exists for.
    const bottom = bottomRef.current;
    if (typeof bottom?.scrollIntoView !== 'function') return;

    try {
      bottom.scrollIntoView({ behavior: 'smooth', block: 'end' });
    } catch {
      // Scrolling is a convenience. Losing the answer over it is not.
    }
  }, [open, messages?.length, ask.isPending]);

  // Escape closes it, like every other panel that covers your work.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const send = () => {
    const text = question.trim();
    if (text.length === 0) return;

    setFailure(null);
    ask.mutate(
      { question: text, ...(screen ? { screen } : {}) },
      {
        // Cleared only once the answer is in. A transient "model is busy"
        // used to cost the user what they had typed, which is the one thing
        // a failure here must not do.
        onSuccess: () => setQuestion(''),
        onError: (error) =>
          setFailure(
            error instanceof ApiError ? error.message : 'That did not get through. Try again.',
          ),
      },
    );
  };

  if (!open) {
    return (
      <button
        type="button"
        className="assistant-launcher"
        onClick={() => setOpen(true)}
        title={`Ask about ${conceptName}`}
        aria-label={`Ask about ${conceptName}`}
      >
        <Icon name="brain" size={20} />
      </button>
    );
  }

  return (
    <aside className="assistant-panel" aria-label="Assistant">
      <div className="row items-center justify-between p3" style={{ flexShrink: 0 }}>
        <div className="col">
          <AiTag>Assistant</AiTag>
          <span className="t-caption mt1">
            {screen ? 'Reading this tab' : 'Ask about this concept'}
          </span>
        </div>
        <button type="button" className="icon-btn" onClick={() => setOpen(false)} title="Close">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="divider" />

      {/*
        minHeight 0 is load-bearing. A flex child that holds the scrollbar has
        to be allowed to shrink below its content, or it grows to fit the whole
        thread instead: the newest messages render past the bottom of a
        position-fixed panel, nothing scrolls, and a reply that arrived
        correctly is simply off screen. The workspace's editor column carries
        the same line for the same reason.
      */}
      <div className="col g4 flex-1 scroll-y p3" style={{ minHeight: 0 }}>
        {isLoading ? (
          <Spinner label="Loading" />
        ) : (
          <>
            {(messages ?? []).length === 0 && (
              <div className="t-small">
                It knows {conceptName}, what you have already practised and what you have got wrong.
                It will not write your solution — ask it what is wrong with yours, or what idea you
                are missing.
              </div>
            )}

            {(messages ?? []).map((message) => (
              <div key={message.id} className="col g1">
                <span className="t-caption">{message.role === 'user' ? 'You' : 'Assistant'}</span>
                <div
                  className={message.role === 'user' ? 'card p3' : ''}
                  style={message.role === 'user' ? { background: 'var(--surface-2)' } : undefined}
                >
                  <Markdown content={message.content} />
                </div>
              </div>
            ))}

            {ask.isPending && <Spinner label="Thinking" />}
            {failure && (
              <div className="t-small" style={{ color: 'var(--error)' }}>
                {failure}
              </div>
            )}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="divider" />

      <div className="col g2 p3" style={{ flexShrink: 0 }}>
        <textarea
          className="textarea"
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter makes a new line — the convention
            // every chat box already uses.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Why is my answer wrong?"
        />
        <Button size="sm" icon="send" onClick={send} disabled={ask.isPending}>
          Ask
        </Button>
      </div>
    </aside>
  );
}
