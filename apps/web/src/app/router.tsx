import { Navigate, createBrowserRouter } from 'react-router-dom';

import { AuthScreen } from '~/features/auth/AuthScreen';
import { ChallengeList } from '~/features/challenges/ChallengeList';
import { ChallengeWorkspace } from '~/features/challenges/ChallengeWorkspace';
import { ConceptView } from '~/features/concepts/ConceptView';
import { Dashboard } from '~/features/dashboard/Dashboard';
import { ExerciseWorkspace } from '~/features/exercise/ExerciseWorkspace';
import { InterviewGuide } from '~/features/interview/InterviewGuide';
import { InterviewSession } from '~/features/interview/InterviewSession';
import { Onboarding } from '~/features/onboarding/Onboarding';
import { ProjectWorkspace } from '~/features/project/ProjectWorkspace';
import { RoadmapPage } from '~/features/roadmap/RoadmapView';
import { TodayView } from '~/features/routine/TodayView';
import { Technologies } from '~/features/technologies/Technologies';
import { TechnologyView } from '~/features/technologies/TechnologyView';
import { tokenStore } from '~/lib/api';

import { AppShell } from './AppShell';
import { RequireOnboarding } from './RequireOnboarding';

function RequireAuth({ children }: { children: React.ReactNode }) {
  // A soft gate only. The API is the actual authority on every request; this
  // exists so an unauthenticated visitor sees the sign-in screen rather than a
  // dashboard that fails to load.
  if (!tokenStore.access) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <AuthScreen /> },
  {
    // Outside the shell: onboarding is full-bleed and has no navigation to
    // wander off into.
    path: '/onboarding',
    element: (
      <RequireAuth>
        <Onboarding />
      </RequireAuth>
    ),
  },
  {
    path: '/',
    element: (
      <RequireAuth>
        <RequireOnboarding>
          <AppShell />
        </RequireOnboarding>
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'today', element: <TodayView /> },
      { path: 'roadmap', element: <RoadmapPage /> },
      { path: 'technologies', element: <Technologies /> },
      { path: 'technology/:technologyId', element: <TechnologyView /> },
      { path: 'concept/:conceptId', element: <ConceptView /> },
      { path: 'exercise/:exerciseId', element: <ExerciseWorkspace /> },
      { path: 'project/:exerciseId', element: <ProjectWorkspace /> },
      { path: 'engineering', element: <ChallengeList /> },
      { path: 'challenge/:exerciseId', element: <ChallengeWorkspace /> },
      { path: 'interview', element: <InterviewGuide /> },
      { path: 'interview/:interviewId', element: <InterviewSession /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
