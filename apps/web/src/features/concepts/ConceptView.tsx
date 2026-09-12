import {
  Alert, AlertIcon, Badge, Box, Button, HStack, Heading, Spinner, Text, VStack,
} from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';

import { useConceptDetail, useExercises } from '~/lib/queries';

/**
 * A concept and its exercises.
 *
 * Readiness is surfaced honestly: a locked concept says which prerequisite is
 * blocking it, and a soft gap is shown as advice rather than a wall.
 */
export function ConceptView() {
  const { conceptId } = useParams<{ conceptId: string }>();
  const { data: concept, isLoading } = useConceptDetail(conceptId);
  const { data: exercises } = useExercises(conceptId);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  if (!concept) return null;

  return (
    <Box maxW="860px" mx="auto" px={6} py={8}>
      <Text fontSize="xs" color="ink.500" letterSpacing="0.06em" mb={1}>
        {concept.technologyName.toUpperCase()}
      </Text>
      <Heading size="lg" mb={2} fontWeight={650}>
        {concept.name}
      </Heading>
      <Text fontSize="sm" color="ink.300" mb={6}>
        {concept.description}
      </Text>

      {!concept.readiness.unlocked && (
        <Alert status="warning" bg="surface.200" borderRadius="md" mb={6} fontSize="sm">
          <AlertIcon color="warn" />
          <Box>
            <Text fontWeight={600}>Prerequisite not met</Text>
            <Text color="ink.300">
              {concept.prerequisites
                .filter((p) => concept.readiness.blockingConceptIds.includes(p.conceptId))
                .map((p) => p.name)
                .join(', ')}{' '}
              needs to be stronger first.
            </Text>
          </Box>
        </Alert>
      )}

      {concept.learningObjectives.length > 0 && (
        <Section title="You should be able to">
          {concept.learningObjectives.map((objective) => (
            <Text key={objective} fontSize="sm" color="ink.300">
              • {objective}
            </Text>
          ))}
        </Section>
      )}

      {concept.commonMistakes.length > 0 && (
        <Section title="Common mistakes">
          {concept.commonMistakes.map((mistake) => (
            <Text key={mistake} fontSize="sm" color="ink.300">
              • {mistake}
            </Text>
          ))}
        </Section>
      )}

      {concept.prerequisites.length > 0 && (
        <Section title="Builds on">
          <HStack spacing={2} flexWrap="wrap">
            {concept.prerequisites.map((prereq) => (
              <Badge
                key={prereq.conceptId}
                bg="surface.300"
                color="ink.300"
                fontSize="xs"
                px={2}
                py={1}
                cursor="pointer"
                onClick={() => navigate(`/concept/${prereq.conceptId}`)}
              >
                {prereq.name}
                {prereq.strength === 'SOFT' && ' (helps)'}
              </Badge>
            ))}
          </HStack>
        </Section>
      )}

      <Section title="Exercises">
        {(exercises ?? []).length === 0 ? (
          <Text fontSize="sm" color="ink.500">
            No exercises yet for this concept.
          </Text>
        ) : (
          <VStack align="stretch" spacing={2}>
            {(exercises ?? []).map((exercise) => (
              <HStack
                key={exercise.id}
                bg="surface.100"
                borderWidth="1px"
                borderColor="surface.300"
                borderRadius="md"
                px={4}
                py={3}
                _hover={{ borderColor: 'surface.400' }}
                cursor="pointer"
                onClick={() => navigate(`/exercise/${exercise.id}`)}
              >
                <Box flex="1" minW={0}>
                  <Text fontSize="sm" color="ink.100" fontWeight={600}>
                    {exercise.title}
                  </Text>
                  <Text fontSize="xs" color="ink.500">
                    Level {exercise.assistanceLevel} · {exercise.estimatedMinutes} min
                  </Text>
                </Box>
                <Button size="xs" variant="outline">
                  Open
                </Button>
              </HStack>
            ))}
          </VStack>
        )}
      </Section>
    </Box>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box mb={6}>
      <Text fontSize="xs" color="ink.400" letterSpacing="0.06em" mb={2}>
        {title.toUpperCase()}
      </Text>
      {children}
    </Box>
  );
}
