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
  overview: ['progress', 'overview'] as const,
  independence: ['progress', 'independence'] as const,
  weakest: ['skills', 'weakest'] as const,
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
