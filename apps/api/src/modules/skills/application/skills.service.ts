import { Injectable } from '@nestjs/common';

import type { Prisma, Skill as SkillRow } from '@forgeroutine/database';
import type {
  AssistanceLevel,
  SkillDelta,
  SkillDimension,
  SkillVector,
  WeakSkill,
} from '@forgeroutine/shared-types';
import { SKILL_DIMENSIONS } from '@forgeroutine/shared-types';
import { round, unit } from '@forgeroutine/utils';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';

/**
 * The nine-dimension skill model (§7).
 *
 * Two design points worth stating:
 *
 *  - Every write goes through `applyEvidence`, which appends to the `SkillEvent`
 *    ledger *and* updates the projection. The ledger is what makes "why did my
 *    score drop?" answerable and lets a formula fix be replayed retroactively.
 *  - `null` evidence for a dimension means *unscored*: the dimension is left
 *    untouched. Writing zero would be a lie the model then acts on for months.
 */

export type DimensionEvidence = Partial<Record<SkillDimension, number | null>>;

export interface ApplyEvidenceInput {
  userId: string;
  conceptId: string;
  evidence: DimensionEvidence;
  cause:
    | 'EXERCISE_ATTEMPT'
    | 'AI_EVALUATION'
    | 'INTERVIEW'
    | 'REVIEW'
    | 'SELF_ASSESSMENT'
    | 'DECAY'
    | 'INITIAL_ESTIMATE'
    | 'RECALCULATION';
  sourceId?: string;
  note?: string;
  /** How strongly this observation moves the stored value. */
  learningRate?: number;
  assistanceLevel?: AssistanceLevel;
}

/**
 * Exponential moving average rather than replacement.
 *
 * One good attempt does not make someone proficient and one bad attempt does not
 * undo months of work. 0.3 was chosen so roughly three consistent observations
 * move a dimension most of the way — fast enough to feel responsive, slow enough
 * that a single fluke does not rewrite the record.
 */
const DEFAULT_LEARNING_RATE = 0.3;

@Injectable()
export class SkillsService {
  constructor(private readonly prisma: PrismaService) {}

  async applyEvidence(input: ApplyEvidenceInput): Promise<SkillDelta[]> {
    return this.prisma.$transaction(async (tx) => this.applyEvidenceIn(tx, input));
  }

  async applyEvidenceIn(
    tx: Prisma.TransactionClient,
    input: ApplyEvidenceInput,
  ): Promise<SkillDelta[]> {
    const rate = input.learningRate ?? DEFAULT_LEARNING_RATE;

    const existing = await tx.skill.upsert({
      where: { userId_conceptId: { userId: input.userId, conceptId: input.conceptId } },
      create: { userId: input.userId, conceptId: input.conceptId },
      update: {},
      include: { concept: { select: { name: true } } },
    });

    const updates: Record<string, number> = {};
    const deltas: SkillDelta[] = [];

    for (const dimension of SKILL_DIMENSIONS) {
      const observed = input.evidence[dimension];
      // undefined = not part of this evidence; null = explicitly unscored.
      if (observed === undefined || observed === null) continue;

      const before = existing[dimension];
      const after = round(unit(before + rate * (unit(observed) - before)));

      if (after === before) continue;

      updates[dimension] = after;
      deltas.push({
        conceptId: input.conceptId,
        conceptName: existing.concept.name,
        dimension,
        before,
        after,
      });
    }

    if (deltas.length > 0 || input.assistanceLevel !== undefined) {
      await tx.skill.update({
        where: { id: existing.id },
        data: {
          ...updates,
          ...(input.assistanceLevel !== undefined
            ? { assistanceLevel: input.assistanceLevel }
            : {}),
          attempts: input.cause === 'EXERCISE_ATTEMPT' ? { increment: 1 } : undefined,
          lastPracticedAt: new Date(),
        },
      });
    }

    if (deltas.length > 0) {
      await tx.skillEvent.createMany({
        data: deltas.map((delta) => ({
          userId: input.userId,
          skillId: existing.id,
          dimension: delta.dimension,
          before: delta.before,
          after: delta.after,
          cause: input.cause,
          sourceId: input.sourceId ?? null,
          note: input.note ?? null,
        })),
      });
    }

    return deltas;
  }

