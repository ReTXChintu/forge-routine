import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  type ConceptOutlineOutput,
  type GeneratedExerciseOutput,
  type GeneratedProjectOutput,
  type ConceptQuestionSetOutput,
  conceptDetailAgent,
  exerciseAgent,
  outlineAgent,
  prerequisiteAgent,
  projectAgent,
  questionAgent,
} from '@forgeroutine/ai';
import {
  DEFAULT_CONCEPTS_PER_PHASE,
  assertAcyclic,
  challengesFor,
  type GraphEdge,
  type GraphNode,
} from '@forgeroutine/curriculum';
import type { Prisma } from '@forgeroutine/database';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service.js';
import { AI_PROVIDER, type OptionalAIProvider } from '../../ai/ai.tokens.js';
import { AISettingsService } from '../../settings/application/ai-settings.service.js';

import { ExerciseVerifier } from './exercise-verifier.js';

export const GENERATOR_VERSION = 'ai-1';

export interface GenerationProgress {
  (step: string, percent: number): Promise<void> | void;
}

export interface GenerationOutcome {
  conceptsCreated: number;
  exercisesCreated: number;
  exercisesRejected: number;
  questionsCreated: number;
  projectsCreated: number;
  projectsRejected: number;
  edgesCreated: number;
}

/**
 * How many concepts a project pulls together.
 *
 * Drills are isolated by design, so nothing else in the curriculum ever asks
 * the user to combine two ideas. This is the roadmap's phase size, imported
 * rather than repeated: the roadmap closes each phase by looking for a
 * PROJECT exercise among that phase's concepts, so the two groupings must be
 * identical or the project lands in a phase that never looks for it.
 */
const CONCEPTS_PER_PROJECT = DEFAULT_CONCEPTS_PER_PHASE;

/**
 * Generates a full curriculum for one technology (docs/curriculum-engine.md).
 *
 *   outline → concept detail → prerequisite edges → exercises → persist
 *
 * Two properties the rest of the system depends on:
 *
 *  1. **Atomic.** Everything commits in one transaction as a single
 *     CurriculumVersion. A half-generated technology would leave concepts
 *     pointing at prerequisites that do not exist, and a roadmap built over
 *     the gap.
 *  2. **Verified.** Every generated exercise is executed in the sandbox
 *     before it is written. An exercise whose tests cannot be satisfied is
 *     discarded rather than shipped.
 */
@Injectable()
export class CurriculumGeneratorService {
  private readonly logger = new Logger(CurriculumGeneratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly verifier: ExerciseVerifier,
    private readonly settings: AISettingsService,
    @Inject(AI_PROVIDER) private readonly ai: OptionalAIProvider,
  ) {}

  /**
   * Whether *this user* can reach a model.
   *
   * It used to be a property of the server: one key in the environment,
   * so "is the provider wired up" answered it for everyone. Keys are per
   * user now, so the question has a different answer per user, and asking
   * the old one queued generation for people who cannot run it.
   */
  async availableFor(userId: string): Promise<boolean> {
    if (this.ai === null) return false;
    return (await this.settings.resolveFor(userId)) !== null;
  }

