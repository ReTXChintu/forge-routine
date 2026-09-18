import { Module } from '@nestjs/common';

import { ConfigModule } from './infrastructure/config/config.module.js';
import { PrismaModule } from './infrastructure/prisma/prisma.module.js';
import { CacheModule } from './infrastructure/redis/cache.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChallengesModule } from './modules/challenges/challenges.module.js';
import { ConceptsModule } from './modules/concepts/concepts.module.js';
import { CurriculumModule } from './modules/curriculum/curriculum.module.js';
import { ExercisesModule } from './modules/exercises/exercises.module.js';
import { GenerationModule } from './modules/generation/generation.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InterviewsModule } from './modules/interviews/interviews.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { ProgressModule } from './modules/progress/progress.module.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { RecallModule } from './modules/recall/recall.module.js';
import { RoadmapModule } from './modules/roadmap/roadmap.module.js';
import { RoutinesModule } from './modules/routines/routines.module.js';
import { SessionsModule } from './modules/sessions/sessions.module.js';
import { SettingsModule } from './modules/settings/settings.module.js';
import { SkillsModule } from './modules/skills/skills.module.js';
import { SubmissionsModule } from './modules/submissions/submissions.module.js';
import { TechnologiesModule } from './modules/technologies/technologies.module.js';

/**
 * A modular monolith (§45.15-16). One deployable process, split by business
 * domain rather than by technical layer.
 */
@Module({
  imports: [
    // Infrastructure (global)
    ConfigModule,
    PrismaModule,
    CacheModule,
    // Before AiModule: the provider factory resolves each call's vendor
    // through AISettingsService, so it must already be available.
    SettingsModule,
    AiModule,

    // Domains
    AuthModule,
    CurriculumModule,
    TechnologiesModule,
    ConceptsModule,
    SkillsModule,
    RoadmapModule,
    GenerationModule,
    OnboardingModule,
    SessionsModule,
    ExercisesModule,
    ProjectsModule,
    RecallModule,
    RoutinesModule,
    InterviewsModule,
    ChallengesModule,
    SubmissionsModule,
    ProgressModule,
    HealthModule,
  ],
})
export class AppModule {}
