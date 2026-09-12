import { describe, expect, it } from 'vitest';

import {
  CODE_REDACTED_NOTICE,
  INTERVENTION_MESSAGE,
  NO_CODE_SYSTEM_BLOCK,
  checkEscalationGate,
  containsCode,
  enforceNoCode,
  shouldIntervene,
  stripCodeBlocks,
} from './policy.js';
import { tutorAgent } from './tutor.agent.js';

describe('containsCode', () => {
  it('detects fenced blocks', () => {
    expect(containsCode('Here:\n```js\nconst a = 1;\n```')).toBe(true);
  });

  it('detects indented code blocks', () => {
    expect(containsCode('Try this:\n\n    const hits = new Map();\n')).toBe(true);
  });

  it('detects an inline declaration', () => {
    expect(containsCode('You could write const hits = new Map() at the top.')).toBe(true);
  });

  it('does not flag prose that merely mentions code concepts', () => {
    expect(containsCode('What data structure are you using to track requests per IP?')).toBe(false);
    expect(containsCode('Consider whether a Map would suit this better than an array.')).toBe(
      false,
    );
  });
});

describe('stripCodeBlocks', () => {
  it('removes a fenced block and reports the redaction', () => {
    const result = stripCodeBlocks('Try this:\n```js\nconst a = 1;\n```\nThat should work.');

    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('const a = 1');
    expect(result.text).toContain(CODE_REDACTED_NOTICE);
    expect(result.text).toContain('That should work.');
  });

  it('leaves pure prose untouched', () => {
    const text = 'What happens when the timestamp falls outside the window?';
    const result = stripCodeBlocks(text);

    expect(result.redacted).toBe(false);
    expect(result.text).toBe(text);
  });

  it('collapses adjacent notices from a multi-line strip', () => {
    const result = stripCodeBlocks('    const a = 1;\n    const b = 2;\n    const c = 3;');
    const occurrences = result.text.split(CODE_REDACTED_NOTICE).length - 1;

    expect(occurrences).toBe(1);
  });
});

describe('enforceNoCode', () => {
  it.each([
    'CONCEPT_REMINDER',
    'SMALL_HINT',
    'HINT',
    'DEBUGGING_QUESTION',
    'EXPLAIN_ERROR',
    'SHOW_APPROACH',
  ] as const)('strips code at %s', (kind) => {
    const result = enforceNoCode(kind, 'Do this:\n```js\nreturn items.map(f);\n```');

    expect(result.redacted).toBe(true);
    expect(result.text).not.toContain('items.map');
  });

  it('permits code at SHOW_SOLUTION, where it is the point', () => {
    const solution = 'Here:\n```js\nreturn items.map(f);\n```';
    const result = enforceNoCode('SHOW_SOLUTION', solution);

    expect(result.redacted).toBe(false);
    expect(result.text).toBe(solution);
  });
});

describe('escalation gate', () => {
  const base = {
    secondsSinceOpen: 5,
    priorHintKinds: [] as const,
    overrideConfirmed: false,
    blindMode: false,
  };

  it('allows any rung below SHOW_SOLUTION immediately', () => {
    expect(checkEscalationGate({ ...base, kind: 'SMALL_HINT' }).allowed).toBe(true);
  });

  it('blocks an immediate jump to the solution', () => {
    const decision = checkEscalationGate({ ...base, kind: 'SHOW_SOLUTION' });

    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ requiresOverride: true });
  });

  it('unlocks the solution once a lower rung has been used', () => {
    const decision = checkEscalationGate({
      ...base,
      kind: 'SHOW_SOLUTION',
      priorHintKinds: ['SMALL_HINT'],
    });

    expect(decision.allowed).toBe(true);
  });

  it('unlocks the solution after ten minutes of genuine effort', () => {
    expect(
      checkEscalationGate({ ...base, kind: 'SHOW_SOLUTION', secondsSinceOpen: 601 }).allowed,
    ).toBe(true);
  });

  it('always honours an explicit override — a speed bump, not a lock', () => {
    expect(
      checkEscalationGate({ ...base, kind: 'SHOW_SOLUTION', overrideConfirmed: true }).allowed,
    ).toBe(true);
  });

  it('refuses every rung in Blind Coding mode', () => {
    const decision = checkEscalationGate({ ...base, kind: 'SMALL_HINT', blindMode: true });

    expect(decision.allowed).toBe(false);
    expect(decision).toMatchObject({ requiresOverride: false });
  });
});

describe('early-solution intervention', () => {
  it('fires on a repeated immediate solution request', () => {
    expect(
      shouldIntervene({
        kind: 'SHOW_SOLUTION',
        secondsSinceOpen: 20,
        previousAttemptWasEarlyReveal: true,
      }),
    ).toBe(true);
  });

  it('does not fire the first time', () => {
    expect(
      shouldIntervene({
        kind: 'SHOW_SOLUTION',
        secondsSinceOpen: 20,
        previousAttemptWasEarlyReveal: false,
      }),
    ).toBe(false);
  });

  it('does not fire after genuine effort', () => {
    expect(
      shouldIntervene({
        kind: 'SHOW_SOLUTION',
        secondsSinceOpen: 400,
        previousAttemptWasEarlyReveal: true,
      }),
    ).toBe(false);
  });

  it('does not fire for light assistance', () => {
    expect(
      shouldIntervene({
        kind: 'SMALL_HINT',
        secondsSinceOpen: 5,
        previousAttemptWasEarlyReveal: true,
      }),
    ).toBe(false);
  });

  it('uses the agreed non-shaming wording', () => {
    expect(INTERVENTION_MESSAGE).toBe(
      "You're relying on assistance earlier than necessary. Let's try one smaller step first.",
    );
  });
});

describe('tutor prompt construction', () => {
  const input = {
    conceptName: 'Middleware',
    exerciseTitle: 'IP-based rate limiter',
    exerciseRequirements: 'Limit requests per IP.',
    userCode: 'const x = 1;',
    priorHints: [],
  };

  it('carries the no-code system block below SHOW_SOLUTION', () => {
    const prompt = tutorAgent.buildPrompt({ ...input, kind: 'SMALL_HINT' });

    expect(prompt.messages[0]?.content).toBe(NO_CODE_SYSTEM_BLOCK);
  });

  it('withholds the user code from CONCEPT_REMINDER', () => {
    const prompt = tutorAgent.buildPrompt({ ...input, kind: 'CONCEPT_REMINDER' });
    const body = prompt.messages.map((m) => m.content).join('\n');

    expect(body).not.toContain('const x = 1;');
  });

  it('supplies the user code to HINT, which needs to be specific', () => {
    const prompt = tutorAgent.buildPrompt({ ...input, kind: 'HINT' });
    const body = prompt.messages.map((m) => m.content).join('\n');

    expect(body).toContain('const x = 1;');
  });

  it('switches system blocks at SHOW_SOLUTION', () => {
    const prompt = tutorAgent.buildPrompt({ ...input, kind: 'SHOW_SOLUTION' });

    expect(prompt.messages[0]?.content).not.toBe(NO_CODE_SYSTEM_BLOCK);
  });

  it('tells the model what it already said, so it does not repeat itself', () => {
    const prompt = tutorAgent.buildPrompt({
      ...input,
      kind: 'HINT',
      priorHints: [{ kind: 'SMALL_HINT', response: 'What structure tracks requests?' }],
    });
    const body = prompt.messages.map((m) => m.content).join('\n');

    expect(body).toContain('What structure tracks requests?');
    expect(body).toContain('do not repeat');
  });
});