  async generateForTechnology(
    technologyId: string,
    userId: string,
    onProgress: GenerationProgress = () => undefined,
  ): Promise<GenerationOutcome> {
    if (!this.ai) throw new Error('AI provider is not configured');

    const technology = await this.prisma.technology.findUnique({
      where: { id: technologyId },
      select: { id: true, slug: true, name: true, exerciseLanguage: true },
    });
    if (!technology) throw new Error(`Technology ${technologyId} not found`);

    const context = { userId };

    // -- Stage 1: outline ---------------------------------------------------
    await onProgress(`Planning the ${technology.name} curriculum`, 5);

    const existingTechnologies = await this.otherTechnologyNames(userId, technologyId);

    // Curated concepts are passed in so the outline absorbs them instead of
    // replacing them. The seeded JavaScript set, for instance, is seven
    // hand-written concepts with verified exercises that start at closures —
    // excellent material and not a course. Regenerating without this would
    // archive all seven and take the exercises with them.
    const existingConcepts = await this.prisma.concept.findMany({
      where: { technologyId, archivedAt: null },
      orderBy: { orderIndex: 'asc' },
      select: { slug: true, name: true },
    });

    const outline = await outlineAgent.run(
      this.ai,
      {
        technologyName: technology.name,
        technologySlug: technology.slug,
        existingTechnologies,
        existingConcepts,
      },
      context,
    );

    const dropped = existingConcepts.filter(
      (concept) => !outline.concepts.some((candidate) => candidate.slug === concept.slug),
    );
    if (dropped.length > 0) {
      // Not fatal — the outline is still usable — but it means exercises are
      // about to be orphaned, and that should never be silent.
      this.logger.warn(
        `${technology.slug}: outline dropped ${dropped.length} existing concept(s): ` +
          dropped.map((concept) => concept.slug).join(', '),
      );
    }

    this.logger.log(`${technology.slug}: outlined ${outline.concepts.length} concepts`);

    // -- Stage 2: detail ----------------------------------------------------
    await onProgress(`Expanding ${outline.concepts.length} concepts`, 20);

    const detailed = await this.expandConcepts(technology.name, outline, context, onProgress);

    // -- Stage 3: prerequisites --------------------------------------------
    await onProgress('Working out the prerequisite order', 55);

    const edges = await this.proposeEdges(technology, outline, userId, context);

    // -- Stage 4: practice --------------------------------------------------
    //
    // Runnable exercises only where the sandbox can actually execute them.
    // Asking for JavaScript tests that grade "containers vs virtual machines"
    // produces exercises that cannot work — the model tried, and returned
    // output that failed its own contract. Those technologies get concept
    // questions instead. That is an honest limit, not a downgrade.
    const executable = technology.exerciseLanguage !== null;

    let exercises = new Map<string, GeneratedExerciseOutput[]>();
    let rejected = 0;
    let questions = new Map<string, ConceptQuestionSetOutput['questions']>();

    if (executable) {
      await onProgress('Writing and verifying exercises', 60);
      const generated = await this.generateExercises(
        technology.name,
        detailed,
        context,
        onProgress,
      );
      exercises = generated.exercises;
      rejected = generated.rejected;
    }

    // Fall back to questions when the exercise path produced nothing usable.
    //
    // This is not belt-and-braces: React was tagged executable and every one
    // of its eighteen generated exercises was rejected, because JSX will not
    // parse in the sandbox. Tagging is now correct, but a technology that
    // ends up with concepts and no practice at all is a dead end for the
    // user, and no tag should be able to cause that.
    if (exercises.size === 0) {
      if (executable) {
        this.logger.warn(
          `${technology.slug}: no exercise survived verification (${rejected} rejected), ` +
            'falling back to concept questions',
        );
      }
      await onProgress('Writing concept questions', 60);
      questions = await this.generateQuestions(technology.name, detailed, context, onProgress);
    }

    // -- Stage 5: projects --------------------------------------------------
    //
    // Only where exercises survived. A technology practised through concept
    // questions has no runnable drills, and a project is the one thing that
    // absolutely must execute — it is graded entirely by its tests.
    let projects: AnchoredProject[] = [];
    let projectsRejected = 0;

    if (exercises.size > 0) {
      await onProgress('Designing projects', 88);
      const built = await this.generateProjects(technology.name, detailed, context, onProgress);
      projects = built.projects;
      projectsRejected = built.rejected;
    }

    // -- Stage 6: persist ---------------------------------------------------
    await onProgress('Saving', 95);

    const outcome = await this.persist(technology, detailed, edges, exercises, questions, projects);

    return { ...outcome, exercisesRejected: rejected, projectsRejected };
  }

  // -- Stages ---------------------------------------------------------------

