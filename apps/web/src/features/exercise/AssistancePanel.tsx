import type { HintKind } from '@forgeroutine/shared-types';

import { Icon } from '~/components/Icon';
import { AiTag, Badge, Button } from '~/components/ui';

/**
 * The assistance ladder (§8), as the prototype draws it.
 *
 * Rungs are listed cheapest first. The ones that preserve the challenge are
 * plain; the ones that reduce or end it are marked `danger` and say so in
 * their badge. The point is not to make help hard to get — it is to make
 * the cheap step the obvious one, and taking the expensive step a decision
 * rather than a reflex.
 */

interface Rung {
  kind: HintKind;
  label: string;
  description: string;
  /** How much of the exercise survives asking. */
  cost: 'preserves' | 'reduces' | 'ends';
}

const RUNGS: Rung[] = [
  {
    kind: 'CONCEPT_REMINDER',
    label: 'Concept reminder',
    description: 'The underlying idea, without looking at your code',
    cost: 'preserves',
  },
  {
    kind: 'SMALL_HINT',
    label: 'Small hint',
    description: 'One question to narrow things down',
    cost: 'preserves',
  },
  {
    kind: 'DEBUGGING_QUESTION',
    label: 'Debugging question',
    description: 'What did you expect, and what happened?',
    cost: 'preserves',
  },
  {
    kind: 'EXPLAIN_ERROR',
    label: 'Explain this error',
    description: 'What the error means in general',
    cost: 'preserves',
  },
  { kind: 'HINT', label: 'Hint', description: 'Where the problem is', cost: 'reduces' },
  {
    kind: 'SHOW_APPROACH',
    label: 'Show approach',
    description: 'The algorithm, in prose',
    cost: 'reduces',
  },
];

const COST_BADGE = {
  preserves: { variant: 'success' as const, text: 'Preserves challenge' },
  reduces: { variant: 'warning' as const, text: 'Reduces challenge' },
  ends: { variant: 'error' as const, text: 'Ends challenge' },
};

export interface HintEntry {
  kind: HintKind;
  message: string;
  intervention: string | null;
}

interface AssistancePanelProps {
  enabled: boolean;
  blindMode: boolean;
  hints: HintEntry[];
  pending: HintKind | null;
  gateMessage: string | null;
  onRequest: (kind: HintKind, overrideGate?: boolean) => void;
}

export function AssistancePanel({
  enabled,
  blindMode,
  hints,
  pending,
  gateMessage,
  onRequest,
}: AssistancePanelProps) {
  if (blindMode) {
    return (
      <div className="p4">
        <Badge variant="neutral" icon="circleSlash">
          Hints disabled in this mode
        </Badge>
        {/* Blind coding is the point of the mode, not a limitation of it. */}
        <div className="t-caption mt3">
          Blind coding measures what you can write unaided. Assistance would measure something else.
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="p4" style={{ borderBottom: '1px solid var(--border)' }}>
        <AiTag>AI Assistance</AiTag>
        <div className="t-caption mt2">Hints preserve the challenge. Solutions end it.</div>
      </div>

      <div className="col g2 p3 scroll-y" style={{ flex: 1, minHeight: 0 }}>
        {!enabled && (
          <div className="t-caption mb2">
            AI is not configured. The static hints on the problem still apply.
          </div>
        )}

        {RUNGS.map((rung) => {
          const badge = COST_BADGE[rung.cost];
          const busy = pending === rung.kind;

          return (
            <div
              key={rung.kind}
              className={`hint-level ${rung.cost === 'reduces' ? 'danger' : ''}`}
              onClick={() => enabled && !pending && onRequest(rung.kind)}
              style={{ opacity: enabled ? 1 : 0.45, cursor: enabled ? 'pointer' : 'not-allowed' }}
            >
              <div className="row justify-between items-center g2">
                <span className="t-h4" style={{ fontSize: 13 }}>
                  {rung.label}
                </span>
                <Badge variant={badge.variant}>{busy ? 'Thinking…' : badge.text}</Badge>
              </div>
              <div className="t-caption mt1">{rung.description}</div>
            </div>
          );
        })}

        <div
          className="hint-level danger"
          onClick={() => enabled && !pending && onRequest('SHOW_SOLUTION')}
          style={{ opacity: enabled ? 1 : 0.45, cursor: enabled ? 'pointer' : 'not-allowed' }}
        >
          <div className="row justify-between items-center g2">
            <span className="t-h4" style={{ fontSize: 13 }}>
              Show solution
            </span>
            <Badge variant="error">Ends challenge</Badge>
          </div>
          <div className="t-caption mt1">The whole answer. Counts against independence.</div>
        </div>

        {gateMessage && (
          <div className="card p3" style={{ borderColor: 'var(--warning)' }}>
            <div className="row items-start g2">
              <span style={{ color: 'var(--warning)', marginTop: 2 }}>
                <Icon name="clock" size={13} />
              </span>
              <div>
                {/* The gate is explained, never silent. A button that does
                    nothing reads as a bug. */}
                <div className="t-small">{gateMessage}</div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt2"
                  onClick={() => onRequest('SHOW_SOLUTION', true)}
                >
                  Show it anyway
                </Button>
              </div>
            </div>
          </div>
        )}

        {hints.map((hint, index) => (
          <div key={`${hint.kind}-${index}`} className="card p3">
            <div className="t-caption mb1">{hint.kind.toLowerCase().replace(/_/g, ' ')}</div>
            <div className="t-body" style={{ color: 'var(--text-primary)' }}>
              {hint.message}
            </div>
            {hint.intervention && (
              <div className="t-caption mt2" style={{ color: 'var(--warning)' }}>
                {hint.intervention}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
