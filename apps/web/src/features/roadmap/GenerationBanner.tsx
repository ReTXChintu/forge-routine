import { Box, Button, HStack, Progress, Spinner, Text, VStack } from '@chakra-ui/react';
import { FiAlertTriangle, FiCheck } from 'react-icons/fi';

import { useGenerationStatus, useRetryGeneration } from '~/lib/queries';

/**
 * Shows what is still being prepared (docs/learning-path.md).
 *
 * Deliberately a banner rather than a blocking screen. Four of six
 * technologies generated is usable, and gating the whole roadmap behind the
 * slowest one would be both a lie and a worse product — the user can start
 * phase one while the last technology is still being written.
 */
export function GenerationBanner({ enabled = true }: { enabled?: boolean }) {
  const { data } = useGenerationStatus(enabled);
  const retry = useRetryGeneration();

  if (!data) return null;

  const running = data.jobs.filter((j) => j.status === 'RUNNING' || j.status === 'QUEUED');
  const failed = data.jobs.filter((j) => j.status === 'FAILED');

  if (running.length === 0 && failed.length === 0) return null;

  return (
    <VStack align="stretch" spacing={2} mb={6}>
      {running.length > 0 && (
        <Box
          bg="surface.100"
          borderWidth="1px"
          borderColor="forge.700"
          borderRadius="lg"
          px={4}
          py={3}
        >
          <HStack spacing={3} align="flex-start">
            <Spinner size="sm" color="forge.500" mt="2px" />

            <Box flex="1" minW={0}>
              <Text fontSize="sm" fontWeight={600} color="ink.100">
                Preparing {running.length === 1 ? '1 technology' : `${running.length} technologies`}
              </Text>
              <Text fontSize="xs" color="ink.400" mt={0.5}>
                {/* Says what is usable now, not just what is missing. */}
                This runs in the background and takes a few minutes. Anything already prepared is
                ready to start — come back shortly for the rest.
              </Text>

              <VStack align="stretch" spacing={2} mt={3}>
                {running.map((job) => (
                  <Box key={job.id}>
                    <HStack justify="space-between" mb={1}>
                      <Text fontSize="xs" color="ink.300">
                        {job.technologyName ?? 'Technology'}
                      </Text>
                      <Text fontSize="xs" color="ink.500" fontFamily="mono">
                        {job.status === 'QUEUED' ? 'queued' : `${job.progress}%`}
                      </Text>
                    </HStack>
                    <Progress
                      value={job.status === 'QUEUED' ? 0 : job.progress}
                      size="xs"
                      borderRadius="sm"
                      sx={{ '& > div': { bg: 'forge.500' } }}
                    />
                    {job.step && (
                      <Text fontSize="xs" color="ink.500" mt={1}>
                        {job.step}
                      </Text>
                    )}
                  </Box>
                ))}
              </VStack>
            </Box>
          </HStack>
        </Box>
      )}

      {failed.map((job) => (
        <Box
          key={job.id}
          bg="surface.100"
          borderWidth="1px"
          borderColor="surface.300"
          borderLeftWidth="2px"
          borderLeftColor="warn"
          borderRadius="lg"
          px={4}
          py={3}
        >
          <HStack spacing={3} align="flex-start">
            <Box as={FiAlertTriangle} color="warn" mt="3px" flexShrink={0} />
            <Box flex="1" minW={0}>
              <Text fontSize="sm" fontWeight={600} color="ink.100">
                {job.technologyName ?? 'A technology'} could not be prepared
              </Text>
              {/* The real reason, not a generic apology. */}
              <Text fontSize="xs" color="ink.400" mt={0.5}>
                {job.error ?? 'Generation failed.'}
              </Text>
            </Box>
            <Button
              size="xs"
              variant="outline"
              isLoading={retry.isPending}
              onClick={() => retry.mutate()}
            >
              Try again
            </Button>
          </HStack>
        </Box>
      ))}

      {data.partial && (
        <HStack spacing={2} px={1}>
          <Box as={FiCheck} color="pass" boxSize="12px" />
          <Text fontSize="xs" color="ink.500">
            Some technologies are ready — you can start those now.
          </Text>
        </HStack>
      )}
    </VStack>
  );
}