  private async expandConcepts(
    technologyName: string,
    outline: ConceptOutlineOutput,
    context: { userId: string },
    onProgress: GenerationProgress,
  ) {
    const detailed: DetailedConcept[] = [];

    for (const [index, concept] of outline.concepts.entries()) {
      try {
        const detail = await conceptDetailAgent.run(
          this.ai!,
          {
            technologyName,
            conceptName: concept.name,
            conceptDescription: concept.description,
            difficulty: concept.difficulty,
          },
          context,
        );
        detailed.push({ ...concept, ...detail });
      } catch (error) {
        // One concept failing to expand is not worth losing the technology
        // over. It lands with its outline text and no objectives, which is
        // thin but usable, and a later regeneration can fill it in.
        this.logger.warn(
          { err: error },
          `${concept.slug}: detail generation failed, keeping the outline`,
        );
        detailed.push({
          ...concept,
          learningObjectives: [],
          codingPatterns: [],
          commonMistakes: [],
        });
      }

      await onProgress(
        `Expanding concepts (${index + 1}/${outline.concepts.length})`,
        20 + Math.round((index / outline.concepts.length) * 30),
      );
    }

    return detailed;
  }

  private async proposeEdges(
    technology: { id: string; slug: string; name: string },
    outline: ConceptOutlineOutput,
    userId: string,
    context: { userId: string },
  ) {
    const externalConcepts = await this.externalConcepts(userId, technology.id);

    try {
      const proposal = await prerequisiteAgent.run(
        this.ai!,
        {
          technologySlug: technology.slug,
          technologyName: technology.name,
          concepts: outline.concepts,
          externalConcepts,
        },
        context,
      );
      return proposal.edges;
    } catch (error) {
      // A technology with no prerequisite edges is still perfectly learnable
      // in outline order. Losing the whole generation over the ordering hints
      // would be a far worse trade.
      this.logger.warn({ err: error }, `${technology.slug}: prerequisite generation failed`);
      return [];
    }
  }

  private async generateExercises(
    technologyName: string,
    concepts: readonly DetailedConcept[],
    context: { userId: string },
    onProgress: GenerationProgress,
  ): Promise<{ exercises: Map<string, GeneratedExerciseOutput[]>; rejected: number }> {
    const exercises = new Map<string, GeneratedExerciseOutput[]>();
    let rejected = 0;

    for (const [index, concept] of concepts.entries()) {
      try {
        const generated = await exerciseAgent.run(
          this.ai!,
          {
            technologyName,
            conceptName: concept.name,
            conceptDescription: concept.description,
            difficulty: concept.difficulty,
            learningObjectives: concept.learningObjectives,
            commonMistakes: concept.commonMistakes,
            language: 'javascript',
            existingSlugs: [],
            // A debugging exercise needs a real fault to be built from.
            includeDebugging: concept.commonMistakes.length > 0,
          },
          context,
        );

        const accepted: GeneratedExerciseOutput[] = [];

        for (const exercise of generated.exercises) {
          const verdict = await this.verifier.verify(exercise);
          if (!verdict.accepted) {
            rejected += 1;
            continue;
          }

          if (!(await this.verifier.verifyBrokenCodeFails(exercise))) {
            this.logger.warn(
              `Rejected "${exercise.slug}": broken code passes its own tests, so there is nothing to find`,
            );
            rejected += 1;
            continue;
          }

          accepted.push(exercise);
        }

        if (accepted.length > 0) exercises.set(concept.slug, accepted);
      } catch (error) {
        this.logger.warn({ err: error }, `${concept.slug}: exercise generation failed`);
      }

      await onProgress(
        `Writing exercises (${index + 1}/${concepts.length})`,
        60 + Math.round((index / concepts.length) * 33),
      );
    }

    return { exercises, rejected };
  }

