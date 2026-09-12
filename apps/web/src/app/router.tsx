import { Navigate, createBrowserRouter } from 'react-router-dom';

import { AuthScreen } from '~/features/auth/AuthScreen';
import { ConceptView } from '~/features/concepts/ConceptView';
import { Dashboard } from '~/features/dashboard/Dashboard';
import { ExerciseWorkspace } from '~/features/exercise/ExerciseWorkspace';
import { Technologies } from '~/features/technologies/Technologies';
import { TechnologyView } from '~/features/technologies/TechnologyView';
import { tokenStore } from '~/lib/api';

import { AppShell } from './AppShell';

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
    path: '/',
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: 'technologies', element: <Technologies /> },
      { path: 'technology/:technologyId', element: <TechnologyView /> },
      { path: 'concept/:conceptId', element: <ConceptView /> },
      { path: 'exercise/:exerciseId', element: <ExerciseWorkspace /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
