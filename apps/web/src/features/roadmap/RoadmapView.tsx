import {
  Badge,
  Box,
  Button,
  HStack,
  Heading,
  Icon,
  Progress,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react';
import { FiCheck, FiClock, FiPlay } from 'react-icons/fi';
import { Navigate, useNavigate } from 'react-router-dom';

import { useRegenerateRoadmap, useRoadmap, useUpdateRoadmapItem } from '~/lib/queries';

/**
 * The whole journey, visible at once (docs/learning-path.md).
 *
 * The design job here is making a long path feel finite. Phases are collapsed
 * to a line each except the one the user is in, so twelve weeks of work reads
 * as a handful of steps rather than a wall.
 */

const KIND_LABEL: Record<string, string> = {
  LEARN: 'Read',
  RECALL: 'Recall',
  CODE: 'Write',
  BLIND_CODE: 'Blind',
  DEBUG: 'Debug',
  EXPLAIN: 'Explain',
  PROJECT: 'Project',
  CHECKPOINT: 'Checkpoint',
  INTERVIEW: 'Interview',
};

const KIND_COLOR: Record<string, string> = {
  PROJECT: 'forge.500',
  INTERVIEW: 'info',
  CHECKPOINT: 'ink.500',
};

export function RoadmapPage() {
  const { data: roadmap, isLoading } = useRoadmap();
  const regenerate = useRegenerateRoadmap();
  const updateItem = useUpdateRoadmapItem();
  const navigate = useNavigate();

  if (isLoading) {
    return (
      <HStack justify="center" py={20}>
        <Spinner color="forge.500" />
      </HStack>
    );
  }

  // No roadmap means onboarding was never completed.
  if (!roadmap) return <Navigate to="/onboarding" replace />;

  const percent =
    roadmap.totalMinutes > 0
      ? Math.round((roadmap.completedMinutes / roadmap.totalMinutes) * 100)
      : 0;

  const currentPhaseIndex = roadmap.phases.findIndex((p) =>
    p.items.some((i) => i.id === roadmap.currentItemId),
  );

  const open = (item: { conceptId: string | null; exerciseId: string | null }) => {
    if (item.exerciseId) navigate(`/exercise/${item.exerciseId}`);
    else if (item.conceptId) navigate(`/concept/${item.conceptId}`);
  };

  return (
    <Box maxW="860px" mx="auto" px={6} py={8}>
      <HStack justify="space-between" align="flex-start" mb={2}>
        <Box>
          <Heading size="lg" fontWeight={650}>
            Your roadmap
          </Heading>
          <Text fontSize="sm" color="ink.400">
            {roadmap.phases.length} phases · {formatHours(roadmap.totalMinutes)} total
            {roadmap.generatedBy === 'rules' && ' · planned from your knowledge graph'}
          </Text>
        </Box>
        <Button
          variant="ghost"
          size="xs"
          isLoading={regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          Replan
        </Button>
      </HStack>

      <HStack spacing={3} mb={8}>
        <Progress
          value={percent}
          size="xs"
          flex="1"
          borderRadius="sm"
          sx={{ '& > div': { bg: 'forge.500' } }}
        />
        <Text fontSize="xs" color="ink.400" fontFamily="mono">
          {percent}%
        </Text>
      </HStack>

      <VStack align="stretch" spacing={3}>
        {roadmap.phases.map((phase, index) => {
          const isCurrent = index === currentPhaseIndex;
          const isDone = phase.items.length > 0 && phase.doneCount === phase.items.length;

          return (
            <Box
              key={phase.id}
              bg="surface.100"
              borderWidth="1px"
              borderColor={isCurrent ? 'forge.700' : 'surface.300'}
              borderRadius="lg"
              overflow="hidden"
            >
              <HStack px={4} py={3} spacing={3} align="flex-start">
                <PhaseMarker index={index} done={isDone} current={isCurrent} />

                <Box flex="1" minW={0}>
                  <HStack spacing={2}>
                    <Text fontSize="sm" fontWeight={600} color="ink.100">
                      {phase.title}
                    </Text>
                    {isCurrent && (
                      <Badge bg="forge.500" color="surface.0" fontSize="xs">
                        NOW
                      </Badge>
                    )}
                  </HStack>
                  <Text fontSize="xs" color="ink.400" mt={0.5}>
                    {phase.goal}
                  </Text>
                </Box>

                <Text fontSize="xs" color="ink.500" fontFamily="mono" flexShrink={0}>
                  {phase.items.length > 0 ? `${phase.doneCount}/${phase.items.length}` : '—'}
                </Text>
              </HStack>

              {/* Only the current phase expands. A wall of every item at once
                  makes a twelve-week plan look unachievable. */}
              {isCurrent && phase.items.length > 0 && (
                <VStack align="stretch" spacing={0} borderTopWidth="1px" borderColor="surface.300">
                  {phase.items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      isCurrent={item.id === roadmap.currentItemId}
                      onOpen={() => open(item)}
                      onToggleDone={() =>
                        updateItem.mutate({
                          id: item.id,
                          status: item.status === 'DONE' ? 'PENDING' : 'DONE',
                        })
                      }
                    />
                  ))}
                </VStack>
              )}
            </Box>
          );
        })}
      </VStack>
    </Box>
  );
}

