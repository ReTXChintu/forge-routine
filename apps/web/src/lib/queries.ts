import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import type {
  Concept,
  DashboardOverview,
  ExerciseView,
  HintKind,
  HintResponse,
  IndependentCodingScore,
  LearningSession,
  StartAttemptResponse,
  SubmissionResponse,
  Technology,
  UserTechnology,
  WeakSkill,
} from '@forgeroutine/shared-types';

import { apiRequest, tokenStore } from './api.js';

/**
 * One place for every server interaction, so cache invalidation is decided here
 * rather than scattered through components (§45.4).
 */

export const queryKeys = {
  me: ['me'] as const,
  catalogue: (search?: string) => ['technologies', 'catalogue', search ?? ''] as const,
  myTechnologies: ['technologies', 'mine'] as const,
  concepts: (technologyId: string) => ['concepts', technologyId] as const,
  conceptDetail: (id: string) => ['concepts', 'detail', id] as const,
  exercises: (conceptId: string) => ['exercises', conceptId] as const,
  exercise: (id: string) => ['exercises', 'detail', id] as const,
  onboardingStatus: ['onboarding', 'status'] as const,
  roadmap: ['roadmap'] as const,
  generation: ['generation', 'status'] as const,
  overview: ['progress', 'overview'] as const,
  independence: ['progress', 'independence'] as const,
  weakest: ['skills', 'weakest'] as const,
  project: (exerciseId: string) => ['projects', exerciseId] as const,
  recallDue: ['recall', 'due'] as const,
  routineToday: ['routines', 'today'] as const,
  interviewGuide: ['interviews', 'guide'] as const,
  interviews: ['interviews', 'history'] as const,
  interview: (id: string) => ['interviews', 'detail', id] as const,
  interviewReport: (id: string) => ['interviews', 'report', id] as const,
};

// -- Auth --------------------------------------------------------------------

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export function useRegister() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { email: string; password: string; displayName: string }) =>
      apiRequest<AuthTokens>('/auth/register', { method: 'POST', body: input }),
    onSuccess: (tokens) => {
      tokenStore.set(tokens.accessToken, tokens.refreshToken);
      void queryClient.invalidateQueries();
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      apiRequest<AuthTokens>('/auth/login', { method: 'POST', body: input }),
    onSuccess: (tokens) => {
      tokenStore.set(tokens.accessToken, tokens.refreshToken);
      void queryClient.invalidateQueries();
    },
  });
}

// -- Onboarding and roadmap ---------------------------------------------------

export interface OnboardingStatus {
  completed: boolean;
  technologyCount: number;
  awaitingContent: boolean;
  hasRoadmap: boolean;
}

export interface RoadmapItemView {
  id: string;
  kind: string;
  status: string;
  title: string;
  rationale: string;
  estimatedMinutes: number;
  conceptId: string | null;
  exerciseId: string | null;
}

export interface RoadmapPhaseView {
  id: string;
  orderIndex: number;
  title: string;
  goal: string;
  estimatedMinutes: number;
  items: RoadmapItemView[];
  doneCount: number;
}

export interface RoadmapView {
  id: string;
  version: number;
  status: string;
  generatedBy: string;
  totalMinutes: number;
  completedMinutes: number;
  phases: RoadmapPhaseView[];
  currentItemId: string | null;
}

export interface CompleteOnboardingBody {
  technologies: {
    technologyId?: string;
    name?: string;
    existingKnowledge?: number | null;
    interviewImportance?: number;
  }[];
  dailyMinutes: number;
  primaryGoal: string;
  interviewTarget: string;
  interviewDate: string | null;
}

export function useOnboardingStatus(): UseQueryResult<OnboardingStatus> {
  return useQuery({
    queryKey: queryKeys.onboardingStatus,
    queryFn: () => apiRequest<OnboardingStatus>('/onboarding/status'),
    // The first-run redirect depends on this, so a stale answer would bounce
    // the user back into onboarding they have already finished.
    staleTime: 0,
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CompleteOnboardingBody) =>
      apiRequest<{ roadmap: RoadmapView; awaitingTechnologies: string[] }>('/onboarding/complete', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => {
      // Onboarding writes technologies, preferences and a roadmap in one go.
      void queryClient.invalidateQueries();
    },
  });
}

