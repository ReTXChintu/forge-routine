import { HStack, Spinner } from '@chakra-ui/react';
import { Navigate, useLocation } from 'react-router-dom';

import { useOnboardingStatus } from '~/lib/queries';

/**
 * Sends a user who has never onboarded to the first-run flow.
 *
 * Deliberately fails *open*: if the status call errors, the app renders
 * normally rather than trapping the user in onboarding. A broken network
 * should not look like a broken account, and the API is the real authority on
 * every request regardless.
 */
export function RequireOnboarding({ children }: { children: React.ReactNode }) {
  const { data, isLoading, isError } = useOnboardingStatus();
  const location = useLocation();

  if (location.pathname === '/onboarding') return <>{children}</>;

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  if (!isError && data && !data.completed) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
