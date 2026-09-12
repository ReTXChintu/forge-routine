import { Injectable, Logger } from '@nestjs/common';

import type { CompleteOnboardingInput } from '@forgeroutine/validation';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { RoadmapService, type RoadmapView } from '../../roadmap/application/roadmap.service.js';
import { TechnologiesService } from '../../technologies/application/technologies.service.js';

export interface OnboardingStatus {
  completed: boolean;
  technologyCount: number;
  /** True while any technology still has no curriculum. */
  awaitingContent: boolean;
  hasRoadmap: boolean;
}

export interface OnboardingResult {
  roadmap: RoadmapView;
  /** Technologies whose curriculum has not been generated yet. */
  awaitingTechnologies: string[];
}

/**
 * The first-run flow (docs/learning-path.md).
 *
 * Deliberately synchronous today. The rule-based builder runs in milliseconds
 * against curated content, so there is nothing to wait for. When AI generation
 * lands, only the *content* step becomes a background job — the skeleton stays
 * on this path, because the user seeing their roadmap immediately is the whole
 * design.
 */
@Injectable()
export class OnboardingService {
  private readonly logger = new Logger(OnboardingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly technologies: TechnologiesService,
    private readonly roadmap: RoadmapService,
  ) {}

  async status(userId: string): Promise<OnboardingStatus> {
    const [preferences, technologies, roadmap] = await Promise.all([
      this.prisma.userPreferences.findUnique({ where: { userId } }),
      this.prisma.userTechnology.findMany({
        where: { userId, status: 'ACTIVE' },
        select: { technologyId: true },
      }),
      this.prisma.roadmap.findFirst({
        where: { userId, status: { in: ['ACTIVE', 'BUILDING'] } },
        select: { id: true },
      }),
    ]);

    const withContent = await this.prisma.concept.groupBy({
      by: ['technologyId'],
      where: { technologyId: { in: technologies.map((t) => t.technologyId) }, archivedAt: null },
    });

    return {
      completed: preferences?.onboardedAt !== null && preferences?.onboardedAt !== undefined,
      technologyCount: technologies.length,
      awaitingContent: withContent.length < technologies.length,
      hasRoadmap: roadmap !== null,
    };
  }

  async complete(userId: string, input: CompleteOnboardingInput): Promise<OnboardingResult> {
    // Preferences first: the roadmap builder reads them, so writing them after
    // would produce a path planned against the wrong goal.
    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        dailyMinutes: input.dailyMinutes,
        primaryGoal: input.primaryGoal,
        interviewTarget: input.interviewTarget,
        timezone: input.timezone,
        interviewDate: input.interviewDate ? new Date(input.interviewDate) : null,
        onboardedAt: new Date(),
      },
      update: {
        dailyMinutes: input.dailyMinutes,
        primaryGoal: input.primaryGoal,
        interviewTarget: input.interviewTarget,
        timezone: input.timezone,
        interviewDate: input.interviewDate ? new Date(input.interviewDate) : null,
        onboardedAt: new Date(),
      },
    });

    // Sequential, not parallel: adding a technology imports its curriculum,
    // and two imports racing on the same shared catalogue row would deadlock
    // on the cross-technology prerequisite links.
    for (const technology of input.technologies) {
      await this.technologies.add(userId, {
        ...(technology.technologyId ? { technologyId: technology.technologyId } : {}),
        ...(technology.name ? { name: technology.name } : {}),
        priority: technology.priority,
        targetProficiency: technology.targetProficiency,
        interviewImportance: technology.interviewImportance,
        frequency: 'FREQUENT',
        existingKnowledge: technology.existingKnowledge,
      });
    }

    const roadmap = await this.roadmap.regenerate(userId);
    const awaitingTechnologies = await this.technologiesAwaitingContent(userId);

    this.logger.log(
      `Onboarded ${userId}: ${input.technologies.length} technologies, ` +
        `${roadmap.phases.length} phases, ${awaitingTechnologies.length} awaiting content`,
    );

    return { roadmap, awaitingTechnologies };
  }

  private async technologiesAwaitingContent(userId: string): Promise<string[]> {
    const technologies = await this.prisma.userTechnology.findMany({
      where: { userId, status: 'ACTIVE' },
      include: {
        technology: {
          select: {
            name: true,
            _count: { select: { concepts: { where: { archivedAt: null } } } },
          },
        },
      },
    });

    return technologies
      .filter((t) => t.technology._count.concepts === 0)
      .map((t) => t.technology.name);
  }
}
