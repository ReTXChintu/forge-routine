import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DiagnosisPanel } from './DiagnosisPanel';

/**
 * When a diagnosis can be rewritten, and when it must not be.
 *
 * Reported as "if I write the diagnosis wrong it asks me to change but there
 * is no way I can change it" — the panel disabled the box on the first
 * submission regardless of the verdict.
 *
 * The rule comes from the server, which withholds the real cause below its
 * accuracy threshold precisely so a retry can still teach something. So the
 * cause being released is what closes the box, not the act of submitting; and
 * once it is out, rewriting would be marking your own homework.
 */

const base = {
  value: 'The loop variable is shared across iterations.',
  onChange: vi.fn(),
  onSubmit: vi.fn(),
  submitting: false,
  canSubmit: true,
  canResubmit: true,
};

const box = () => screen.getByPlaceholderText(/The loop variable is declared with/i);

describe('a diagnosis that was wrong', () => {
  it('can be rewritten while the real cause is withheld', () => {
    render(
      <DiagnosisPanel
        {...base}
        submitted
        result={{
          accuracy: 0.2,
          feedback: 'Not the cause. Look at the binding.',
          actualCause: null,
        }}
      />,
    );

    expect((box() as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: /submit again/i })).toBeTruthy();
    // Said out loud, because an editable box is easy to miss.
    expect(screen.getByText(/still withheld/i)).toBeTruthy();
  });

  it('submits again when asked', () => {
    const onSubmit = vi.fn();
    render(
      <DiagnosisPanel
        {...base}
        onSubmit={onSubmit}
        submitted
        result={{ accuracy: 0.2, feedback: 'Not the cause.', actualCause: null }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /submit again/i }));
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe('a diagnosis that was right', () => {
  it('locks once the cause has been released', () => {
    render(
      <DiagnosisPanel
        {...base}
        submitted
        result={{
          accuracy: 0.9,
          feedback: 'That is it.',
          actualCause: 'var is function-scoped, so every callback shares one binding.',
        }}
      />,
    );

    // Rewriting with the answer on screen would produce a score that means
    // nothing.
    expect((box() as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    expect(screen.getByText(/var is function-scoped/)).toBeTruthy();
  });
});

describe('a fix that passed with a wrong diagnosis', () => {
  it('says the attempt is finished rather than offering a refused retry', () => {
    // The awkward case: a debugging exercise submits diagnosis and fix
    // together, so passing closes the attempt — and another submission would
    // come back refused.
    render(
      <DiagnosisPanel
        {...base}
        submitted
        canResubmit={false}
        result={{ accuracy: 0.3, feedback: 'Not quite the cause.', actualCause: null }}
      />,
    );

    expect((box() as HTMLTextAreaElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /submit/i })).toBeNull();
    expect(screen.getByText(/this attempt is finished/i)).toBeTruthy();
    // And it must not promise a rewrite it cannot accept.
    expect(screen.queryByText(/Rewrite your diagnosis/i)).toBeNull();
  });
});

describe('before anything is submitted', () => {
  it('asks for a sentence before it will accept one', () => {
    render(<DiagnosisPanel {...base} value="too short" submitted={false} result={null} />);

    expect(screen.getByRole('button', { name: /submit diagnosis and fix/i })).toHaveProperty(
      'disabled',
      true,
    );
    expect(screen.getByText(/a sentence at least/i)).toBeTruthy();
  });

  it('accepts a real one', () => {
    render(<DiagnosisPanel {...base} submitted={false} result={null} />);

    expect(screen.getByRole('button', { name: /submit diagnosis and fix/i })).toHaveProperty(
      'disabled',
      false,
    );
  });
});
