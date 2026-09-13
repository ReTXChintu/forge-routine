import { Badge, Box, HStack, Heading, Spinner, Text, VStack } from '@chakra-ui/react';
import { FiCheck } from 'react-icons/fi';
import { useNavigate } from 'react-router-dom';

import { useChallenges, type ChallengeKind, type ChallengeSummary } from '~/lib/queries';

/**
 * Engineering challenges (§18-19).
 *
 * The three things a senior interview always reaches that a coding drill
 * cannot test: can you design a system, can you diagnose an outage, can you
 * operate a machine. None of them is graded by running your code.
 */

const KIND_LABEL: Record<ChallengeKind, string> = {
  SYSTEM_DESIGN: 'Design',
  INCIDENT: 'Incident',
  TERMINAL: 'Terminal',
};

const KIND_BLURB: Record<ChallengeKind, string> = {
  SYSTEM_DESIGN: 'Write the design. A reviewer names the gaps and leaves you to close them.',
  INCIDENT: 'Diagnose an outage from its telemetry. The cause is withheld until you commit.',
  TERMINAL: 'A simulated shell with a real task. Graded on the end state, not the commands.',
};

export function ChallengeList() {
  const { data: challenges, isLoading } = useChallenges();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  const groups: ChallengeKind[] = ['SYSTEM_DESIGN', 'INCIDENT', 'TERMINAL'];

  return (
    <Box>
      <Heading size="md" color="ink.100" mb={1}>
        Engineering
      </Heading>
      <Text fontSize="sm" color="ink.400" mb={8}>
        The parts of the job a coding exercise cannot reach.
      </Text>

      {(!challenges || challenges.length === 0) && (
        <Text fontSize="sm" color="ink.400">
          Nothing here yet. Challenges appear for the technologies you have taken on.
        </Text>
      )}

      <VStack align="stretch" spacing={9}>
        {groups.map((kind) => {
          const inGroup = challenges?.filter((challenge) => challenge.kind === kind) ?? [];
          if (inGroup.length === 0) return null;

          return (
            <Box key={kind}>
              <Heading size="xs" color="ink.200" mb={1}>
                {KIND_LABEL[kind]}
              </Heading>
              <Text fontSize="xs" color="ink.500" mb={3}>
                {KIND_BLURB[kind]}
              </Text>

              <VStack align="stretch" spacing={2}>
                {inGroup.map((challenge) => (
                  <ChallengeRow
                    key={challenge.exerciseId}
                    challenge={challenge}
                    onOpen={() => navigate(`/challenge/${challenge.exerciseId}`)}
                  />
                ))}
              </VStack>
            </Box>
          );
        })}
      </VStack>
    </Box>
  );
}

function ChallengeRow({ challenge, onOpen }: { challenge: ChallengeSummary; onOpen: () => void }) {
  return (
    <HStack
      borderWidth="1px"
      borderColor="surface.300"
      borderRadius="md"
      bg="surface.50"
      px={4}
      py={3}
      spacing={4}
      align="flex-start"
      cursor="pointer"
      onClick={onOpen}
      _hover={{ borderColor: 'forge.500' }}
    >
      <Box flex="1" minW={0}>
        <HStack spacing={2} mb={0.5}>
          <Text fontSize="sm" fontWeight={500} color="ink.100">
            {challenge.title}
          </Text>
          {challenge.completed && <Box as={FiCheck} color="pass" fontSize="sm" />}
        </HStack>
        <Text fontSize="xs" color="ink.400">
          {challenge.objective}
        </Text>
      </Box>

      <VStack align="flex-end" spacing={1} flexShrink={0}>
        <Badge bg="surface.300" color="ink.400" fontSize="xs">
          {challenge.technologyName}
        </Badge>
        <Text fontSize="xs" color="ink.500">
          {challenge.estimatedMinutes}m · difficulty {challenge.difficulty}
        </Text>
      </VStack>
    </HStack>
  );
}
