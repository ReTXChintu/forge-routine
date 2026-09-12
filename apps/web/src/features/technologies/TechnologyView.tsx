import { Box, HStack, Heading, Spinner, Text, VStack } from '@chakra-ui/react';
import { useNavigate, useParams } from 'react-router-dom';

import { useConcepts } from '~/lib/queries';

/** Concepts for one technology, in learning order. */
export function TechnologyView() {
  const { technologyId } = useParams<{ technologyId: string }>();
  const { data: concepts, isLoading } = useConcepts(technologyId);
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  return (
    <Box maxW="860px" mx="auto" px={6} py={8}>
      <Heading size="lg" mb={6} fontWeight={650}>
        Concepts
      </Heading>

      {(concepts ?? []).length === 0 ? (
        <Text fontSize="sm" color="ink.500">
          The curriculum for this technology has not been generated yet.
        </Text>
      ) : (
        <VStack align="stretch" spacing={2}>
          {(concepts ?? []).map((concept, index) => (
            <HStack
              key={concept.id}
              bg="surface.100"
              borderWidth="1px"
              borderColor="surface.300"
              borderRadius="md"
              px={4}
              py={3}
              spacing={4}
              _hover={{ borderColor: 'surface.400' }}
              cursor="pointer"
              onClick={() => navigate(`/concept/${concept.id}`)}
            >
              <Text fontSize="sm" color="ink.500" fontFamily="mono" w="24px">
                {String(index + 1).padStart(2, '0')}
              </Text>
              <Box flex="1" minW={0}>
                <Text fontSize="sm" color="ink.100" fontWeight={600}>
                  {concept.name}
                </Text>
                <Text fontSize="xs" color="ink.500" noOfLines={1}>
                  {concept.description}
                </Text>
              </Box>
              <Text fontSize="xs" color="ink.500" fontFamily="mono">
                L{concept.difficulty}
              </Text>
            </HStack>
          ))}
        </VStack>
      )}
    </Box>
  );
}
