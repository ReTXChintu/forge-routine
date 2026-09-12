import { describe, expect, it } from 'vitest';

import { FakeAIProvider } from '../provider/testing/fake.provider.js';

import { answerGraderAgent, interviewReportAgent, interviewerAgent } from './interviewer.agent.js';

/**
 * The interview engine's two invariants, both of which fail silently:
 *
 *  - the depth cap must hold even when the grader wants to keep digging, or
 *    an interview grinds one topic forever;
 *  - a dimension the interview never tested must come back null, not zero,
 *    because a zero gets acted on as "bad at architecture" when the truth is
 *    "never asked about architecture".
 */

const ctx = { userId: 'u1' };

const question = {
  question: 'How does the event loop decide what runs next?',
  answer: 'It picks the next thing off the queue.',
  conceptName: 'Event loop',
  expectedPoints: ['microtask vs macrotask ordering'],
};

function grader(move: string) {
  return new FakeAIProvider([
    {
      data: {
        correctness: 0.8,
        depth: 0.4,
        specificity: 0.3,
        confidence: 0.7,
        move,
        reasoning: 'Right in outline, thin on mechanism.',
      },
    },
  ]);
}

describe('answerGraderAgent', () => {
  it('passes the model decision through below the depth cap', async () => {
    const result = await answerGraderAgent.run(
      grader('DEEPEN'),
      { ...question, depth: 1, maxDepth: 3 },
      ctx,
    );

    expect(result.move).toBe('DEEPEN');
  });

  it('forces a pivot at the cap however keen the model is to keep going', async () => {
    // An interviewer who will not leave one topic stops gathering
    // information and starts grinding the candidate down.
    for (const move of ['DEEPEN', 'ESCALATE', 'PIN_DOWN', 'RECOVER']) {
      const result = await answerGraderAgent.run(
        grader(move),
        { ...question, depth: 3, maxDepth: 3 },
        ctx,
      );

      expect(result.move).toBe('PIVOT');
    }
  });

  it('keeps the scores intact when it overrides the move', async () => {
    const result = await answerGraderAgent.run(
      grader('ESCALATE'),
      { ...question, depth: 4, maxDepth: 3 },
      ctx,
    );

    expect(result.correctness).toBe(0.8);
    expect(result.depth).toBe(0.4);
  });
});

describe('interviewerAgent', () => {
  it('tells the model what move to make', async () => {
    const provider = new FakeAIProvider([
      {
        data: {
          prompt: 'Walk me through what happens between two await points.',
          conceptSlug: 'event-loop',
          expectedPoints: ['the microtask queue drains first'],
        },
      },
    ]);

    await interviewerAgent.run(
      provider,
      {
        mode: 'TECHNICAL',
        targetLevel: 'MID',
        conceptName: 'Event loop',
        conceptDescription: 'How JavaScript schedules work.',
        commonMistakes: ['confusing microtasks with macrotasks'],
        transcript: [],
        move: 'RECOVER',
        depth: 1,
      },
      ctx,
    );

    // RECOVER must not signal to the candidate that they were wrong — the
    // instruction carrying that constraint has to reach the model.
    expect(provider.calls[0]?.messages).toContain('Do not signal that they were wrong');
  });

  it('marks the first question as having no transcript rather than sending an empty one', async () => {
    const provider = new FakeAIProvider([
      { data: { prompt: 'Tell me about closures.', conceptSlug: null, expectedPoints: [] } },
    ]);

    await interviewerAgent.run(
      provider,
      {
        mode: 'QUICK',
        targetLevel: 'JUNIOR',
        conceptName: 'Closures',
        conceptDescription: 'Captured lexical scope.',
        commonMistakes: [],
        transcript: [],
        move: 'OPEN',
        depth: 0,
      },
      ctx,
    );

    expect(provider.calls[0]?.messages).toContain('this is the first question');
  });
});

describe('interviewReportAgent', () => {
  it('accepts nulls for dimensions the interview never tested', async () => {
    const provider = new FakeAIProvider([
      {
        data: {
          problemSolving: null,
          communication: 0.7,
          practicalKnowledge: null,
          // A quick interview reveals nothing about architecture. A guessed
          // number here would be worse than no number.
          architectureThinking: null,
          debugging: null,
          codeQuality: null,
          tradeOffAwareness: null,
          strongAreas: ['explained closures precisely'],
          weakAreas: ['could not say when a microtask runs'],
          recommendedTopics: ['event loop'],
          summary: 'Solid fundamentals, thin on async scheduling.',
        },
      },
    ]);

    const result = await interviewReportAgent.run(
      provider,
      {
        mode: 'QUICK',
        targetLevel: 'MID',
        transcript: [{ question: 'q', answer: 'a', conceptName: 'Closures' }],
      },
      ctx,
    );

    expect(result.architectureThinking).toBeNull();
    expect(result.communication).toBe(0.7);
  });

  it('does not accept the scores the per-answer grader already measured', async () => {
    // A live run had this agent return overallScore 1 beside six weak areas
    // describing a candidate who answered nothing correctly. Correctness,
    // depth and confidence now come from the per-question grades, and a
    // response trying to supply them is not a valid report.
    const provider = new FakeAIProvider([
      {
        data: {
          overallScore: 1,
          technicalCorrectness: 1,
          depth: 1,
          confidence: 1,
          problemSolving: null,
          communication: null,
          practicalKnowledge: null,
          architectureThinking: null,
          debugging: null,
          codeQuality: null,
          tradeOffAwareness: null,
          strongAreas: [],
          weakAreas: ['got nothing right'],
          recommendedTopics: [],
          summary: 'Contradicts itself.',
        },
      },
    ]);

    const result = await interviewReportAgent.run(
      provider,
      { mode: 'QUICK', targetLevel: 'MID', transcript: [] },
      ctx,
    );

    expect(result).not.toHaveProperty('overallScore');
    expect(result).not.toHaveProperty('technicalCorrectness');
  });

  it('rejects a score outside the 0-1 range', async () => {
    const provider = new FakeAIProvider([
      {
        data: {
          problemSolving: 7,
          communication: null,
          practicalKnowledge: null,
          architectureThinking: null,
          debugging: null,
          codeQuality: null,
          tradeOffAwareness: null,
          strongAreas: [],
          weakAreas: [],
          recommendedTopics: [],
          summary: 'Scored out of ten by mistake.',
        },
      },
    ]);

    await expect(
      interviewReportAgent.run(
        provider,
        { mode: 'QUICK', targetLevel: 'MID', transcript: [] },
        ctx,
      ),
    ).rejects.toThrow(/violates its own schema/);
  });
});