  async getSkill(userId: string, conceptId: string): Promise<SkillRow | null> {
    return this.prisma.skill.findUnique({
      where: { userId_conceptId: { userId, conceptId } },
    });
  }

  /** Assistance level for a concept, defaulting to Guided for an untouched concept. */
  async getAssistanceLevel(userId: string, conceptId: string): Promise<AssistanceLevel> {
    const skill = await this.getSkill(userId, conceptId);
    return (skill?.assistanceLevel ?? 1) as AssistanceLevel;
  }

  async getSkillMap(userId: string): Promise<Map<string, SkillVector>> {
    const skills = await this.prisma.skill.findMany({ where: { userId } });
    return new Map(skills.map((skill) => [skill.conceptId, toVector(skill)]));
  }

  /**
   * Weakest skills for the dashboard.
   *
   * Ranked by `codingAbility` rather than `conceptMastery`: the product exists
   * because those two diverge, and the implementation gap is the actionable one.
   */
  async getWeakest(userId: string, limit = 5): Promise<WeakSkill[]> {
    const skills = await this.prisma.skill.findMany({
      where: { userId, attempts: { gt: 0 } },
      orderBy: { codingAbility: 'asc' },
      take: limit,
      include: {
        concept: { select: { name: true, technology: { select: { name: true } } } },
      },
    });

    return skills.map((skill) => ({
      conceptId: skill.conceptId,
      conceptName: skill.concept.name,
      technologyName: skill.concept.technology.name,
      dimension: 'codingAbility' as const,
      value: skill.codingAbility,
      rootCauseConceptId: null,
      rootCauseConceptName: null,
    }));
  }

  /**
   * Seeds initial estimates when a user declares existing knowledge, so an expert
   * is never made to sit through "Variables".
   *
   * Concept mastery is seeded optimistically and coding ability conservatively:
   * self-assessment is systematically overconfident about implementation, which is
   * precisely the blind spot this product was built to correct.
   */
  async seedInitialEstimates(
    tx: Prisma.TransactionClient,
    userId: string,
    conceptIds: readonly string[],
    existingKnowledge: number,
  ): Promise<void> {
    if (conceptIds.length === 0) return;

    const mastery = unit(existingKnowledge);
    const coding = unit(existingKnowledge * 0.6);

    // Bulk, not a loop over applyEvidenceIn.
    //
    // That loop cost three round-trips per concept inside a single
    // transaction, so seeding a technology against a remote database blew the
    // 5s transaction timeout somewhere around the tenth concept. Raising the
    // timeout would only move the failure to a larger curriculum; this is
    // three queries regardless of how many concepts there are.
    //
    // There is also nothing to average against here, so the read-modify-write
    // that applyEvidenceIn performs buys nothing.
    await tx.skill.createMany({
      data: conceptIds.map((conceptId) => ({
        userId,
        conceptId,
        conceptMastery: mastery,
        recallStrength: round(mastery * 0.8),
        codingAbility: coding,
        confidence: mastery,
      })),
      // A concept the user has genuinely practised keeps its real history: a
      // coarse self-rating must never overwrite measured evidence.
      skipDuplicates: true,
    });

    const seeded = await tx.skill.findMany({
      where: { userId, conceptId: { in: [...conceptIds] } },
      select: { id: true, conceptId: true },
    });

    await tx.skillEvent.createMany({
      data: seeded.map((skill) => ({
        userId,
        skillId: skill.id,
        dimension: 'conceptMastery',
        before: 0,
        after: mastery,
        cause: 'INITIAL_ESTIMATE' as const,
        note: 'Self-declared existing knowledge',
      })),
    });
  }
}

function toVector(skill: SkillRow): SkillVector {
  return {
    conceptMastery: skill.conceptMastery,
    recallStrength: skill.recallStrength,
    codingAbility: skill.codingAbility,
    problemSolving: skill.problemSolving,
    debuggingAbility: skill.debuggingAbility,
    explanationAbility: skill.explanationAbility,
    interviewReadiness: skill.interviewReadiness,
    confidence: skill.confidence,
    retention: skill.retention,
  };
}