export function useRoadmap(): UseQueryResult<RoadmapView | null> {
  return useQuery({
    queryKey: queryKeys.roadmap,
    queryFn: async () => {
      const result = await apiRequest<RoadmapView | null>('/roadmap');
      // An empty body means no roadmap yet, not an empty roadmap.
      return result && Object.keys(result).length > 0 ? result : null;
    },
  });
}

export function useRegenerateRoadmap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiRequest<RoadmapView>('/roadmap/regenerate', { method: 'POST' }),
    onSuccess: (roadmap) => {
      queryClient.setQueryData(queryKeys.roadmap, roadmap);
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useUpdateRoadmapItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest<RoadmapItemView>(`/roadmap/items/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roadmap });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export interface GenerationJobView {
  id: string;
  kind: string;
  target: string;
  technologyName: string | null;
  status: string;
  progress: number;
  step: string;
  error: string | null;
}

export interface GenerationStatusView {
  active: boolean;
  partial: boolean;
  jobs: GenerationJobView[];
}

/**
 * Polls while curriculum is generating, and stops as soon as it is not.
 *
 * The roadmap changes underneath the user when a technology finishes, so this
 * also drives the invalidation — otherwise they would sit looking at a
 * "preparing" placeholder that is already ready.
 */
export function useGenerationStatus(enabled = true): UseQueryResult<GenerationStatusView> {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.generation,
    queryFn: async () => {
      const status = await apiRequest<GenerationStatusView>('/generation/status');

      // A job that just finished means new concepts and exercises exist.
      if (!status.active && status.jobs.some((j) => j.status === 'READY')) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.roadmap });
        void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      }

      return status;
    },
    enabled,
    // Generation takes minutes, so a tight poll is pure noise. Stops entirely
    // once nothing is running.
    refetchInterval: (query) => (query.state.data?.active ? 5_000 : false),
    staleTime: 0,
  });
}

export function useRetryGeneration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiRequest<GenerationJobView[]>('/generation/retry', { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.generation });
    },
  });
}

// -- Technologies ------------------------------------------------------------

export function useCatalogue(search?: string): UseQueryResult<Technology[]> {
  return useQuery({
    queryKey: queryKeys.catalogue(search),
    queryFn: () =>
      apiRequest<Technology[]>(
        `/technologies${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      ),
  });
}

export function useMyTechnologies(): UseQueryResult<UserTechnology[]> {
  return useQuery({
    queryKey: queryKeys.myTechnologies,
    queryFn: () => apiRequest<UserTechnology[]>('/technologies/mine'),
  });
}

