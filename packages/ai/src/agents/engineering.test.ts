import { describe, expect, it } from 'vitest';

import { FakeAIProvider } from '../provider/testing/fake.provider.js';

import { designReviewAgent, incidentReviewAgent, scoreDesign } from './engineering.agent.js';

/**
 * The design reviewer's scores are computed, not asked for.
 *
 * Asked directly, the model returned 1.00 across every dimension for a design
 * it had just described as having two critical flaws. These tests pin the
 * arithmetic that replaced it, and the two invariants that cost real bugs.
 */

const ctx = { userId: 'u1' };

describe('scoreDesign', () => {
  it('scores a dimension the submission never engaged with as null, not zero', () => {
    // Zero would tell the user they are bad at something nobody asked about.
    const scores = scoreDesign({ addressed: ['scalability'], gaps: [] });

    expect(scores.scalability).toBe(1);
    expect(scores.operability).toBeNull();
    expect(scores.dataModelling).toBeNull();
  });

  it('treats a gap as evidence about its dimension even when addressed omits it', () => {
    // Models routinely tag a gap to scalability and then leave scalability
    // out of `addressed`. Trusting `addressed` alone threw the penalty away
    // and reported a dimension with two critical gaps as untested.
    const scores = scoreDesign({
      addressed: ['requirementsUnderstanding'],
      gaps: [
        {
          severity: 'critical',
          dimension: 'scalability',
          title: 'Reads a 5GB file into 512MB',
          explanation: 'The process dies.',
        },
      ],
    });

    expect(scores.scalability).toBeCloseTo(0.4);
    expect(scores.requirementsUnderstanding).toBe(1);
  });

  it('accumulates penalties within one dimension', () => {
    const scores = scoreDesign({
      addressed: ['failureHandling'],
      gaps: [
        { severity: 'major', dimension: 'failureHandling', title: 'a', explanation: 'x' },
        { severity: 'major', dimension: 'failureHandling', title: 'b', explanation: 'y' },
      ],
    });

    expect(scores.failureHandling).toBeCloseTo(0.3);
  });

  it('never goes below zero however many gaps land on one dimension', () => {
    const scores = scoreDesign({
      addressed: ['architectureThinking'],
      gaps: Array.from({ length: 5 }, (_, index) => ({
        severity: 'critical' as const,
        dimension: 'architectureThinking' as const,
        title: `gap ${index}`,
        explanation: 'x',
      })),
    });

    expect(scores.architectureThinking).toBe(0);
  });

  it('cannot report full marks on a dimension carrying a critical gap', () => {
    // The property the original bug violated. Worth asserting directly.
    const scores = scoreDesign({
      addressed: [...(['scalability'] as const)],
      gaps: [
        { severity: 'critical', dimension: 'scalability', title: 'a', explanation: 'x' },
      ],
    });

    expect(scores.scalability).toBeLessThan(1);
  });
});

describe('designReviewAgent', () => {
  it('strips a patch out of a gap explanation rather than discarding the review', () => {
    // Handing over the architecture removes the exercise. The prose around
    // the patch is still worth reading, so it is stripped, not dropped.
    const provider = new FakeAIProvider([
      {
        data: {
          addressed: ['scalability'],
          strengths: [],
          gaps: [
            {
              severity: 'critical',
              dimension: 'scalability',
              title: 'Buffers the whole file',
              explanation:
                'This will not fit in memory.\n```js\nconst stream = fs.createReadStream(path);\n```\nUse that instead.',
            },
          ],
          followUpQuestions: [],
          summary: 'Needs streaming.',
        },
      },
    ]);

    return designReviewAgent
      .run(
        provider,
        {
          title: 'CSV ingestion',
          brief: 'Design it.',
          constraints: [],
          expectedTopics: [],
          submission: 'readFileSync',
        },
        ctx,
      )
      .then((review) => {
        expect(review.gaps[0]?.explanation).not.toContain('createReadStream');
        expect(review.gaps[0]?.explanation).toContain('will not fit in memory');
      });
  });

  it('rejects a gap tagged with a dimension that does not exist', () => {
    const provider = new FakeAIProvider([
      {
        data: {
          addressed: [],
          strengths: [],
          gaps: [
            { severity: 'critical', dimension: 'vibes', title: 'a', explanation: 'x' },
          ],
          followUpQuestions: [],
          summary: 's',
        },
      },
    ]);

    return expect(
      designReviewAgent.run(
        provider,
        { title: 't', brief: 'b', constraints: [], expectedTopics: [], submission: 's' },
        ctx,
      ),
    ).rejects.toThrow(/violates its own schema/);
  });
});

describe('incidentReviewAgent', () => {
  it('separates naming the cause from reasoning towards it', async () => {
    // Someone who guessed right without using the evidence has demonstrated
    // nothing; someone who reasoned carefully to a wrong answer has
    // demonstrated a great deal. The contract keeps the two apart.
    const provider = new FakeAIProvider([
      {
        data: {
          diagnosisAccuracy: 0.9,
          reasoningQuality: 0.2,
          remediationQuality: null,
          preventionThinking: null,
          foundRootCause: true,
          missedSignals: ['event-loop lag tracked p99 exactly'],
          misdiagnoses: [],
          summary: 'Right answer, no working shown.',
        },
      },
    ]);

    const review = await incidentReviewAgent.run(
      provider,
      {
        title: 'Latency cliff',
        scenario: 's',
        telemetry: 't',
        rootCause: 'Synchronous JSON.parse blocking the event loop',
        submission: 'The event loop is blocked.',
      },
      ctx,
    );

    expect(review.foundRootCause).toBe(true);
    expect(review.reasoningQuality).toBe(0.2);
    expect(review.missedSignals).toHaveLength(1);
  });

  it('requires a diagnosis accuracy: there is always a cause to be graded against', () => {
    const provider = new FakeAIProvider([
      {
        data: {
          diagnosisAccuracy: null,
          reasoningQuality: null,
          remediationQuality: null,
          preventionThinking: null,
          foundRootCause: false,
          missedSignals: [],
          misdiagnoses: [],
          summary: 's',
        },
      },
    ]);

    return expect(
      incidentReviewAgent.run(
        provider,
        { title: 't', scenario: 's', telemetry: 't', rootCause: 'r', submission: 'x' },
        ctx,
      ),
    ).rejects.toThrow(/violates its own schema/);
  });
});
