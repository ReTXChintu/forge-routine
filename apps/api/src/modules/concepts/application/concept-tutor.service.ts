import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  conceptChatAgent,
  conceptExplainerAgent,
  describeAIFailure,
  EXPLAINER_VERSION,
  type LearnerContext,
} from '@forgeroutine/ai';

import { Problems } from '../../../common/http/problem-details.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../../ai/ai.tokens.js';

export interface ExplainerView {
  summary: string;
  realWorld: string;
  examples: string[];
  codeExample: string | null;
  codeLanguage: string | null;
  pitfalls: string[];
  /** Official docs, when there is a trustworthy link. */
  docsUrl: string | null;
  /** False when it has not been written yet and cannot be. */
  available: boolean;
  /** Said plainly when AI is off, rather than showing an empty page. */
  unavailableReason: string | null;
}

export interface ChatMessageView {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

/** How many past turns are replayed. Enough for a thread, not a transcript. */
const HISTORY_TURNS = 12;
/** Recent failures fed to the tutor. More than this is noise, not signal. */
const RECENT_ERRORS = 3;

/**
 * The teaching half of a concept page: the explanation, and the chat.
 *
 * The two are costed differently on purpose. The explanation is generated
 * **once per concept and shared by everyone** — the description of a
 * closure does not depend on who is reading it, and paying per reader for
 * identical text would multiply the bill by the user count for no gain.
 * The chat is per user, because its whole value is that it knows what this
 * particular person has already got wrong.
 */
@Injectable()
export class ConceptTutorService {
  private readonly logger = new Logger(ConceptTutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
  ) {}

  /**
   * The concept's explanation, writing it on first request.
   *
   * Lazy rather than generated with the curriculum: most concepts in a
   * catalogue are never opened, and writing all 113 up front would be
   * paying for 100 pages nobody reads.
   */
  async explainer(userId: string, conceptId: string): Promise<ExplainerView> {
    const existing = await this.prisma.conceptExplainer.findUnique({ where: { conceptId } });

    // Rewritten when the prompt has moved on. Without this a cached page
    // is permanent, and every improvement to how concepts are explained
    // would only reach concepts nobody had opened yet.
    if (existing && existing.promptVersion === EXPLAINER_VERSION) {
      return toExplainerView(existing);
    }

    const concept = await this.prisma.concept.findUnique({
      where: { id: conceptId },
      include: { technology: { select: { name: true, exerciseLanguage: true } } },
    });
    if (!concept) throw Problems.notFound('Concept');

    if (!this.ai) return unavailable('AI is off, so the written explanation has not been made.');

    try {
      const written = await conceptExplainerAgent.run(
        this.ai,
        {
          technologyName: concept.technology.name,
          conceptName: concept.name,
          conceptDescription: concept.description,
          difficulty: concept.difficulty,
          learningObjectives: concept.learningObjectives,
          commonMistakes: concept.commonMistakes,
          language: concept.technology.exerciseLanguage,
        },
        { userId },
      );

      // Upsert, not create: two people opening the same concept at the
      // same moment both generate, and the second must not 500 on the
      // unique constraint. The wasted call is cheaper than the error.
      const row = {
        ...written,
        docsUrl: safeDocsUrl(written.docsUrl),
        generatedBy: conceptExplainerAgent.name,
        promptVersion: EXPLAINER_VERSION,
      };

      // Upsert with a real update, not an empty one: this now also runs
      // when an older version is being replaced. Two people opening the
      // same concept at once both generate and the second must not 500 on
      // the unique constraint — the wasted call is cheaper than the error.
      const saved = await this.prisma.conceptExplainer.upsert({
        where: { conceptId },
        create: { conceptId, ...row },
        update: row,
      });

      this.logger.log(`Wrote the explainer for ${concept.slug}`);
      return toExplainerView(saved);
    } catch (error) {
      // Degrade. The concept page has its objectives, exercises and
      // questions without this, and failing the whole page over the
      // explanation would take those away too.
      // The real sentence, not a shrug. "Could not be written just now"
      // sent the last two failures to the logs and left the reader with
      // nothing to act on — the vendor almost always says what is wrong.
      const detail = describeAIFailure(error);
      this.logger.warn({ err: error }, `Could not write the explainer for ${concept.slug}`);
      return unavailable(`The explanation could not be written: ${detail}`);
    }
  }