export function useAddTechnology() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { technologyId?: string; name?: string }) =>
      apiRequest<UserTechnology>('/technologies/mine', { method: 'POST', body: input }),
    onSuccess: () => {
      // Adding a technology imports its curriculum, so concepts and the
      // dashboard's next action both change.
      void queryClient.invalidateQueries({ queryKey: queryKeys.myTechnologies });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

export function useArchiveTechnology() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiRequest<void>(`/technologies/mine/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myTechnologies });
    },
  });
}

// -- Concepts ----------------------------------------------------------------

export function useConcepts(technologyId: string | undefined): UseQueryResult<Concept[]> {
  return useQuery({
    queryKey: queryKeys.concepts(technologyId ?? ''),
    queryFn: () => apiRequest<Concept[]>(`/concepts?technologyId=${technologyId}`),
    enabled: Boolean(technologyId),
  });
}

export interface ConceptDetail extends Concept {
  technologyName: string;
  prerequisites: { conceptId: string; name: string; strength: 'HARD' | 'SOFT' }[];
  readiness: {
    unlocked: boolean;
    score: number;
    blockingConceptIds: string[];
    advisoryConceptIds: string[];
  };
  skill: Record<string, number> | null;
  exerciseCount: number;
}

export function useConceptDetail(id: string | undefined): UseQueryResult<ConceptDetail> {
  return useQuery({
    queryKey: queryKeys.conceptDetail(id ?? ''),
    queryFn: () => apiRequest<ConceptDetail>(`/concepts/${id}`),
    enabled: Boolean(id),
  });
}

// -- Exercises ---------------------------------------------------------------

export function useExercises(conceptId: string | undefined): UseQueryResult<ExerciseView[]> {
  return useQuery({
    queryKey: queryKeys.exercises(conceptId ?? ''),
    queryFn: () => apiRequest<ExerciseView[]>(`/exercises?conceptId=${conceptId}`),
    enabled: Boolean(conceptId),
  });
}

export function useExercise(id: string | undefined): UseQueryResult<ExerciseView> {
  return useQuery({
    queryKey: queryKeys.exercise(id ?? ''),
    queryFn: () => apiRequest<ExerciseView>(`/exercises/${id}`),
    enabled: Boolean(id),
  });
}

export function useStartAttempt() {
  return useMutation({
    mutationFn: ({ exerciseId, blindMode }: { exerciseId: string; blindMode: boolean }) =>
      apiRequest<StartAttemptResponse>(`/exercises/${exerciseId}/attempts`, {
        method: 'POST',
        body: { blindMode },
      }),
  });
}

export function useMarkFirstCode() {
  return useMutation({
    mutationFn: (attemptId: string) =>
      apiRequest<void>(`/exercises/attempts/${attemptId}/first-code`, { method: 'POST' }),
  });
}

// -- Submissions -------------------------------------------------------------

export function useSubmitCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: {
      attemptId: string;
      code: string;
      language: 'javascript' | 'typescript';
      /** DEBUGGING exercises only: graded separately from the fix (§13). */
      diagnosis?: string;
      clientSignals?: { keystrokeCount?: number; largePasteEvents?: number };
    }) =>
      apiRequest<SubmissionResponse>('/submissions', {
        method: 'POST',
        body: input,
        // A double-clicked submit must not create two attempts.
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.independence });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weakest });
    },
  });
}

// -- AI assistance -----------------------------------------------------------

export function useRequestHint() {
  return useMutation({
    mutationFn: (input: {
      attemptId: string;
      kind: HintKind;
      code?: string;
      lastError?: string;
      overrideGate?: boolean;
    }) => apiRequest<HintResponse>('/ai/hint', { method: 'POST', body: input }),
  });
}

// -- Sessions ----------------------------------------------------------------

export function useStartSession() {
  return useMutation({
    mutationFn: (input: { conceptId?: string }) =>
      apiRequest<LearningSession>('/sessions', { method: 'POST', body: input }),
  });
}

// -- Progress ----------------------------------------------------------------

export function useOverview(): UseQueryResult<DashboardOverview> {
  return useQuery({
    queryKey: queryKeys.overview,
    queryFn: () => apiRequest<DashboardOverview>('/progress/overview'),
  });
}

export function useIndependence(): UseQueryResult<IndependentCodingScore> {
  return useQuery({
    queryKey: queryKeys.independence,
    queryFn: () => apiRequest<IndependentCodingScore>('/progress/independence'),
  });
}

export function useWeakestSkills(): UseQueryResult<WeakSkill[]> {
  return useQuery({
    queryKey: queryKeys.weakest,
    queryFn: () => apiRequest<WeakSkill[]>('/skills/weakest'),
  });
}

// -- Projects ----------------------------------------------------------------

export interface ProjectStepView {
  index: number;
  title: string;
  requirements: string;
  estimatedMinutes: number;
  status: 'LOCKED' | 'CURRENT' | 'DONE';
  starterCode: string | null;
  visibleTestNames: string[];
}

export interface ProjectView {
  exerciseId: string;
  attemptId: string | null;
  title: string;
  objective: string;
  requirements: string;
  language: string;
  currentStep: number;
  steps: ProjectStepView[];
}

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'nit';
  category: string;
  title: string;
  explanation: string;
  line: number | null;
}

export interface StepSubmissionResult {
  passed: boolean;
  testsPassed: number;
  testsTotal: number;
  cases: { name: string; passed: boolean; error?: string }[];
  review: { summary: string; issues: ReviewIssue[] } | null;
  advanced: boolean;
  projectComplete: boolean;
  checkpointFailed: boolean;
}

export function useProject(exerciseId: string | undefined): UseQueryResult<ProjectView> {
  return useQuery({
    queryKey: queryKeys.project(exerciseId ?? ''),
    queryFn: () => apiRequest<ProjectView>(`/projects/${exerciseId}`),
    enabled: Boolean(exerciseId),
  });
}

export function useStartProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (exerciseId: string) =>
      apiRequest<ProjectView>(`/projects/${exerciseId}/start`, { method: 'POST' }),
    onSuccess: (project) => {
      queryClient.setQueryData(queryKeys.project(project.exerciseId), project);
    },
  });
}

export function useSubmitProjectStep() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { exerciseId: string; attemptId: string; code: string }) =>
      apiRequest<StepSubmissionResult>('/projects/steps/submit', {
        method: 'POST',
        body: { attemptId: input.attemptId, code: input.code },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (_result, input) => {
      // The step may have unlocked, which changes what the workspace shows.
      void queryClient.invalidateQueries({ queryKey: queryKeys.project(input.exerciseId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
      void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
    },
  });
}

// -- Recall ------------------------------------------------------------------

export interface RecallPromptView {
  id: string;
  conceptId: string;
  conceptName: string;
  technologyName: string;
  prompt: string;
  options: string[];
}

export interface RecallAnswerResult {
  correct: boolean;
  correctIndex: number;
  explanation: string;
  nextDueAt: string;
}

/**
 * Prompts that are due.
 *
 * Fetched eagerly so a boundary can surface one without a spinner, but never
 * rendered during coding — that is the caller's responsibility and the whole
 * reason this is a separate hook rather than a global popup.
 */
export function useRecallDue(enabled = true): UseQueryResult<RecallPromptView[]> {
  return useQuery({
    queryKey: queryKeys.recallDue,
    queryFn: () => apiRequest<RecallPromptView[]>('/recall/due'),
    enabled,
    staleTime: 60_000,
  });
}

export function useAnswerRecall() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { questionId: string; selectedIndex: number }) =>
      apiRequest<RecallAnswerResult>('/recall/answer', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.recallDue });
      void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weakest });
    },
  });
}

// -- Routines ----------------------------------------------------------------

export interface RoutineItemView {
  id: string;
  kind: string;
  status: string;
  minutes: number;
  title: string;
  rationale: string;
  conceptId: string | null;
  exerciseId: string | null;
}

export interface RoutineView {
  id: string;
  date: string;
  totalMinutes: number;
  completedMinutes: number;
  items: RoutineItemView[];
  recallDue: number;
}

export function useTodayRoutine(): UseQueryResult<RoutineView | null> {
  return useQuery({
    queryKey: queryKeys.routineToday,
    queryFn: async () => {
      const result = await apiRequest<RoutineView | null>('/routines/today');
      // No routine generated yet reads as an empty body, not an empty routine.
      return result && Object.keys(result).length > 0 ? result : null;
    },
  });
}

export function useGenerateRoutine() {
  const queryClient = useQueryClient();

  return useMutation({
    // Typed explicitly: a defaulted parameter infers TVariables as void, and
    // callers could then no longer pass the flag at all.
    mutationFn: (force: boolean) =>
      apiRequest<RoutineView>(force ? '/routines/regenerate' : '/routines/generate', {
        method: 'POST',
      }),
    onSuccess: (routine) => {
      queryClient.setQueryData(queryKeys.routineToday, routine);
    },
  });
}

export function useUpdateRoutineItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiRequest<RoutineItemView>(`/routines/items/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.routineToday });
      void queryClient.invalidateQueries({ queryKey: queryKeys.overview });
    },
  });
}