  /**
   * One project per roadmap phase, hung off the last concept in that phase so
   * it unlocks only once everything it combines has been worked through.
   *
   * Verified exactly the way it will be graded: every step's solution against
   * its own tests and all earlier steps'. A project is rejected whole — a
   * partially valid one cannot be trimmed to its working prefix, because the
   * remaining steps were written to lead somewhere it no longer goes.
   */
  private async generateProjects(
    technologyName: string,
    concepts: readonly DetailedConcept[],
    context: { userId: string },
    onProgress: GenerationProgress,
  ): Promise<{ projects: AnchoredProject[]; rejected: number }> {
    // Chunked exactly as the roadmap chunks phases — including a short final
    // group. Folding a short tail into the previous group would be a nicer
    // project and the wrong one: it would anchor to a concept the roadmap
    // has placed in the *next* phase, where nothing looks for it.
    const groups: DetailedConcept[][] = [];
    for (let index = 0; index < concepts.length; index += CONCEPTS_PER_PROJECT) {
      groups.push(concepts.slice(index, index + CONCEPTS_PER_PROJECT));
    }

    const projects: AnchoredProject[] = [];
    let rejected = 0;

    for (const [index, group] of groups.entries()) {
      try {
        const project = await projectAgent.run(
          this.ai!,
          {
            technologyName,
            concepts: group.map((concept) => ({
              name: concept.name,
              description: concept.description,
            })),
            // Pitched at the hardest concept in the group: a project easier
            // than the drills that led to it teaches nothing.
            difficulty: Math.max(...group.map((concept) => concept.difficulty)),
            language: 'javascript',
          },
          context,
        );

        const verdict = await this.verifier.verifyProject(project);
        if (!verdict.accepted) {
          rejected += 1;
        } else {
          // Hung off the last concept in the group, so it unlocks only once
          // everything it combines has been practised.
          projects.push({ conceptSlug: group[group.length - 1]!.slug, project });
        }
      } catch (error) {
        this.logger.warn({ err: error }, `project ${index + 1}: generation failed`);
        rejected += 1;
      }

      await onProgress(
        `Designing projects (${index + 1}/${groups.length})`,
        88 + Math.round((index / groups.length) * 6),
      );
    }

    return { projects, rejected };
  }

  private async generateQuestions(
    technologyName: string,
    concepts: readonly DetailedConcept[],
    context: { userId: string },
    onProgress: GenerationProgress,
  ): Promise<Map<string, ConceptQuestionSetOutput['questions']>> {
    const questions = new Map<string, ConceptQuestionSetOutput['questions']>();

    for (const [index, concept] of concepts.entries()) {
      try {
        const generated = await questionAgent.run(
          this.ai!,
          {
            technologyName,
            conceptName: concept.name,
            conceptDescription: concept.description,
            difficulty: concept.difficulty,
            learningObjectives: concept.learningObjectives,
            commonMistakes: concept.commonMistakes,
          },
          context,
        );

        if (generated.questions.length > 0) questions.set(concept.slug, generated.questions);
      } catch (error) {
        this.logger.warn({ err: error }, `${concept.slug}: question generation failed`);
      }

      await onProgress(
        `Writing questions (${index + 1}/${concepts.length})`,
        60 + Math.round((index / concepts.length) * 33),
      );
    }

    return questions;
  }

  // -- Persistence ----------------------------------------------------------