function ItemRow({
  item,
  isCurrent,
  onOpen,
  onToggleDone,
}: {
  item: {
    id: string;
    kind: string;
    status: string;
    title: string;
    rationale: string;
    estimatedMinutes: number;
    conceptId: string | null;
    exerciseId: string | null;
  };
  isCurrent: boolean;
  onOpen: () => void;
  onToggleDone: () => void;
}) {
  const done = item.status === 'DONE';
  const awaiting = item.status === 'AWAITING_CONTENT';
  const openable = Boolean(item.exerciseId ?? item.conceptId);

  return (
    <HStack
      px={4}
      py={3}
      spacing={3}
      align="flex-start"
      borderTopWidth="1px"
      borderColor="surface.200"
      bg={isCurrent ? 'surface.200' : 'transparent'}
      _first={{ borderTopWidth: 0 }}
    >
      <Box
        as="button"
        aria-label={done ? `Mark ${item.title} not done` : `Mark ${item.title} done`}
        onClick={onToggleDone}
        mt="2px"
        w="16px"
        h="16px"
        flexShrink={0}
        borderRadius="sm"
        borderWidth="1px"
        borderColor={done ? 'pass' : 'surface.400'}
        bg={done ? 'pass' : 'transparent'}
        display="flex"
        alignItems="center"
        justifyContent="center"
        _hover={{ borderColor: done ? 'pass' : 'ink.400' }}
      >
        {done && <FiCheck size={11} color="#0B0C0E" />}
      </Box>

      <Box flex="1" minW={0}>
        <HStack spacing={2}>
          <Badge
            bg="surface.300"
            color={KIND_COLOR[item.kind] ?? 'ink.300'}
            fontSize="xs"
            flexShrink={0}
          >
            {KIND_LABEL[item.kind] ?? item.kind}
          </Badge>
          <Text
            fontSize="sm"
            color={done ? 'ink.500' : 'ink.100'}
            textDecoration={done ? 'line-through' : 'none'}
            noOfLines={1}
          >
            {item.title}
          </Text>
        </HStack>
        {/* The rationale is always shown. An opaque path is not a trusted path. */}
        <Text fontSize="xs" color="ink.500" mt={1}>
          {item.rationale}
        </Text>
      </Box>

      <HStack spacing={2} flexShrink={0}>
        <HStack spacing={1}>
          <Icon as={FiClock} color="ink.500" boxSize="10px" />
          <Text fontSize="xs" color="ink.500" fontFamily="mono">
            {item.estimatedMinutes}
          </Text>
        </HStack>

        {awaiting ? (
          <Badge bg="surface.300" color="warn" fontSize="xs">
            preparing
          </Badge>
        ) : (
          openable && (
            <Button size="xs" variant={isCurrent ? 'solid' : 'ghost'} onClick={onOpen}>
              {isCurrent ? (
                <HStack spacing={1}>
                  <Icon as={FiPlay} boxSize="10px" />
                  <Text>Start</Text>
                </HStack>
              ) : (
                'Open'
              )}
            </Button>
          )
        )}
      </HStack>
    </HStack>
  );
}

function PhaseMarker({ index, done, current }: { index: number; done: boolean; current: boolean }) {
  return (
    <Box
      w="24px"
      h="24px"
      borderRadius="full"
      flexShrink={0}
      display="flex"
      alignItems="center"
      justifyContent="center"
      borderWidth="1px"
      borderColor={done ? 'pass' : current ? 'forge.500' : 'surface.400'}
      bg={done ? 'pass' : 'transparent'}
    >
      {done ? (
        <FiCheck size={12} color="#0B0C0E" />
      ) : (
        <Text fontSize="xs" fontFamily="mono" color={current ? 'forge.500' : 'ink.500'}>
          {index + 1}
        </Text>
      )}
    </Box>
  );
}

function formatHours(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}