// -- Interviews --------------------------------------------------------------

export interface InterviewTurnView {
  questionId: string;
  orderIndex: number;
  prompt: string;
  conceptName: string | null;
  answer: string | null;
}

export interface InterviewView {
  id: string;
  mode: string;
  targetLevel: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  turns: InterviewTurnView[];
  currentQuestion: { id: string; prompt: string } | null;
  turnsRemaining: number;
}

export interface InterviewReportView {
  overallScore: number | null;
  dimensions: Record<string, number | null>;
  strongAreas: string[];
  weakAreas: string[];
  recommendedTopics: string[];
  summary: string | null;
  degraded: boolean;
}

export interface InterviewSummaryView {
  id: string;
  mode: string;
  targetLevel: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  questionCount: number;
  overallScore: number | null;
}

export interface GuideTopic {
  conceptId: string;
  name: string;
  description: string;
  readiness: number | null;
  weakestDimension: string | null;
  likelyProbes: string[];
  commonMistakes: string[];
  status: 'STRONG' | 'SHAKY' | 'WEAK' | 'UNPRACTISED';
}

export interface GuideTechnology {
  technologyId: string;
  name: string;
  slug: string;
  interviewImportance: number;
  readiness: number | null;
  topics: GuideTopic[];
}

export interface InterviewGuideView {
  overallReadiness: number | null;
  technologies: GuideTechnology[];
  priorities: { title: string; reason: string; conceptId: string | null }[];
  recurringWeaknesses: string[];
  interviewsTaken: number;
  lastInterviewAt: string | null;
}