  private async persist(
    technology: { id: string; slug: string; name: string },
    concepts: readonly DetailedConcept[],
    edges: readonly { conceptSlug: string; prerequisiteSlug: string; strength: 'HARD' | 'SOFT' }[],
    exercises: ReadonlyMap<string, GeneratedExerciseOutput[]>,
    questions: ReadonlyMap<string, ConceptQuestionSetOutput['questions']>,
    projects: readonly AnchoredProject[],
  ): Promise<Omit<GenerationOutcome, 'exercisesRejected' | 'projectsRejected'>> {
    return this.prisma.$transaction(
      async (tx) => {
        const latest = await tx.curriculumVersion.findFirst({
          where: { technologyId: technology.id },
          orderBy: { version: 'desc' },
          select: { version: true },
        });

        const version = await tx.curriculumVersion.create({
          data: {
            technologyId: technology.id,
            version: (latest?.version ?? 0) + 1,
            generatorVersion: GENERATOR_VERSION,
            status: 'GENERATING',
            model: 'openai',
            promptVersion: 'v1',
            conceptCount: concepts.length,
          },
        });

        // Archive concepts the new outline dropped. Without this a regenerated
        // technology accumulates every concept it has ever had: the roadmap
        // would schedule stale ones, and two concepts would share an
        // orderIndex. Archived rather than deleted, because a user may have
        // skill history against them (§5).
        const keptSlugs = concepts.map((c) => c.slug);
        await tx.concept.updateMany({
          where: {
            technologyId: technology.id,
            slug: { notIn: keptSlugs },
            archivedAt: null,
          },
          data: { archivedAt: new Date() },
        });

        const conceptIds = new Map<string, string>();

        for (const [index, concept] of concepts.entries()) {
          const row = await tx.concept.upsert({
            where: { technologyId_slug: { technologyId: technology.id, slug: concept.slug } },
            create: {
              technologyId: technology.id,
              curriculumVersionId: version.id,
              slug: concept.slug,
              name: concept.name,
              description: concept.description,
              difficulty: concept.difficulty,
              orderIndex: index,
              learningObjectives: concept.learningObjectives,
              codingPatterns: concept.codingPatterns,
              commonMistakes: concept.commonMistakes,
            },
            update: {
              curriculumVersionId: version.id,
              name: concept.name,
              description: concept.description,
              difficulty: concept.difficulty,
              orderIndex: index,
              learningObjectives: concept.learningObjectives,
              codingPatterns: concept.codingPatterns,
              commonMistakes: concept.commonMistakes,
              archivedAt: null,
            },
          });
          conceptIds.set(concept.slug, row.id);
        }

        const edgeCount = await this.persistEdges(tx, technology.slug, edges, conceptIds);
        const exerciseCount = await this.persistExercises(tx, exercises, conceptIds);
        const questionCount = await this.persistQuestions(tx, questions, conceptIds);
        const projectCount = await this.persistProjects(tx, projects, conceptIds);
        await this.persistSeedChallenges(tx, technology.slug, conceptIds);

        await tx.curriculumVersion.updateMany({
          where: { technologyId: technology.id, status: 'ACTIVE' },
          data: { status: 'SUPERSEDED' },
        });
        await tx.curriculumVersion.update({
          where: { id: version.id },
          data: { status: 'ACTIVE' },
        });
        await tx.technology.update({
          where: { id: technology.id },
          data: { curatedCurriculum: false },
        });

        return {
          conceptsCreated: concepts.length,
          exercisesCreated: exerciseCount,
          questionsCreated: questionCount,
          projectsCreated: projectCount,
          edgesCreated: edgeCount,
        };
      },
      // Generation writes a whole technology. The default 5s is for requests.
      { timeout: 120_000, maxWait: 10_000 },
    );
  }