  async history(userId: string, conceptId: string): Promise<ChatMessageView[]> {
    const messages = await this.prisma.conceptChatMessage.findMany({
      where: { userId, conceptId },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    return messages.map(toMessageView);
  }

  /**
   * Answers one question, with the user's own record in front of it.
   *
   * Nothing is written until the answer is in hand. An earlier version
   * stored the question first and, on failure, stored the error as the
   * reply — which left "the model is busy, try later" sitting in the
   * transcript for good, long after it was true. A transient failure
   * should leave no trace; the client keeps the typed question.
   */
  async ask(
    userId: string,
    conceptId: string,
    question: string,
    screen: string | null = null,
  ): Promise<ChatMessageView[]> {
    const trimmed = question.trim();
    if (trimmed.length === 0) throw Problems.badRequest('Ask something first.');

    const concept = await this.prisma.concept.findUnique({
      where: { id: conceptId },
      include: {
        technology: { select: { name: true } },
        explainer: { select: { summary: true } },
      },
    });
    if (!concept) throw Problems.notFound('Concept');

    if (!this.ai) {
      throw Problems.badRequest(
        'AI is off for your account. Add a provider key in Settings → AI to use the tutor.',
      );
    }

    const [learner, priorTurns] = await Promise.all([
      this.learnerContext(userId, conceptId),
      this.prisma.conceptChatMessage.findMany({
        where: { userId, conceptId },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_TURNS,
      }),
    ]);

    try {
      const answer = await conceptChatAgent.run(
        this.ai,
        {
          technologyName: concept.technology.name,
          conceptName: concept.name,
          conceptDescription: concept.description,
          explainerSummary: concept.explainer?.summary ?? null,
          learner,
          history: priorTurns
            .reverse()
            .map((turn) => ({ role: turn.role as 'user' | 'assistant', content: turn.content })),
          question: trimmed,
          // Not stored with the turn. It describes a moment, and a
          // transcript replaying last week's editor contents as context
          // would be worse than having none.
          screen,
        },
        { userId },
      );

      // Both at once, so a crash between them cannot leave a question
      // with no answer permanently in the thread.
      const [asked, replied] = await this.prisma.$transaction([
        this.prisma.conceptChatMessage.create({
          data: { userId, conceptId, role: 'user', content: trimmed },
        }),
        this.prisma.conceptChatMessage.create({
          data: { userId, conceptId, role: 'assistant', content: answer.message },
        }),
      ]);

      return [toMessageView(asked), toMessageView(replied)];
    } catch (error) {
      this.logger.warn({ err: error }, `Concept chat failed for ${userId} on ${concept.slug}`);

      // Thrown, not stored. "High demand, try later" is true for a minute
      // and wrong for ever after, and a transcript is not the place for it.
      throw Problems.aiUnavailable(describeAIFailure(error));
    }
  }

  /**
   * What the tutor is told about the person asking.
   *
   * Concrete on purpose. "Struggling learner" earns generic
   * encouragement; "failed this three times, last error was a stale loop
   * variable" earns an answer about their actual problem.
   */
  private async learnerContext(userId: string, conceptId: string): Promise<LearnerContext> {
    const [skill, attempts, recent, technologySkills, openAttempt] = await Promise.all([
      this.prisma.skill.findUnique({ where: { userId_conceptId: { userId, conceptId } } }),
      this.prisma.exerciseAttempt.groupBy({
        by: ['outcome'],
        where: { userId, exercise: { conceptId } },
        _count: { _all: true },
      }),
      this.prisma.codeSubmission.findMany({
        where: { userId, attempt: { exercise: { conceptId } }, execution: { passed: false } },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ERRORS,
        include: { execution: { select: { stderr: true, status: true } } },
      }),
      this.prisma.skill.findMany({
        where: { userId, concept: { technology: { concepts: { some: { id: conceptId } } } } },
        include: { concept: { select: { name: true } } },
      }),
      this.prisma.exerciseAttempt.findFirst({
        where: { userId, outcome: 'IN_PROGRESS' },
        orderBy: { openedAt: 'desc' },
        include: { exercise: { select: { title: true } } },
      }),
    ]);

    const total = attempts.reduce((sum, row) => sum + row._count._all, 0);
    const passed = attempts.find((row) => row.outcome === 'PASSED')?._count._all ?? 0;

    return {
      mastery: skill ? skill.conceptMastery : null,
      attempts: total,
      passed,
      recentErrors: recent
        .map((submission) => submission.execution?.stderr?.trim() ?? '')
        .filter((message) => message.length > 0)
        // Truncated: a stack trace is mostly frames, and the first line is
        // the part that says what went wrong.
        .map((message) => message.split('\n')[0]!.slice(0, 200)),
      knownConcepts: technologySkills
        .filter((row) => row.conceptMastery >= 0.7)
        .map((row) => row.concept.name)
        .slice(0, 8),
      weakConcepts: technologySkills
        .filter((row) => row.attempts > 0 && row.conceptMastery < 0.4)
        .map((row) => row.concept.name)
        .slice(0, 8),
      openExerciseTitle: openAttempt?.exercise.title ?? null,
    };
  }
}

/**
 * Keeps a documentation link only if it is plainly a documentation link.
 *
 * A model asked for a URL will produce a plausible one whether or not it
 * exists. This cannot tell a live page from a dead one, but it can refuse
 * the categories that are never right — a non-https scheme, or a host
 * nobody publishes reference material on — which is most of the damage.
 */
function safeDocsUrl(value: string | null): string | null {
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;

  const host = url.hostname.toLowerCase();
  return DOCS_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
    ? url.toString()
    : null;
}

/** Hosts whose links are reference documentation rather than someone's blog. */
const DOCS_HOSTS = [
  'developer.mozilla.org',
  'nodejs.org',
  'typescriptlang.org',
  'react.dev',
  'nextjs.org',
  'docs.nestjs.com',
  'postgresql.org',
  'mongodb.com',
  'prisma.io',
  'typeorm.io',
  'redis.io',
  'docs.docker.com',
  'nginx.org',
  'doc.traefik.io',
  'docs.github.com',
  'jenkins.io',
  'git-scm.com',
  'doc.rust-lang.org',
  'kernel.org',
  'man7.org',
];

function unavailable(reason: string): ExplainerView {
  return {
    summary: '',
    realWorld: '',
    examples: [],
    codeExample: null,
    codeLanguage: null,
    pitfalls: [],
    docsUrl: null,
    available: false,
    unavailableReason: reason,
  };
}

function toExplainerView(row: {
  summary: string;
  realWorld: string;
  examples: string[];
  codeExample: string | null;
  codeLanguage: string | null;
  pitfalls: string[];
  docsUrl: string | null;
}): ExplainerView {
  return { ...row, available: true, unavailableReason: null };
}

function toMessageView(row: {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
}): ChatMessageView {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}