export function useInterviewGuide(): UseQueryResult<InterviewGuideView> {
  return useQuery({
    queryKey: queryKeys.interviewGuide,
    queryFn: () => apiRequest<InterviewGuideView>('/interviews/guide'),
  });
}

export function useInterviewHistory(): UseQueryResult<InterviewSummaryView[]> {
  return useQuery({
    queryKey: queryKeys.interviews,
    queryFn: () => apiRequest<InterviewSummaryView[]>('/interviews'),
  });
}

export function useInterview(id: string | undefined): UseQueryResult<InterviewView> {
  return useQuery({
    queryKey: queryKeys.interview(id ?? ''),
    queryFn: () => apiRequest<InterviewView>(`/interviews/${id}`),
    enabled: Boolean(id),
  });
}

export function useStartInterview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { mode: string; targetLevel: string }) =>
      apiRequest<InterviewView>('/interviews', { method: 'POST', body: input }),
    onSuccess: (interview) => {
      queryClient.setQueryData(queryKeys.interview(interview.id), interview);
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviews });
    },
  });
}

export function useAnswerInterview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { interviewId: string; questionId: string; text: string }) =>
      apiRequest<InterviewView>(`/interviews/${input.interviewId}/answer`, {
        method: 'POST',
        body: { questionId: input.questionId, text: input.text },
        // The next question costs a model call; a double submit must not
        // burn two of them or desynchronise the transcript.
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (interview) => {
      queryClient.setQueryData(queryKeys.interview(interview.id), interview);
    },
  });
}

export function useEndInterview() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (interviewId: string) =>
      apiRequest<InterviewReportView>(`/interviews/${interviewId}/end`, { method: 'POST' }),
    onSuccess: (report, interviewId) => {
      queryClient.setQueryData(queryKeys.interviewReport(interviewId), report);
      void queryClient.invalidateQueries({ queryKey: queryKeys.interview(interviewId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviewGuide });
      void queryClient.invalidateQueries({ queryKey: queryKeys.interviews });
      void queryClient.invalidateQueries({ queryKey: queryKeys.weakest });
    },
  });
}

export function useInterviewReport(id: string | undefined): UseQueryResult<InterviewReportView> {
  return useQuery({
    queryKey: queryKeys.interviewReport(id ?? ''),
    queryFn: () => apiRequest<InterviewReportView>(`/interviews/${id}/report`),
    enabled: Boolean(id),
  });
}