  private async persistEdges(
    tx: Prisma.TransactionClient,
    technologySlug: string,
    edges: readonly { conceptSlug: string; prerequisiteSlug: string; strength: 'HARD' | 'SOFT' }[],
    conceptIds: ReadonlyMap<string, string>,
  ): Promise<number> {
    const resolved: { conceptId: string; prerequisiteId: string; strength: 'HARD' | 'SOFT' }[] = [];

    for (const edge of edges) {
      const conceptId = conceptIds.get(edge.conceptSlug);
      if (!conceptId) continue;

      const prerequisiteId = edge.prerequisiteSlug.includes(':')
        ? await this.resolveExternal(tx, edge.prerequisiteSlug)
        : conceptIds.get(edge.prerequisiteSlug);

      if (!prerequisiteId || prerequisiteId === conceptId) continue;
      resolved.push({ conceptId, prerequisiteId, strength: edge.strength });
    }

    // A cycle would make the routine planner non-terminating, so it must never
    // reach the database. Checked against the whole graph, not just this batch.
    const [allConcepts, existing] = await Promise.all([
      tx.concept.findMany({ select: { id: true, name: true, technologyId: true } }),
      tx.conceptPrerequisite.findMany({
        select: { conceptId: true, prerequisiteId: true, strength: true },
      }),
    ]);

    const nodes: GraphNode[] = allConcepts;
    const merged = new Map<string, GraphEdge>();
    for (const edge of [...existing, ...resolved]) {
      merged.set(`${edge.conceptId}->${edge.prerequisiteId}`, {
        conceptId: edge.conceptId,
        prerequisiteId: edge.prerequisiteId,
        strength: edge.strength as 'HARD' | 'SOFT',
      });
    }

    try {
      assertAcyclic(nodes, [...merged.values()]);
    } catch {
      // Drop the proposed edges rather than the technology. Outline order is
      // a perfectly usable fallback ordering.
      this.logger.warn(
        `${technologySlug}: proposed prerequisites introduce a cycle, dropping all ${resolved.length} edges`,
      );
      return 0;
    }

    for (const edge of resolved) {
      await tx.conceptPrerequisite.upsert({
        where: {
          conceptId_prerequisiteId: {
            conceptId: edge.conceptId,
            prerequisiteId: edge.prerequisiteId,
          },
        },
        create: edge,
        update: { strength: edge.strength },
      });
    }

    return resolved.length;
  }

  private async persistExercises(
    tx: Prisma.TransactionClient,
    exercises: ReadonlyMap<string, GeneratedExerciseOutput[]>,
    conceptIds: ReadonlyMap<string, string>,
  ): Promise<number> {
    let count = 0;

    for (const [conceptSlug, list] of exercises) {
      const conceptId = conceptIds.get(conceptSlug);
      if (!conceptId) continue;

      for (const exercise of list) {
        const isDebugging = exercise.kind === 'DEBUGGING';

        const row = await tx.exercise.upsert({
          where: { conceptId_slug: { conceptId, slug: exercise.slug } },
          create: {
            conceptId,
            slug: exercise.slug,
            title: exercise.title,
            kind: exercise.kind,
            difficulty: exercise.difficulty,
            language: 'javascript',
            objective: exercise.objective,
            requirements: exercise.requirements,
            functionSignature: exercise.functionSignature,
            // For a debugging exercise the broken code IS the problem, so it
            // lives in brokenCode and never in starterCode.
            starterCode: isDebugging ? null : exercise.starterCode,
            brokenCode: isDebugging ? exercise.starterCode : null,
            examples: exercise.examples,
            staticHints: exercise.staticHints,
            referenceSolution: exercise.referenceSolution,
            estimatedMinutes: exercise.estimatedMinutes,
          },
          update: {
            title: exercise.title,
            objective: exercise.objective,
            requirements: exercise.requirements,
            referenceSolution: exercise.referenceSolution,
            archivedAt: null,
          },
        });

        await tx.exerciseTestCase.deleteMany({ where: { exerciseId: row.id } });
        await tx.exerciseTestCase.createMany({
          data: exercise.testCases.map((testCase, index) => ({
            exerciseId: row.id,
            name: testCase.name,
            hidden: testCase.hidden,
            orderIndex: index,
            code: testCase.code,
          })),
        });

        count += 1;
      }
    }

    return count;
  }

  /**
   * A project is an Exercise of kind PROJECT with ProjectStep children.
   *
   * Reusing Exercise rather than adding a parallel model means attempts,
   * submissions, skill evidence and the roadmap all work on projects without
   * a second code path — and a second code path is where the assistance
   * ladder would eventually be forgotten.
   *
   * Test cases hang off the step, not the exercise, so the runner can select
   * "this step and every earlier one" with a single filter.
   */
  private async persistProjects(
    tx: Prisma.TransactionClient,
    projects: readonly AnchoredProject[],
    conceptIds: ReadonlyMap<string, string>,
  ): Promise<number> {
    let count = 0;

    for (const { conceptSlug, project } of projects) {
      const conceptId = conceptIds.get(conceptSlug);
      if (!conceptId) continue;

      const row = await tx.exercise.upsert({
        where: { conceptId_slug: { conceptId, slug: project.slug } },
        create: {
          conceptId,
          slug: project.slug,
          title: project.title,
          kind: 'PROJECT',
          difficulty: project.difficulty,
          language: 'javascript',
          objective: project.objective,
          requirements: project.requirements,
          // The reference solution for a project is its final step's.
          referenceSolution: project.steps[project.steps.length - 1]!.referenceSolution,
          estimatedMinutes: project.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0),
          staticHints: [],
          examples: [],
        },
        update: {
          title: project.title,
          objective: project.objective,
          requirements: project.requirements,
          difficulty: project.difficulty,
          referenceSolution: project.steps[project.steps.length - 1]!.referenceSolution,
          estimatedMinutes: project.steps.reduce((sum, step) => sum + step.estimatedMinutes, 0),
          archivedAt: null,
        },
      });

      // Replaced wholesale. Steps have no identity a user could hold a
      // reference to, and a regenerated project with mismatched old steps
      // would be unsolvable.
      await tx.exerciseTestCase.deleteMany({ where: { exerciseId: row.id } });
      await tx.projectStep.deleteMany({ where: { exerciseId: row.id } });

      for (const [index, step] of project.steps.entries()) {
        const stepRow = await tx.projectStep.create({
          data: {
            exerciseId: row.id,
            orderIndex: index,
            title: step.title,
            requirements: step.requirements,
            starterCode: step.starterCode,
            referenceSolution: step.referenceSolution,
            estimatedMinutes: step.estimatedMinutes,
          },
        });

        await tx.exerciseTestCase.createMany({
          data: step.testCases.map((testCase, testIndex) => ({
            exerciseId: row.id,
            stepId: stepRow.id,
            name: testCase.name,
            hidden: testCase.hidden,
            orderIndex: testIndex,
            code: testCase.code,
          })),
        });
      }

      count += 1;
    }

    return count;
  }

  /**
   * Attaches any hand-written Phase 9 challenges for this technology.
   *
   * These ship in the seed, but the seed can only attach them to concepts
   * that already exist — and for a technology whose curriculum is generated,
   * none do at seed time. Without this, a database reset silently loses
   * every challenge belonging to a generated technology: the seed skips
   * them, generation never adds them, and nothing reports a problem. All
   * five Linux terminal challenges disappeared exactly this way.
   *
   * Idempotent, so regenerating a technology re-attaches rather than
   * duplicating.
   */
  private async persistSeedChallenges(
    tx: Prisma.TransactionClient,
    technologySlug: string,
    conceptIds: ReadonlyMap<string, string>,
  ): Promise<number> {
    const challenges = challengesFor(technologySlug);
    if (challenges.length === 0) return 0;

    let attached = 0;

    for (const challenge of challenges) {
      // The generated curriculum will not use the slug the challenge was
      // written against, so fall back the way the seed does: the most
      // distinctive word, then the first concept. A challenge on a slightly
      // wrong concept is still worth doing; a missing one is not.
      const conceptId =
        conceptIds.get(challenge.conceptSlug) ?? nearestConcept(challenge.conceptSlug, conceptIds);

      if (!conceptId) continue;

      await tx.exercise.upsert({
        where: { conceptId_slug: { conceptId, slug: challenge.slug } },
        create: {
          conceptId,
          slug: challenge.slug,
          title: challenge.title,
          kind: challenge.spec.kind,
          difficulty: challenge.difficulty,
          // Not JavaScript: none of these is graded by running code.
          language: 'text',
          objective: challenge.objective,
          requirements: '',
          estimatedMinutes: challenge.estimatedMinutes,
          challengeSpec: challenge.spec as unknown as Prisma.InputJsonValue,
        },
        update: {
          title: challenge.title,
          objective: challenge.objective,
          challengeSpec: challenge.spec as unknown as Prisma.InputJsonValue,
          archivedAt: null,
        },
      });

      attached += 1;
    }

    if (attached > 0) {
      this.logger.log(`${technologySlug}: attached ${attached} Phase 9 challenges`);
    }

    return attached;
  }

  private async persistQuestions(
    tx: Prisma.TransactionClient,
    questions: ReadonlyMap<string, ConceptQuestionSetOutput['questions']>,
    conceptIds: ReadonlyMap<string, string>,
  ): Promise<number> {
    let count = 0;

    for (const [conceptSlug, list] of questions) {
      const conceptId = conceptIds.get(conceptSlug);
      if (!conceptId) continue;

      // Replaced wholesale: questions have no stable identity of their own,
      // and a stale one would keep asking about a concept that has since been
      // rewritten.
      await tx.conceptQuestion.deleteMany({ where: { conceptId } });
      await tx.conceptQuestion.createMany({
        data: list.map((question) => ({
          conceptId,
          prompt: question.prompt,
          options: question.options,
          correctIndex: question.correctIndex,
          explanation: question.explanation,
          difficulty: question.difficulty,
        })),
      });

      count += list.length;
    }

    return count;
  }

  // -- Lookups --------------------------------------------------------------

  private async otherTechnologyNames(userId: string, exclude: string): Promise<string[]> {
    const rows = await this.prisma.userTechnology.findMany({
      where: { userId, status: 'ACTIVE', technologyId: { not: exclude } },
      include: { technology: { select: { name: true } } },
    });
    return rows.map((r) => r.technology.name);
  }

  private async externalConcepts(userId: string, exclude: string) {
    const rows = await this.prisma.concept.findMany({
      where: {
        archivedAt: null,
        technologyId: { not: exclude },
        technology: { userTechnologies: { some: { userId, status: 'ACTIVE' } } },
      },
      select: { slug: true, name: true, technology: { select: { slug: true } } },
      // Enough for the model to find real cross-technology links without
      // burning the context window on a list it will not read.
      take: 60,
    });

    return rows.map((r) => ({
      qualifiedSlug: `${r.technology.slug}:${r.slug}`,
      name: r.name,
    }));
  }

  private async resolveExternal(
    tx: Prisma.TransactionClient,
    qualified: string,
  ): Promise<string | undefined> {
    const [technologySlug, conceptSlug] = qualified.split(':');
    if (!technologySlug || !conceptSlug) return undefined;

    const concept = await tx.concept.findFirst({
      where: { slug: conceptSlug, technology: { slug: technologySlug } },
      select: { id: true },
    });
    return concept?.id;
  }
}

/**
 * Best-effort concept match for a challenge whose intended slug is absent.
 *
 * Matches on the longest word in the intended slug, which is reliably the
 * distinctive one: "file-permissions" matches a generated "permissions" or
 * "linux-file-permissions". Falls back to the first concept rather than
 * dropping the challenge.
 */
function nearestConcept(
  conceptSlug: string,
  conceptIds: ReadonlyMap<string, string>,
): string | undefined {
  const keyword = conceptSlug.split('-').sort((a, b) => b.length - a.length)[0];

  if (keyword && keyword.length > 3) {
    for (const [slug, id] of conceptIds) {
      if (slug.includes(keyword)) return id;
    }
  }

  return conceptIds.values().next().value;
}

/** A verified project, with the concept it hangs off. */
interface AnchoredProject {
  conceptSlug: string;
  project: GeneratedProjectOutput;
}

interface DetailedConcept {
  slug: string;
  name: string;
  description: string;
  difficulty: number;
  learningObjectives: string[];
  codingPatterns: string[];
  commonMistakes: string[];
}
